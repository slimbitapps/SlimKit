//! Aufnahme → Sprachabschnitte. Einfache, robuste Sprechpausen-Erkennung: Lautstärke gegen mitlaufenden
//! Grundrauschpegel. Stille wird nie verschickt – das spart Zeit und verhindert, dass die Erkennung
//! in Stille Sätze „hört“ („Das ist das erste Mal“, „you“ …).

pub const RATE: usize = 16_000;
pub const FRAME: usize = 512; // 32 ms
const FRAME_MS: f32 = FRAME as f32 * 1000.0 / RATE as f32;
const PREROLL_FRAMES: usize = 10; // ~320 ms vor dem ersten lauten Moment mitnehmen
const KEEP_TAIL_FRAMES: usize = 6; // ~190 ms Stille am Ende behalten
const MIN_VOICED_MS: f32 = 200.0;
const MAX_SEGMENT_MS: f32 = 28_000.0;
/// Abschnitte, die insgesamt leiser sind, sind kein Sprechen (Rauschen, Klicken)
const MIN_SEGMENT_RMS: f32 = 0.004;

pub enum VadEvent {
    Level { level: f32, speaking: bool },
    Segment(Vec<i16>),
}

pub struct Segmenter {
    pause_ms: f32,
    sensitivity: f32,
    noise: f32,
    preroll: Vec<Vec<f32>>,
    seg: Option<Vec<Vec<f32>>>,
    voiced: usize,
    silent: usize,
    loud_run: usize,
    buf: Vec<f32>,
    level_every: usize,
    frames: usize,
}

impl Segmenter {
    /// sensitivity 0 … 100 (höher = auch leise Sprache)
    pub fn new(pause_ms: u32, sensitivity: u32) -> Self {
        Self {
            pause_ms: pause_ms.max(250) as f32,
            sensitivity: (sensitivity.min(100) as f32) / 100.0,
            noise: 0.004,
            preroll: Vec::new(),
            seg: None,
            voiced: 0,
            silent: 0,
            loud_run: 0,
            buf: Vec::with_capacity(FRAME * 2),
            level_every: 2,
            frames: 0,
        }
    }

    fn threshold(&self) -> f32 {
        let factor = 4.0 - self.sensitivity * 2.6;
        let floor = 0.014 - self.sensitivity * 0.011;
        (self.noise * factor).max(floor)
    }

    /// 16-kHz-Mono-Samples hineingeben; liefert Pegel und fertige Abschnitte
    pub fn push(&mut self, samples: &[f32], out: &mut Vec<VadEvent>) {
        self.buf.extend_from_slice(samples);
        while self.buf.len() >= FRAME {
            let frame: Vec<f32> = self.buf.drain(..FRAME).collect();
            self.frame(frame, out);
        }
    }

    fn frame(&mut self, f: Vec<f32>, out: &mut Vec<VadEvent>) {
        let rms = (f.iter().map(|v| v * v).sum::<f32>() / f.len() as f32).sqrt();
        let th = self.threshold();
        let loud = rms > th;
        if self.seg.is_none() {
            // Grundrauschen nur in ruhigen Momenten nachführen
            if loud {
                self.noise = self.noise * 0.998 + rms * 0.002;
            } else {
                self.noise = self.noise * 0.95 + rms * 0.05;
            }
        }
        self.frames += 1;
        if self.frames % self.level_every == 0 {
            out.push(VadEvent::Level { level: (rms / (th * 3.0).max(0.03)).min(1.0), speaking: self.seg.is_some() });
        }

        if self.seg.is_none() {
            self.preroll.push(f);
            if self.preroll.len() > PREROLL_FRAMES {
                self.preroll.remove(0);
            }
            self.loud_run = if loud { self.loud_run + 1 } else { 0 };
            if self.loud_run >= 3 {
                self.seg = Some(std::mem::take(&mut self.preroll));
                self.voiced = 3;
                self.silent = 0;
            }
            return;
        }
        let seg = self.seg.as_mut().unwrap();
        seg.push(f);
        if loud {
            self.voiced += 1;
            self.silent = 0;
        } else {
            self.silent += 1;
        }
        let len_ms = seg.len() as f32 * FRAME_MS;
        let pause = self.silent as f32 * FRAME_MS >= self.pause_ms;
        // sehr lange ohne Pause: an einer leiseren Stelle schneiden
        let too_long = len_ms >= MAX_SEGMENT_MS && (rms < th * 1.5 || len_ms >= MAX_SEGMENT_MS + 4000.0);
        if pause || too_long {
            self.end_segment(out);
        }
    }

    fn end_segment(&mut self, out: &mut Vec<VadEvent>) {
        let Some(seg) = self.seg.take() else { return };
        self.loud_run = 0;
        let drop = self.silent.saturating_sub(KEEP_TAIL_FRAMES);
        let keep = seg.len().saturating_sub(drop);
        self.silent = 0;
        if self.voiced as f32 * FRAME_MS < MIN_VOICED_MS {
            return;
        }
        let samples: Vec<f32> = seg[..keep].iter().flatten().copied().collect();
        let rms = (samples.iter().map(|v| v * v).sum::<f32>() / samples.len().max(1) as f32).sqrt();
        if rms < MIN_SEGMENT_RMS {
            return;
        }
        let pcm = samples.iter().map(|v| (v.clamp(-1.0, 1.0) * 32767.0) as i16).collect();
        out.push(VadEvent::Segment(pcm));
    }

    /// Aufnahme beendet: laufenden Abschnitt noch verschicken
    pub fn finish(&mut self, out: &mut Vec<VadEvent>) {
        if self.seg.is_some() {
            self.end_segment(out);
        }
    }
}

/// Einfacher Resampler auf 16 kHz (Mittelwert über das Fenster = Tiefpass, dann linear)
pub struct Resampler {
    ratio: f64,
    pos: f64,
    prev: Vec<f32>,
}

impl Resampler {
    pub fn new(from_rate: u32) -> Self {
        Self { ratio: from_rate as f64 / RATE as f64, pos: 0.0, prev: Vec::new() }
    }
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if (self.ratio - 1.0).abs() < 1e-9 {
            return input.to_vec();
        }
        let mut data = std::mem::take(&mut self.prev);
        data.extend_from_slice(input);
        let mut out = Vec::with_capacity((data.len() as f64 / self.ratio) as usize + 1);
        let win = self.ratio.max(1.0);
        while self.pos + win < data.len() as f64 {
            let start = self.pos as usize;
            let end = ((self.pos + win) as usize).min(data.len());
            let slice = &data[start..end.max(start + 1)];
            out.push(slice.iter().sum::<f32>() / slice.len() as f32);
            self.pos += self.ratio;
        }
        let consumed = self.pos as usize;
        self.prev = data[consumed..].to_vec();
        self.pos -= consumed as f64;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(ms: usize, amp: f32) -> Vec<f32> {
        (0..RATE * ms / 1000).map(|i| amp * ((i as f32) * 0.07).sin()).collect()
    }

    #[test]
    fn abschnitte_an_pausen() {
        let mut s = Segmenter::new(600, 50);
        let mut ev = Vec::new();
        s.push(&vec![0.0005; RATE / 2], &mut ev);
        s.push(&tone(1200, 0.3), &mut ev);
        s.push(&vec![0.0005; RATE], &mut ev);
        s.push(&tone(800, 0.3), &mut ev);
        s.push(&vec![0.0005; RATE / 4], &mut ev);
        s.finish(&mut ev);
        let segs: Vec<usize> = ev.iter().filter_map(|e| if let VadEvent::Segment(p) = e { Some(p.len()) } else { None }).collect();
        assert_eq!(segs.len(), 2, "{segs:?}");
        // ~1,2 s Ton + Vorlauf + etwas Stille, aber nicht die ganze Sekunde Pause
        assert!(segs[0] > RATE && segs[0] < RATE * 2, "{}", segs[0]);
    }

    #[test]
    fn stille_und_klicks_werden_nicht_verschickt() {
        let mut s = Segmenter::new(600, 50);
        let mut ev = Vec::new();
        s.push(&vec![0.0005; RATE * 3], &mut ev);
        s.push(&tone(60, 0.5), &mut ev); // kurzer Klick
        s.push(&vec![0.0005; RATE], &mut ev);
        s.finish(&mut ev);
        assert!(!ev.iter().any(|e| matches!(e, VadEvent::Segment(_))));
    }

    #[test]
    fn resampler_48k() {
        let mut r = Resampler::new(48_000);
        let out = r.process(&vec![0.5; 48_000]);
        assert!((out.len() as i64 - 16_000).abs() < 3, "{}", out.len());
        assert!((out[100] - 0.5).abs() < 1e-6);
    }
}
