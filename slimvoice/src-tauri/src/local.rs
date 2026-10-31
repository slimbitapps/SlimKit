//! Lokale Spracherkennung mit whisper.cpp (wie Superwhisper/MacWhisper). Mac: Metal-Grafik, sonst Prozessor.
//! Modelle werden nur auf Wunsch heruntergeladen und im App-Ordner gespeichert – danach offline.

use crate::providers::SvError;
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct ModelInfo {
    pub key: &'static str,
    pub file: &'static str,
    pub size_mb: u32,
    pub ram_gb: u32,
}

/// Quantisierte Modelle: deutlich kleiner, kaum schlechter
pub const MODELS: [ModelInfo; 3] = [
    ModelInfo {
        key: "base",
        file: "ggml-base-q5_1.bin",
        size_mb: 60,
        ram_gb: 2,
    },
    ModelInfo {
        key: "small",
        file: "ggml-small-q5_1.bin",
        size_mb: 190,
        ram_gb: 4,
    },
    ModelInfo {
        key: "turbo",
        file: "ggml-large-v3-turbo-q5_0.bin",
        size_mb: 575,
        ram_gb: 6,
    },
];

pub fn model(key: &str) -> &'static ModelInfo {
    MODELS.iter().find(|m| m.key == key).unwrap_or(&MODELS[1])
}

fn model_url(file: &str) -> String {
    let base = std::env::var("SLIMVOICE_MODEL_URL")
        .unwrap_or_else(|_| "https://huggingface.co/ggerganov/whisper.cpp/resolve/main".into());
    format!("{}/{file}", base.trim_end_matches('/'))
}

pub struct Engine {
    dir: PathBuf,
    ctx: Mutex<Option<(String, bool, WhisperContext)>>,
    cancel: AtomicBool,
}

pub struct Transcript {
    pub text: String,
    pub ms: u128,
    pub gpu: bool,
}

impl Engine {
    pub fn new(dir: PathBuf) -> Self {
        // whisper.cpp schreibt sonst sehr viel ins Terminal
        whisper_rs::install_logging_hooks();
        Self {
            dir,
            ctx: Mutex::new(None),
            cancel: AtomicBool::new(false),
        }
    }

    pub fn path(&self, key: &str) -> PathBuf {
        self.dir.join(model(key).file)
    }

    pub fn is_downloaded(&self, key: &str) -> bool {
        std::fs::metadata(self.path(key))
            .map(|m| m.len() > 1_000_000)
            .unwrap_or(false)
    }

    pub fn downloaded_sizes(&self) -> serde_json::Map<String, serde_json::Value> {
        let mut out = serde_json::Map::new();
        for m in MODELS.iter() {
            if let Ok(meta) = std::fs::metadata(self.path(m.key)) {
                if meta.len() > 1_000_000 {
                    out.insert(m.key.into(), meta.len().into());
                }
            }
        }
        out
    }

    pub fn cancel_download(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Lädt das Modell herunter (mit Fortschritt). Zuerst in eine .part-Datei, erst am Ende umbenennen.
    pub async fn download(&self, key: &str, progress: impl Fn(u64, u64)) -> Result<(), SvError> {
        self.cancel.store(false, Ordering::SeqCst);
        let m = model(key);
        std::fs::create_dir_all(&self.dir).map_err(|e| SvError::new("local", e.to_string()))?;
        let part = self.dir.join(format!("{}.part", m.file));
        let res = reqwest::Client::new()
            .get(model_url(m.file))
            .send()
            .await
            .map_err(|e| SvError::new("network", e.to_string()))?;
        if !res.status().is_success() {
            return Err(SvError::new("network", format!("HTTP {}", res.status())));
        }
        let total = res.content_length().unwrap_or(m.size_mb as u64 * 1_000_000);
        let mut file = tokio::fs::File::create(&part)
            .await
            .map_err(|e| SvError::new("local", e.to_string()))?;
        let mut stream = res.bytes_stream();
        let mut loaded = 0u64;
        let mut last = 0u64;
        use tokio::io::AsyncWriteExt;
        while let Some(chunk) = stream.next().await {
            if self.cancel.load(Ordering::SeqCst) {
                drop(file);
                let _ = std::fs::remove_file(&part);
                return Err(SvError::new("cancelled", "cancelled"));
            }
            let chunk = chunk.map_err(|e| SvError::new("network", e.to_string()))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| SvError::new("local", e.to_string()))?;
            loaded += chunk.len() as u64;
            if loaded - last > 1_000_000 || loaded == total {
                last = loaded;
                progress(loaded, total);
            }
        }
        file.flush()
            .await
            .map_err(|e| SvError::new("local", e.to_string()))?;
        drop(file);
        if loaded < 1_000_000 {
            let _ = std::fs::remove_file(&part);
            return Err(SvError::new("network", "download incomplete"));
        }
        std::fs::rename(&part, self.path(key)).map_err(|e| SvError::new("local", e.to_string()))?;
        Ok(())
    }

    pub fn delete(&self, key: &str) {
        let mut g = self.ctx.lock().unwrap_or_else(|e| e.into_inner());
        if g.as_ref().map(|(k, _, _)| k == key).unwrap_or(false) {
            *g = None;
        }
        let _ = std::fs::remove_file(self.path(key));
    }

    pub fn unload(&self) {
        *self.ctx.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn loaded(&self) -> Option<(String, bool)> {
        self.ctx
            .lock()
            .unwrap()
            .as_ref()
            .map(|(k, g, _)| (k.clone(), *g))
    }

    /// Modell in den Speicher laden (blockiert – im Hintergrund-Thread aufrufen)
    pub fn load(&self, key: &str, gpu: bool) -> Result<(), SvError> {
        let mut g = self.ctx.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((k, gg, _)) = g.as_ref() {
            if k == key && *gg == gpu {
                return Ok(());
            }
        }
        *g = None;
        if !self.is_downloaded(key) {
            return Err(SvError::new("local_missing", "model not downloaded"));
        }
        let mut params = WhisperContextParameters::default();
        params.use_gpu = gpu;
        // Flash-Attention aus: auf manchen Macs instabil, Gewinn bei kurzen Diktaten minimal
        params.flash_attn = false;
        let path = self.path(key);
        let ctx = WhisperContext::new_with_params(&path.to_string_lossy(), params)
            .map_err(|e| SvError::new("local", format!("{e:?}")))?;
        *g = Some((key.to_string(), gpu, ctx));
        Ok(())
    }

    /// Sprache → Text (blockiert). language: „de“, „en“ … oder „auto“; prompt: Fachbegriffe/Zusammenhang.
    /// Schutz gegen Hänger: begrenzte Länge der Ausgabe, keine Wiederholungs-Versuche, harte Zeitgrenze.
    pub fn transcribe(&self, key: &str, gpu: bool, pcm: &[i16], language: &str, prompt: &str, best: bool) -> Result<Transcript, SvError> {
        let t0 = std::time::Instant::now();
        let audio: Vec<f32> = pcm.iter().map(|&s| s as f32 / 32768.0).collect();
        // fast nur Stille → gar nicht erst rechnen (verhindert erfundene Sätze)
        let rms = (audio.iter().map(|v| v * v).sum::<f32>() / audio.len().max(1) as f32).sqrt();
        if audio.len() < 3200 || rms < 0.002 {
            return Ok(Transcript { text: String::new(), ms: 0, gpu });
        }
        let secs = audio.len() as f32 / 16_000.0;
        // Whisper braucht mindestens ~1 s – kurze Abschnitte mit Stille auffüllen
        let mut audio = audio;
        if audio.len() < 16_000 + 1600 {
            audio.resize(16_000 + 1600, 0.0);
        }
        self.load(key, gpu)?;
        let g = self.ctx.lock().unwrap_or_else(|e| e.into_inner());
        let (_, used_gpu, ctx) = g.as_ref().ok_or_else(|| SvError::new("local", "not loaded"))?;
        let mut state = ctx.create_state().map_err(|e| SvError::new("local", format!("{e:?}")))?;
        let strategy = if best { SamplingStrategy::BeamSearch { beam_size: 3, patience: -1.0 } } else { SamplingStrategy::Greedy { best_of: 1 } };
        let mut p = FullParams::new(strategy);
        // Fast alle Kerne, aber einen Rest frei lassen, damit der Rechner bedienbar bleibt
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let threads = if cores <= 4 { cores } else { (cores - 2).min(8) };
        p.set_n_threads(threads.max(1) as i32);
        let lang = if language.is_empty() { "auto" } else { language };
        p.set_language(Some(lang));
        p.set_translate(false);
        p.set_no_context(true);
        p.set_no_timestamps(true);
        p.set_suppress_blank(true);
        p.set_suppress_nst(true);
        p.set_print_special(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_timestamps(false);
        // Kurze Aufnahme → nur so viel Audio-Kontext rechnen wie nötig (Whisper rechnet sonst immer 30 s)
        if secs < 28.0 {
            let ctx_frames = ((secs.max(1.1) * 50.0) as i32 + 128).clamp(384, 1500);
            p.set_audio_ctx(ctx_frames);
            p.set_single_segment(true);
        }
        // Keine Wiederholungs-Versuche mit höherer „Temperatur“ – die erzeugen bei Rauschen Endlosschleifen
        p.set_temperature(0.0);
        p.set_temperature_inc(0.0);
        // Höchstens so viele Wörter, wie man in der Zeit sprechen kann (≈ 3 Wörter/s, ≈ 2 Token/Wort)
        p.set_max_tokens(((secs * 8.0) as i32 + 24).clamp(32, 448));
        p.set_no_speech_thold(0.6);
        if !prompt.is_empty() {
            p.set_initial_prompt(prompt);
        }
        // Harte Zeitgrenze: lieber abbrechen und Bescheid sagen als den Rechner minutenlang blockieren
        let limit = std::time::Duration::from_secs_f32((secs * 6.0).max(25.0));
        let started = std::time::Instant::now();
        let aborted = std::sync::Arc::new(AtomicBool::new(false));
        let ab2 = aborted.clone();
        p.set_abort_callback_safe(move || {
            let over = started.elapsed() > limit;
            if over {
                ab2.store(true, Ordering::SeqCst);
            }
            over
        });
        let res = state.full(p, &audio);
        if aborted.load(Ordering::SeqCst) {
            return Err(SvError::new("local_slow", format!("{:.0} s", limit.as_secs_f32())));
        }
        res.map_err(|e| SvError::new("local", format!("{e:?}")))?;
        let mut text = String::new();
        for i in 0..state.full_n_segments() {
            if let Some(seg) = state.get_segment(i) {
                // Abschnitte, die Whisper selbst für „keine Sprache“ hält, weglassen
                if seg.no_speech_probability() > 0.6 {
                    continue;
                }
                if let Ok(s) = seg.to_str_lossy() {
                    text.push_str(&s);
                }
            }
        }
        Ok(Transcript { text: collapse_repeats(text.trim()), ms: t0.elapsed().as_millis(), gpu: *used_gpu })
    }
}

/// Endlosschleifen entfernen („Das ist das erste Mal. Das ist das erste Mal. …“ → einmal)
pub fn collapse_repeats(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 6 {
        return text.to_string();
    }
    let mut out: Vec<&str> = Vec::new();
    let mut i = 0;
    'outer: while i < words.len() {
        // gleiche Wortfolge (1–8 Wörter) direkt mehrfach hintereinander → nur einmal behalten
        for n in (1..=8).rev() {
            if i + 2 * n <= words.len() && words[i..i + n] == words[i + n..i + 2 * n] {
                let mut j = i + n;
                while j + n <= words.len() && words[i..i + n] == words[j..j + n] {
                    j += n;
                }
                if (j - i) / n >= 3 {
                    out.extend_from_slice(&words[i..i + n]);
                    i = j;
                    continue 'outer;
                }
            }
        }
        out.push(words[i]);
        i += 1;
    }
    out.join(" ")
}

#[cfg(test)]
mod tests {
    #[test]
    fn schleifen_werden_entfernt() {
        assert_eq!(super::collapse_repeats("Das ist das erste Mal. Das ist das erste Mal. Das ist das erste Mal. Das ist das erste Mal."), "Das ist das erste Mal.");
        assert_eq!(super::collapse_repeats("ja ja das ist gut so"), "ja ja das ist gut so");
        assert_eq!(super::collapse_repeats("Hallo Welt, wie geht es dir heute so?"), "Hallo Welt, wie geht es dir heute so?");
    }
}

/// Eingebaute Sprachprobe für den Selbsttest nach dem Download (englisch, „Hello, this is a test …“)
pub const SELFTEST_WAV: &[u8] = include_bytes!("../resources/selftest-en.wav");
pub const SELFTEST_WORDS: &[&str] = &["hello", "test", "speech", "voice"];
