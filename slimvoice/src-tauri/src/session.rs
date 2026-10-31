//! Ein Diktat von Start bis Ende. Bekommt Sprachabschnitte (zwischen zwei Sprechpausen) und entscheidet je nach Modus:
//!  live    – jeden Abschnitt sofort umwandeln, (optional) glätten und einfügen
//!  preview – Abschnitte für die Vorschau umwandeln; am Ende in bester Qualität umwandeln und einmal einfügen
//!  batch   – nur aufnehmen; am Ende umwandeln und einfügen (lokal: rechnet still schon mit)
//! Ohne Tauri – alle Dienste kommen als Funktionen herein (so lässt es sich testen).

use crate::prompts::{build_correction, clean_model_output, plausible, stt_prompt, CorrectionArgs};
use crate::providers::SvError;
use crate::text::{join_segment, local_cleanup, CleanupOpts, Replacement};
use crate::wav::{concat_pcm, group_chunks};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send>>;
/// (Audio, Modell, Hinweis) → Text
pub type TranscribeFn =
    Arc<dyn Fn(Vec<i16>, String, String) -> BoxFut<Result<String, SvError>> + Send + Sync>;
/// (System, Nutzer) → Text
pub type CompleteFn = Arc<dyn Fn(String, String) -> BoxFut<Result<String, SvError>> + Send + Sync>;
pub type InsertFn = Arc<dyn Fn(String) -> BoxFut<()> + Send + Sync>;
pub type EmitFn = Arc<dyn Fn(Value) + Send + Sync>;

#[derive(Clone)]
pub struct Deps {
    pub transcribe: TranscribeFn,
    pub complete: CompleteFn,
    pub insert: InsertFn,
    pub emit: EmitFn,
}

#[derive(Clone, Debug, Default)]
pub struct AiCfg {
    pub level: String,
    pub style: String,
    pub remove_fillers: bool,
    pub voice_commands: bool,
    pub translate_to: String,
    pub custom_instruction: String,
    pub vocabulary: Vec<String>,
    pub replacements: Vec<Replacement>,
    pub use_context: bool,
}

/// Einstellungen + passendes App-Profil (Name der App enthält den Suchbegriff) → wirksame KI-Einstellungen.
/// Wörter und Ersetzungen des Profils kommen zu den allgemeinen dazu.
pub fn ai_for_app(settings: &Value, app: &str) -> (AiCfg, Option<String>) {
    use crate::store::Get;
    let reps =
        |v: &Value| -> Vec<Replacement> { serde_json::from_value(v.clone()).unwrap_or_default() };
    let mut ai = AiCfg {
        level: settings.s("/ai/level"),
        style: settings.s("/ai/style"),
        remove_fillers: settings.b("/ai/removeFillers"),
        voice_commands: settings.b("/ai/voiceCommands"),
        translate_to: settings.s("/ai/translateTo"),
        custom_instruction: settings.s("/ai/customInstruction"),
        vocabulary: settings.list("/ai/vocabulary"),
        replacements: reps(&settings["ai"]["replacements"]),
        use_context: settings.b("/ai/useContext"),
    };
    let a = app.to_lowercase();
    if a.is_empty() {
        return (ai, None);
    }
    let profiles = settings["ai"]["profiles"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let found = profiles.iter().find(|p| {
        let m = p["match"].as_str().unwrap_or("").trim().to_lowercase();
        !m.is_empty() && a.contains(&m)
    });
    let Some(p) = found else { return (ai, None) };
    let set = |field: &str, target: &mut String| {
        if let Some(v) = p[field].as_str() {
            if !v.is_empty() && v != "inherit" {
                *target = v.to_string();
            }
        }
    };
    set("level", &mut ai.level);
    set("style", &mut ai.style);
    set("translateTo", &mut ai.translate_to);
    if let Some(v) = p["customInstruction"]
        .as_str()
        .filter(|v| !v.trim().is_empty())
    {
        ai.custom_instruction = format!("{} {}", ai.custom_instruction, v)
            .trim()
            .to_string();
    }
    ai.vocabulary.extend(p.list("/vocabulary"));
    ai.replacements.extend(reps(&p["replacements"]));
    (ai, p["match"].as_str().map(|s| s.to_string()))
}

#[derive(Clone, Debug)]
pub struct Models {
    pub stt_main: String,
    pub stt_preview: String,
    pub max_seconds: u32,
    /// leer = keine KI-Korrektur
    pub llm_model: String,
    /// lokal: schon während der Aufnahme rechnen
    pub pipeline: bool,
}

#[derive(Clone, Debug)]
pub struct Cfg {
    pub mode: String,
    pub language: String,
    pub trailing_space: bool,
    pub ai: AiCfg,
}

#[derive(Default)]
struct Inner {
    chunks: Vec<Option<Vec<i16>>>,
    previews: HashMap<usize, String>,
    inserted: String,
    live_results: HashMap<usize, String>,
    next_insert: usize,
    failed_preview: bool,
    warnings: HashSet<String>,
}

pub struct Session {
    pub id: u64,
    pub cfg: Cfg,
    pub models: Models,
    deps: Deps,
    inner: Arc<Mutex<Inner>>,
    flush: Arc<tokio::sync::Mutex<()>>,
    pending: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    pub cancelled: Arc<AtomicBool>,
}

pub struct Outcome {
    pub text: String,
    pub raw: String,
}

impl Session {
    pub fn new(id: u64, cfg: Cfg, models: Models, deps: Deps) -> Arc<Self> {
        Arc::new(Self {
            id,
            cfg,
            models,
            deps,
            inner: Arc::new(Mutex::new(Inner::default())),
            flush: Arc::new(tokio::sync::Mutex::new(())),
            pending: Mutex::new(Vec::new()),
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn warn(&self, code: &str) {
        let new = self.inner.lock().unwrap().warnings.insert(code.to_string());
        if new {
            (self.deps.emit)(json!({ "type": "warning", "code": code }));
        }
    }

    fn clean(&self, text: &str) -> String {
        local_cleanup(
            text,
            &CleanupOpts {
                lang: &self.cfg.language,
                remove_fillers: self.cfg.ai.remove_fillers,
                voice_commands: self.cfg.ai.voice_commands,
                replacements: &self.cfg.ai.replacements,
            },
        )
    }

    fn prompt(&self, context: &str) -> String {
        stt_prompt(
            &self.cfg.ai.vocabulary,
            if self.cfg.ai.use_context { context } else { "" },
        )
    }

    /// KI-Korrektur; bei Fehler oder unplausibler Antwort bleibt der Originaltext
    async fn correct(&self, text: String, context: &str) -> String {
        if text.is_empty() || self.cfg.ai.level == "off" || self.models.llm_model.is_empty() {
            return text;
        }
        let ai = &self.cfg.ai;
        let p = build_correction(&CorrectionArgs {
            text: &text,
            level: &ai.level,
            style: &ai.style,
            vocabulary: &ai.vocabulary,
            context: if ai.use_context { context } else { "" },
            translate_to: &ai.translate_to,
            custom_instruction: &ai.custom_instruction,
        });
        match (self.deps.complete)(p.system, p.user).await {
            Ok(out) => {
                let out = clean_model_output(&out);
                if !plausible(&text, &out, &ai.level, !ai.translate_to.is_empty()) {
                    self.warn("ai_implausible");
                    return text;
                }
                let c = self.clean(&out);
                if c.is_empty() {
                    text
                } else {
                    c
                }
            }
            Err(e) => {
                self.warn(&format!("ai_failed:{}", e.code));
                text
            }
        }
    }

    /// „Wort für Wort“: ein bereits eingetipptes Stück merken (für Vorschau + Verlauf)
    pub fn note_inserted(&self, piece: &str) {
        let mut g = self.inner.lock().unwrap();
        g.inserted.push_str(piece);
        (self.deps.emit)(json!({ "type": "preview", "text": g.inserted.trim() }));
    }

    /// Bisher eingefügter Text (Zusammenhang für die Erkennung)
    pub fn inserted(&self) -> String {
        self.inner.lock().unwrap().inserted.clone()
    }

    /// Erkennungs-Hinweis (Fachwörter + Zusammenhang)
    pub fn stt_hint(&self, context: &str) -> String {
        self.prompt(context)
    }

    pub fn add_segment(self: &Arc<Self>, idx: usize, pcm: Vec<i16>) {
        if self.is_cancelled() {
            return;
        }
        {
            let mut g = self.inner.lock().unwrap();
            if g.chunks.len() <= idx {
                g.chunks.resize(idx + 1, None);
            }
            g.chunks[idx] = Some(pcm.clone());
        }
        if self.cfg.mode == "batch" && !self.models.pipeline {
            return;
        }
        let me = self.clone();
        let live = self.cfg.mode == "live";
        let h = tokio::spawn(async move {
            if live {
                me.live(idx, pcm).await
            } else {
                me.preview(idx, pcm).await
            }
        });
        self.pending.lock().unwrap().push(h);
    }

    async fn live(self: Arc<Self>, idx: usize, pcm: Vec<i16>) {
        let ctx = self.inner.lock().unwrap().inserted.clone();
        let text = match (self.deps.transcribe)(
            pcm,
            self.models.stt_main.clone(),
            self.prompt(&ctx),
        )
        .await
        {
            Ok(raw) => {
                let c = self.clean(&raw);
                self.correct(c, &ctx).await
            }
            Err(e) => {
                (self.deps.emit)(json!({ "type": "error", "code": e.code, "message": e.message }));
                String::new()
            }
        };
        self.inner.lock().unwrap().live_results.insert(idx, text);
        self.flush_live().await;
    }

    async fn flush_live(&self) {
        let _guard = self.flush.lock().await;
        loop {
            let piece = {
                let mut g = self.inner.lock().unwrap();
                let n = g.next_insert;
                let Some(text) = g.live_results.remove(&n) else {
                    break;
                };
                g.next_insert += 1;
                if text.is_empty() || self.is_cancelled() {
                    continue;
                }
                let mut piece = join_segment(&g.inserted, &text);
                if self.cfg.trailing_space && !piece.ends_with(char::is_whitespace) {
                    piece.push(' ');
                }
                g.inserted.push_str(&piece);
                (self.deps.emit)(json!({ "type": "preview", "text": g.inserted.trim() }));
                piece
            };
            (self.deps.insert)(piece).await;
        }
    }

    async fn preview(self: Arc<Self>, idx: usize, pcm: Vec<i16>) {
        let ctx = self.preview_text(Some(idx));
        match (self.deps.transcribe)(pcm, self.models.stt_preview.clone(), self.prompt(&ctx)).await
        {
            Ok(raw) => {
                let c = self.clean(&raw);
                self.inner.lock().unwrap().previews.insert(idx, c);
            }
            Err(e) => {
                let mut g = self.inner.lock().unwrap();
                g.failed_preview = true;
                g.previews.insert(idx, String::new());
                drop(g);
                if e.code == "no_key" || e.code == "auth" || e.code == "local_missing" {
                    (self.deps.emit)(
                        json!({ "type": "error", "code": e.code, "message": e.message }),
                    );
                }
            }
        }
        (self.deps.emit)(json!({ "type": "preview", "text": self.preview_text(None) }));
    }

    fn preview_text(&self, until: Option<usize>) -> String {
        let g = self.inner.lock().unwrap();
        let n = until.unwrap_or(g.chunks.len()).min(g.chunks.len());
        let mut out = String::new();
        for i in 0..n {
            if let Some(t) = g.previews.get(&i) {
                if !t.is_empty() {
                    let piece = join_segment(&out, t);
                    out.push_str(&piece);
                }
            }
        }
        out
    }

    async fn wait_pending(&self) {
        let handles: Vec<_> = std::mem::take(&mut *self.pending.lock().unwrap());
        for h in handles {
            let _ = h.await;
        }
    }

    /// Aufnahme ist beendet: Rest erledigen. Gibt den eingefügten Text zurück.
    pub async fn finish(self: &Arc<Self>) -> Result<Outcome, SvError> {
        if self.cfg.mode == "live" || self.cfg.mode == "stream" {
            self.wait_pending().await;
            let t = self.inner.lock().unwrap().inserted.trim().to_string();
            return Ok(Outcome {
                text: t.clone(),
                raw: t,
            });
        }
        let chunks: Vec<Vec<i16>> = self
            .inner
            .lock()
            .unwrap()
            .chunks
            .iter()
            .flatten()
            .cloned()
            .collect();
        if chunks.is_empty() || self.is_cancelled() {
            return Ok(Outcome {
                text: String::new(),
                raw: String::new(),
            });
        }
        let mut raw = String::new();
        let can_reuse = (self.cfg.mode == "preview" || self.models.pipeline)
            && self.models.stt_preview == self.models.stt_main;
        if can_reuse {
            self.wait_pending().await;
            if !self.inner.lock().unwrap().failed_preview {
                raw = self.preview_text(None);
            }
        }
        if raw.is_empty() {
            let mut failed: Option<SvError> = None;
            for group in group_chunks(&chunks, self.models.max_seconds.max(30)) {
                if self.is_cancelled() {
                    return Ok(Outcome {
                        text: String::new(),
                        raw: String::new(),
                    });
                }
                match (self.deps.transcribe)(
                    concat_pcm(&group, 300),
                    self.models.stt_main.clone(),
                    self.prompt(&raw),
                )
                .await
                {
                    Ok(part) => {
                        let c = self.clean(&part);
                        let piece = join_segment(&raw, &c);
                        raw.push_str(&piece);
                    }
                    Err(e) => {
                        failed = Some(e);
                        break;
                    }
                }
            }
            if let Some(e) = failed {
                // Beste Qualität ging schief → Vorschau-Text nehmen, wenn es einen gibt
                self.wait_pending().await;
                raw = self.preview_text(None);
                if raw.is_empty() {
                    return Err(e);
                }
                self.warn("used_preview");
            }
        }
        if self.is_cancelled() {
            return Ok(Outcome {
                text: String::new(),
                raw,
            });
        }
        let mut text = self.correct(raw.clone(), "").await;
        if self.is_cancelled() {
            return Ok(Outcome {
                text: String::new(),
                raw,
            });
        }
        if !text.is_empty() && self.cfg.trailing_space && !text.ends_with(char::is_whitespace) {
            text.push(' ');
        }
        if !text.is_empty() {
            (self.deps.insert)(text.clone()).await;
        }
        Ok(Outcome {
            text: text.trim().to_string(),
            raw,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct Rec {
        inserted: Arc<Mutex<Vec<String>>>,
        events: Arc<Mutex<Vec<Value>>>,
        stt: Arc<Mutex<Vec<String>>>,
        llm: Arc<Mutex<Vec<String>>>,
    }

    fn session(
        mode: &str,
        stt: impl Fn(usize, &str) -> Result<String, SvError> + Send + Sync + 'static,
        llm: Option<fn(&str) -> Result<String, SvError>>,
        ai: AiCfg,
        models: Models,
    ) -> (Arc<Session>, Rec) {
        let rec = Rec {
            inserted: Default::default(),
            events: Default::default(),
            stt: Default::default(),
            llm: Default::default(),
        };
        let (ins, ev, sc, lc) = (
            rec.inserted.clone(),
            rec.events.clone(),
            rec.stt.clone(),
            rec.llm.clone(),
        );
        let stt = Arc::new(stt);
        let counter = Arc::new(Mutex::new(0usize));
        let deps = Deps {
            transcribe: Arc::new(move |_pcm, model, _p| {
                let n = {
                    let mut c = counter.lock().unwrap();
                    *c += 1;
                    *c - 1
                };
                sc.lock().unwrap().push(model.clone());
                let r = stt(n, &model);
                Box::pin(async move {
                    tokio::time::sleep(Duration::from_millis(if n == 0 { 30 } else { 5 })).await;
                    r
                })
            }),
            complete: Arc::new(move |_s, user| {
                lc.lock().unwrap().push(user.clone());
                let r = match llm {
                    Some(f) => f(&user),
                    None => {
                        let d = user
                            .split("<dictation>\n")
                            .nth(1)
                            .unwrap_or("")
                            .split("\n</dictation>")
                            .next()
                            .unwrap_or("")
                            .to_uppercase();
                        Ok(d)
                    }
                };
                Box::pin(async move { r })
            }),
            insert: Arc::new(move |t| {
                ins.lock().unwrap().push(t);
                Box::pin(async {})
            }),
            emit: Arc::new(move |e| ev.lock().unwrap().push(e)),
        };
        let cfg = Cfg {
            mode: mode.into(),
            language: "de".into(),
            trailing_space: true,
            ai,
        };
        (Session::new(1, cfg, models, deps), rec)
    }
    fn models() -> Models {
        Models {
            stt_main: "main".into(),
            stt_preview: "preview".into(),
            max_seconds: 600,
            llm_model: "llm".into(),
            pipeline: false,
        }
    }
    fn ai(level: &str) -> AiCfg {
        AiCfg {
            level: level.into(),
            remove_fillers: true,
            voice_commands: true,
            use_context: true,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn live_reihenfolge_bleibt() {
        let (s, r) = session(
            "live",
            |n, _| Ok(["erster satz.", "zweiter satz."][n].to_string()),
            None,
            ai("light"),
            models(),
        );
        s.add_segment(0, vec![1; 1600]);
        s.add_segment(1, vec![1; 1600]);
        let o = s.finish().await.unwrap();
        assert_eq!(
            *r.inserted.lock().unwrap(),
            vec!["ERSTER SATZ. ", "ZWEITER SATZ. "]
        );
        assert_eq!(o.text, "ERSTER SATZ. ZWEITER SATZ.");
    }

    #[tokio::test]
    async fn preview_dann_beste_qualitaet() {
        let (s, r) = session(
            "preview",
            |_, m| {
                Ok(if m == "preview" {
                    "vorschau".into()
                } else {
                    "hallo äh welt neuer absatz zweite zeile".into()
                })
            },
            None,
            ai("light"),
            models(),
        );
        s.add_segment(0, vec![1; 1600]);
        s.add_segment(1, vec![1; 1600]);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(r
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e["text"] == "Vorschau vorschau"));
        let o = s.finish().await.unwrap();
        assert_eq!(o.raw, "Hallo welt\n\nZweite zeile");
        assert_eq!(
            *r.inserted.lock().unwrap(),
            vec!["HALLO WELT\n\nZWEITE ZEILE "]
        );
        assert_eq!(
            r.stt
                .lock()
                .unwrap()
                .iter()
                .filter(|m| *m == "main")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn lokal_batch_rechnet_mit() {
        let mut m = models();
        m.stt_main = "m".into();
        m.stt_preview = "m".into();
        m.pipeline = true;
        let (s, r) = session("batch", |_, _| Ok("eins zwei".into()), None, ai("off"), m);
        s.add_segment(0, vec![1; 1600]);
        s.add_segment(1, vec![1; 1600]);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(r.stt.lock().unwrap().len(), 2);
        s.finish().await.unwrap();
        assert_eq!(r.stt.lock().unwrap().len(), 2, "am Ende nichts doppelt");
        assert_eq!(*r.inserted.lock().unwrap(), vec!["Eins zwei eins zwei "]);
    }

    #[tokio::test]
    async fn ki_antwortet_statt_korrigiert() {
        let (s, r) = session(
            "batch",
            |_, _| Ok("wie spät ist es".into()),
            Some(|_| {
                Ok("Es ist 14:30 Uhr. Brauchst du sonst noch etwas? Ich helfe dir gerne weiter bei allem.".into())
            }),
            ai("light"),
            models(),
        );
        s.add_segment(0, vec![1; 1600]);
        s.finish().await.unwrap();
        assert_eq!(*r.inserted.lock().unwrap(), vec!["Wie spät ist es "]);
        assert!(r
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e["code"] == "ai_implausible"));
    }

    #[tokio::test]
    async fn fehler_dann_vorschau_als_ersatz() {
        let (s, r) = session(
            "preview",
            |_, m| {
                if m == "main" {
                    Err(SvError::new("server", "down"))
                } else {
                    Ok("aus der vorschau".into())
                }
            },
            Some(|_| Err(SvError::new("quota", "x"))),
            ai("light"),
            models(),
        );
        s.add_segment(0, vec![1; 1600]);
        s.finish().await.unwrap();
        assert_eq!(*r.inserted.lock().unwrap(), vec!["Aus der vorschau "]);
        let ev = r.events.lock().unwrap();
        assert!(ev.iter().any(|e| e["code"] == "used_preview"));
        assert!(ev.iter().any(|e| e["code"] == "ai_failed:quota"));
    }

    #[tokio::test]
    async fn abbrechen_fuegt_nichts_ein() {
        let (s, r) = session("batch", |_, _| Ok("text".into()), None, ai("off"), models());
        s.add_segment(0, vec![1; 1600]);
        s.cancel();
        s.finish().await.unwrap();
        assert!(r.inserted.lock().unwrap().is_empty());
    }

    #[test]
    fn app_profil_mit_eigenen_woertern() {
        let mut st = crate::store::defaults();
        st["ai"]["vocabulary"] = json!(["SlimBit"]);
        st["ai"]["profiles"] = json!([
            { "match": "code", "level": "punct", "style": "inherit", "vocabulary": ["TypeScript", "useEffect"], "replacements": [{ "from": "pr", "to": "Pull-Request" }] },
            { "match": "outlook", "style": "formal" }
        ]);
        let (a, p) = ai_for_app(&st, "Visual Studio Code");
        assert_eq!(p.as_deref(), Some("code"));
        assert_eq!(a.level, "punct");
        assert_eq!(a.vocabulary, vec!["SlimBit", "TypeScript", "useEffect"]);
        assert_eq!(a.replacements[0].to, "Pull-Request");
        let (b, _) = ai_for_app(&st, "OUTLOOK");
        assert_eq!(b.style, "formal");
        assert_eq!(b.vocabulary, vec!["SlimBit"]);
        assert!(ai_for_app(&st, "Finder").1.is_none());
    }
}
