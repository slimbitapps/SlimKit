//! „Wort für Wort“: Text erscheint schon während des Sprechens.
//!
//! Solange gesprochen wird, wird das bisher Gesagte laufend neu erkannt (ca. alle 0,5 s). Ein Wort wird erst
//! eingetippt, wenn es in zwei Durchgängen hintereinander gleich erkannt wurde („Local Agreement“) – so muss
//! nie etwas zurückgenommen werden. Das letzte Wort wartet immer, weil es oft noch nicht fertig gesprochen ist.
//! Am Ende eines Satzes (Sprechpause) wird der ganze Satz einmal gründlich erkannt und der Rest eingetippt.

use crate::text::{apply_replacements, is_hallucination, join_segment, Replacement};

/// Vergleich ohne Groß/klein und Satzzeichen („Hallo,“ = „hallo“)
fn norm(w: &str) -> String {
    w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

pub fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(|s| s.to_string()).collect()
}

const FILLERS: &[&str] = &["äh", "ähm", "öh", "öhm", "hm", "hmm", "ähh", "ehm", "uh", "uhm", "umm", "erm"];

fn is_filler(w: &str) -> bool {
    FILLERS.contains(&norm(w).as_str())
}

#[derive(Default)]
pub struct Agreement {
    committed: usize,
    /// schon eingetippte Wörter (für den Abgleich am Satzende)
    typed: Vec<String>,
    prev: Vec<String>,
}

impl Agreement {
    pub fn reset(&mut self) {
        self.committed = 0;
        self.typed.clear();
        self.prev.clear();
    }

    pub fn committed(&self) -> usize {
        self.committed
    }

    /// Zwischenergebnis: gibt die Wörter zurück, die jetzt sicher sind und noch nicht getippt wurden
    pub fn partial(&mut self, hyp: &[String]) -> Vec<String> {
        let lcp = self.prev.iter().zip(hyp.iter()).take_while(|(a, b)| norm(a) == norm(b)).count();
        // das letzte Wort nie sofort – es ist oft noch abgeschnitten
        let stable = lcp.min(hyp.len().saturating_sub(1));
        let new = if stable > self.committed { hyp[self.committed..stable].to_vec() } else { Vec::new() };
        self.committed = self.committed.max(stable);
        self.typed.extend(new.iter().cloned());
        self.prev = hyp.to_vec();
        new
    }

    /// Satzende: alles, was noch fehlt. Die gründliche Erkennung kann sich leicht unterscheiden
    /// (z. B. ohne „äh“) – darum wird das schon Getippte im Endergebnis gesucht, nicht nur abgezählt.
    pub fn finish(&mut self, final_words: &[String]) -> Vec<String> {
        let typed: Vec<String> = self.typed.iter().filter(|w| !is_filler(w)).map(|w| norm(w)).filter(|w| !w.is_empty()).collect();
        let mut j = 0;
        let mut i = 0;
        let mut matched = true;
        while i < final_words.len() && j < typed.len() {
            let w = norm(&final_words[i]);
            if w == typed[j] {
                j += 1;
            } else if !(is_filler(&final_words[i]) || w.is_empty()) {
                matched = false;
                break;
            }
            i += 1;
        }
        let start = if matched {
            i
        } else {
            // Abweichung: das zuletzt getippte Wort in der Nähe suchen, sonst nach Anzahl
            let n = typed.len();
            let last = typed.last().cloned().unwrap_or_default();
            let lo = n.saturating_sub(3);
            let hi = (n + 3).min(final_words.len());
            (lo..hi).rev().find(|&k| norm(&final_words[k]) == last).map(|k| k + 1).unwrap_or(n.min(final_words.len()))
        };
        let rest = final_words[start.min(final_words.len())..].to_vec();
        self.reset();
        rest
    }
}

pub struct Streamer {
    pub agreement: Agreement,
    buf: Vec<i16>,
    last_len: usize,
    /// alles, was in diesem Diktat schon eingetippt wurde
    pub inserted: String,
    /// Zusammenhang = Text VOR dem aktuellen Satz (sonst lässt Whisper die schon getippten Wörter weg)
    ctx: String,
    pub remove_fillers: bool,
    pub replacements: Vec<Replacement>,
}

/// Erkennung: (Audio, gründlich?) → Text
pub type Recognize<'a> = dyn FnMut(&[i16], bool, &str) -> Result<String, String> + 'a;
/// Eintippen eines Stücks Text
pub type Type<'a> = dyn FnMut(&str) + 'a;

/// Mindestens so viel neues Audio, bevor wieder erkannt wird (0,5 s)
const STEP: usize = 8_000;
/// Erst ab 1 s Sprache die erste Zwischen-Erkennung
const MIN_AUDIO: usize = 16_000;

impl Streamer {
    pub fn new(remove_fillers: bool, replacements: Vec<Replacement>) -> Self {
        Self { agreement: Agreement::default(), buf: Vec::new(), last_len: 0, inserted: String::new(), ctx: String::new(), remove_fillers, replacements }
    }

    fn context(&self) -> String {
        self.ctx.clone()
    }

    fn snapshot_ctx(&mut self) {
        let n = self.inserted.chars().count();
        self.ctx = self.inserted.chars().skip(n.saturating_sub(120)).collect();
    }

    fn emit(&mut self, ws: Vec<String>, typer: &mut Type) {
        let ws: Vec<String> = if self.remove_fillers { ws.into_iter().filter(|w| !is_filler(w)).collect() } else { ws };
        if ws.is_empty() {
            return;
        }
        let piece = apply_replacements(&ws.join(" "), &self.replacements);
        let piece = join_segment(&self.inserted, &piece);
        if piece.trim().is_empty() {
            return;
        }
        self.inserted.push_str(&piece);
        typer(&piece);
    }

    pub fn on_start(&mut self, pcm: Vec<i16>) {
        self.buf = pcm;
        self.last_len = 0;
        self.agreement.reset();
        self.snapshot_ctx();
    }

    pub fn on_frame(&mut self, pcm: &[i16], rec: &mut Recognize, typer: &mut Type) {
        self.push(pcm);
        self.tick(rec, typer);
    }

    /// Audio sammeln (ohne zu rechnen)
    pub fn push(&mut self, pcm: &[i16]) {
        self.buf.extend_from_slice(pcm);
    }

    /// Wenn genug neues Audio da ist: Zwischen-Erkennung und sichere Wörter eintippen
    pub fn tick(&mut self, rec: &mut Recognize, typer: &mut Type) {
        if self.buf.len() < MIN_AUDIO || self.buf.len() < self.last_len + STEP {
            return;
        }
        self.last_len = self.buf.len();
        let ctx = self.context();
        let Ok(text) = rec(&self.buf, false, &ctx) else { return };
        if is_hallucination(&text) {
            return;
        }
        let new = self.agreement.partial(&words(&text));
        self.emit(new, typer);
    }

    /// Satzende (Sprechpause): ganzen Satz gründlich erkennen und den Rest eintippen
    pub fn on_segment(&mut self, pcm: &[i16], rec: &mut Recognize, typer: &mut Type) {
        let ctx = self.context();
        let text = rec(pcm, true, &ctx).unwrap_or_default();
        let text = if is_hallucination(&text) { String::new() } else { text };
        let rest = self.agreement.finish(&words(&text));
        self.emit(rest, typer);
        self.buf.clear();
        self.last_len = 0;
        self.snapshot_ctx();
    }

    pub fn on_discard(&mut self) {
        self.buf.clear();
        self.last_len = 0;
        self.agreement.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Vec<String> {
        words(s)
    }

    #[test]
    fn nur_sichere_woerter() {
        let mut a = Agreement::default();
        assert!(a.partial(&w("Hallo wie")).is_empty()); // erster Durchgang: noch nichts sicher
        assert_eq!(a.partial(&w("Hallo, wie geht")), w("Hallo, wie")); // „Hallo wie“ zweimal gleich
        assert_eq!(a.partial(&w("Hallo, wie geht es dir")), w("geht"));
        assert_eq!(a.finish(&w("Hallo, wie geht es dir heute?")), w("es dir heute?"));
        assert_eq!(a.committed(), 0);
    }

    #[test]
    fn abweichung_wird_nicht_getippt() {
        let mut a = Agreement::default();
        a.partial(&w("Das ist ein Tisch"));
        assert_eq!(a.partial(&w("Das ist ein Test und")), w("Das ist ein"));
        // „Tisch“/„Test“ wurde nie getippt
        assert_eq!(a.finish(&w("Das ist ein Test und mehr.")), w("Test und mehr."));
    }

    #[test]
    fn endergebnis_weicht_ab() {
        let mut a = Agreement::default();
        a.partial(&w("Wir treffen uns am Montag"));
        assert_eq!(a.partial(&w("Wir treffen uns am Montag um")), w("Wir treffen uns am Montag"));
        // Endergebnis hat ein Wort anders – Rest trotzdem richtig
        assert_eq!(a.finish(&w("Wir treffen uns am Mondtag um zehn.")), w("um zehn."));
    }

    #[test]
    fn streamer_tippt_waehrend_des_sprechens() {
        let mut s = Streamer::new(true, vec![]);
        let mut typed: Vec<String> = Vec::new();
        let script = ["hallo äh das", "Hallo, äh, das ist", "Hallo, äh, das ist ein Test"];
        let mut i = 0;
        let mut rec = |pcm: &[i16], thorough: bool, ctx: &str| -> Result<String, String> {
            assert!(ctx.is_empty(), "Zusammenhang darf den aktuellen Satz nicht enthalten: {ctx}");
            if thorough {
                return Ok(format!("Hallo, das ist ein Test. ({})", pcm.len() / 16_000));
            }
            let t = script[i.min(2)].to_string();
            i += 1;
            Ok(t)
        };
        let mut ty = |t: &str| typed.push(t.to_string());
        s.on_start(vec![0; 8_000]);
        for _ in 0..4 {
            s.on_frame(&vec![1; 8_000], &mut rec, &mut ty);
        }
        let seg = vec![1; 40_000];
        s.on_segment(&seg, &mut rec, &mut ty);
        drop(ty);
        assert!(typed.len() >= 2, "{typed:?}");
        assert_eq!(s.inserted, "Hallo, das ist ein Test. (2)");
    }
}
