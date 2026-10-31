//! Mikrofon → 16 kHz mono → Sprachabschnitte (über die Sprechpausen-Erkennung in vad.rs).
//! Läuft in einem eigenen Thread. Zum Testen kann statt des Mikrofons eine WAV-Datei „abgespielt“ werden
//! (Umgebungsvariable SLIMVOICE_FAKE_AUDIO).

use crate::vad::{Resampler, Segmenter, VadEvent, FRAME};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

pub enum AudioMsg {
    Level {
        level: f32,
        speaking: bool,
    },
    Segment(Vec<i16>),
    Error(String),
    /// Aufnahme ist sauber beendet (alle Abschnitte sind raus)
    Ended,
}

pub struct RecOpts {
    pub device: String,
    pub pause_ms: u32,
    pub sensitivity: u32,
    /// false = nur Pegel (Mikrofontest)
    pub vad: bool,
}

pub struct Recorder {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Recorder {
    pub fn start(opts: RecOpts, tx: Sender<AudioMsg>) -> Recorder {
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        let handle = std::thread::spawn(move || {
            let res = match std::env::var("SLIMVOICE_FAKE_AUDIO") {
                Ok(path) if !path.is_empty() => run_fake(&path, &opts, &s2, &tx),
                _ => run_mic(&opts, &s2, &tx),
            };
            if let Err(e) = res {
                let _ = tx.send(AudioMsg::Error(e));
            }
            let _ = tx.send(AudioMsg::Ended);
        });
        Recorder {
            stop,
            handle: Some(handle),
        }
    }

    /// Beenden; der laufende Abschnitt wird noch verschickt
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

struct Pipeline {
    resampler: Resampler,
    seg: Segmenter,
    vad: bool,
    level_buf: Vec<f32>,
    events: Vec<VadEvent>,
}

impl Pipeline {
    fn new(rate: u32, o: &RecOpts) -> Self {
        Self {
            resampler: Resampler::new(rate),
            seg: Segmenter::new(o.pause_ms, o.sensitivity),
            vad: o.vad,
            level_buf: Vec::new(),
            events: Vec::new(),
        }
    }
    fn feed(&mut self, mono: &[f32], tx: &Sender<AudioMsg>) {
        let s = self.resampler.process(mono);
        if self.vad {
            self.seg.push(&s, &mut self.events);
        } else {
            self.level_buf.extend_from_slice(&s);
            while self.level_buf.len() >= FRAME * 2 {
                let f: Vec<f32> = self.level_buf.drain(..FRAME * 2).collect();
                let rms = (f.iter().map(|v| v * v).sum::<f32>() / f.len() as f32).sqrt();
                let _ = tx.send(AudioMsg::Level {
                    level: (rms * 6.0).min(1.0),
                    speaking: false,
                });
            }
        }
        self.drain(tx);
    }
    fn drain(&mut self, tx: &Sender<AudioMsg>) {
        for e in self.events.drain(..) {
            let _ = tx.send(match e {
                VadEvent::Level { level, speaking } => AudioMsg::Level { level, speaking },
                VadEvent::Segment(p) => AudioMsg::Segment(p),
            });
        }
    }
    fn finish(&mut self, tx: &Sender<AudioMsg>) {
        if self.vad {
            self.seg.finish(&mut self.events);
            self.drain(tx);
        }
    }
}

fn run_fake(
    path: &str,
    o: &RecOpts,
    stop: &AtomicBool,
    tx: &Sender<AudioMsg>,
) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let (samples, rate) = crate::wav::decode_wav(&bytes).ok_or("bad wav")?;
    let mut p = Pipeline::new(rate, o);
    let chunk = (rate / 50) as usize; // 20 ms
    let mut i = 0;
    while !stop.load(Ordering::SeqCst) {
        let end = (i + chunk).min(samples.len());
        p.feed(&samples[i..end], tx);
        i = if end >= samples.len() { 0 } else { end }; // in Schleife abspielen
        std::thread::sleep(Duration::from_millis(20));
    }
    p.finish(tx);
    Ok(())
}

fn run_mic(o: &RecOpts, stop: &AtomicBool, tx: &Sender<AudioMsg>) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let device = if o.device.is_empty() {
        host.default_input_device()
    } else {
        host.input_devices()
            .ok()
            .and_then(|mut d| d.find(|d| d.name().map(|n| n == o.device).unwrap_or(false)))
            .or_else(|| host.default_input_device())
    }
    .ok_or("no microphone")?;
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let (dtx, drx): (Sender<Vec<f32>>, Receiver<Vec<f32>>) = channel();
    let err_tx = tx.clone();
    let on_err = move |e: cpal::StreamError| {
        let _ = err_tx.send(AudioMsg::Error(e.to_string()));
    };
    fn mono<T: Copy>(data: &[T], ch: usize, conv: impl Fn(T) -> f32) -> Vec<f32> {
        data.chunks(ch.max(1))
            .map(|f| f.iter().map(|&s| conv(s)).sum::<f32>() / f.len() as f32)
            .collect()
    }
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |d: &[f32], _: &_| {
                let _ = dtx.send(mono(d, channels, |s| s));
            },
            on_err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |d: &[i16], _: &_| {
                let _ = dtx.send(mono(d, channels, |s| s as f32 / 32768.0));
            },
            on_err,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |d: &[u16], _: &_| {
                let _ = dtx.send(mono(d, channels, |s| (s as f32 - 32768.0) / 32768.0));
            },
            on_err,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            &config.into(),
            move |d: &[i32], _: &_| {
                let _ = dtx.send(mono(d, channels, |s| s as f32 / 2147483648.0));
            },
            on_err,
            None,
        ),
        f => return Err(format!("unsupported sample format {f:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    let mut p = Pipeline::new(rate, o);
    while !stop.load(Ordering::SeqCst) {
        if let Ok(buf) = drx.recv_timeout(Duration::from_millis(40)) {
            p.feed(&buf, tx);
        }
    }
    drop(stream);
    while let Ok(buf) = drx.try_recv() {
        p.feed(&buf, tx);
    }
    p.finish(tx);
    Ok(())
}

pub fn list_inputs() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    cpal::default_host()
        .input_devices()
        .map(|d| d.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}
