//! Textverarbeitung ohne KI: Sprachbefehle, Füllwörter, eigene Ersetzungen, typische
//! Erkennungs-„Halluzinationen“ bei Stille und das saubere Aneinanderhängen von Abschnitten.

use once_cell::sync::Lazy;
use regex::Regex;

static CMD_PARAGRAPH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\s*[,.]?\s*\b(neuer absatz|neuen absatz|new paragraph)\b[.,!]?\s*").unwrap()
});
static CMD_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\s*[,.]?\s*\b(neue zeile|nächste zeile|new line|next line)\b[.,!]?\s*")
        .unwrap()
});
static AFTER_NEWLINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n[ \t]*(\p{Ll})").unwrap());

/// „neuer Absatz“, „neue Zeile“ → Zeilenumbrüche; danach groß weiter
pub fn apply_voice_commands(text: &str) -> String {
    let out = CMD_PARAGRAPH.replace_all(text, "\n\n");
    let out = CMD_LINE.replace_all(&out, "\n");
    AFTER_NEWLINE
        .replace_all(&out, |c: &regex::Captures| {
            format!("\n{}", c[1].to_uppercase())
        })
        .into_owned()
}

const FILLERS_DE: &[&str] = &["äh", "ähm", "öh", "öhm", "hm", "hmm", "ähh", "ehm"];
const FILLERS_EN: &[&str] = &["uh", "um", "uhm", "umm", "erm", "hmm", "uh-huh"];

/// lang: de | en | auto (bei auto bleibt „um“ stehen – im Deutschen ein normales Wort)
pub fn remove_fillers(text: &str, lang: &str) -> String {
    let is_filler = |w: &str| -> bool {
        let de = FILLERS_DE.contains(&w);
        let en = FILLERS_EN.contains(&w);
        match lang {
            "de" => de,
            "en" => en,
            _ => de || (en && !w.starts_with("um")),
        }
    };
    let mut kept: Vec<String> = Vec::new();
    for token in text.split(' ') {
        let core: String = token
            .trim_matches(|c: char| ",.!?…".contains(c))
            .to_lowercase();
        if !core.is_empty() && is_filler(&core) {
            // Satzende-Zeichen des Füllworts an das vorige Wort hängen
            if let Some(end) = token.chars().last().filter(|c| ".!?…".contains(*c)) {
                if let Some(prev) = kept.last_mut() {
                    let trimmed = prev.trim_end_matches(',').to_string();
                    *prev = format!("{trimmed}{end}");
                }
            }
            continue;
        }
        kept.push(token.to_string());
    }
    let mut out = kept.join(" ");
    static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]{2,}").unwrap());
    static SPACE_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+([,.!?])").unwrap());
    static LEAD: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[\s,]+").unwrap());
    static COMMA_END: Lazy<Regex> = Lazy::new(|| Regex::new(r",\s*([.!?])").unwrap());
    out = SPACES.replace_all(&out, " ").into_owned();
    out = SPACE_PUNCT.replace_all(&out, "$1").into_owned();
    out = LEAD.replace_all(&out, "").into_owned();
    out = COMMA_END.replace_all(&out, "$1").into_owned();
    out.trim_end().to_string()
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, Default)]
pub struct Replacement {
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
}

/// Eigene Ersetzungen („mfg“ → „Mit freundlichen Grüßen“): ganze Wörter, ohne Groß/klein
pub fn apply_replacements(text: &str, rules: &[Replacement]) -> String {
    let mut out = text.to_string();
    for r in rules {
        let from = r.from.trim();
        if from.is_empty() {
            continue;
        }
        let re = match Regex::new(&format!("(?i){}", regex::escape(from))) {
            Ok(re) => re,
            Err(_) => continue,
        };
        let mut result = String::with_capacity(out.len());
        let mut last = 0;
        for m in re.find_iter(&out) {
            let before = out[..m.start()].chars().last();
            let after = out[m.end()..].chars().next();
            let boundary = |c: Option<char>| c.map_or(true, |c| !c.is_alphanumeric());
            if boundary(before) && boundary(after) {
                result.push_str(&out[last..m.start()]);
                result.push_str(&r.to);
                last = m.end();
            }
        }
        result.push_str(&out[last..]);
        out = result;
    }
    out
}

/// Sätze, die Whisper bei Stille oder Rauschen „hört“ (aus Untertitel-Trainingsdaten) – nur wenn sie alles sind
static HALLUCINATIONS: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"(?i)^untertitel(ung)? (im auftrag )?(des|der|von) .*$",
        r"(?i)^untertitel von .*$",
        r"(?i)^(vielen )?dank (fürs|für's|für das) zu(schauen|sehen|hören)[.!]*$",
        r"(?i)^bis zum nächsten mal[.!]*$",
        r"(?i)^thanks? (you )?for watching[.!]*$",
        r"(?i)^(please )?(like and )?subscribe[.!]*$",
        r"(?i)^subtitles by .*$",
        r"(?i)^amara\.org.*$",
        r"(?i)^you\.?$",
        r"(?i)^\[(musik|music|applaus|applause|stille|silence|blank_audio)\]$",
        r"(?i)^\((musik|music|applaus|applause|stille|silence)\)$",
        r"^[.…\s]+$",
    ]
    .iter()
    .map(|p| Regex::new(p).unwrap())
    .collect()
});

pub fn is_hallucination(text: &str) -> bool {
    let t = text.trim();
    t.is_empty() || HALLUCINATIONS.iter().any(|re| re.is_match(t))
}

pub fn tidy(text: &str) -> String {
    static TRAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]+\n").unwrap());
    static MANY_NL: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{3,}").unwrap());
    static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]{2,}").unwrap());
    let t = text.replace('\r', "");
    let t = TRAIL.replace_all(&t, "\n");
    let t = MANY_NL.replace_all(&t, "\n\n");
    let t = SPACES.replace_all(&t, " ");
    t.trim().to_string()
}

#[derive(Default, Clone)]
pub struct CleanupOpts<'a> {
    pub lang: &'a str,
    pub remove_fillers: bool,
    pub voice_commands: bool,
    pub replacements: &'a [Replacement],
}

/// Alle lokalen Schritte in der richtigen Reihenfolge
pub fn local_cleanup(text: &str, o: &CleanupOpts) -> String {
    let mut out = tidy(text);
    // Whisper markiert Nicht-Sprache manchmal in Klammern
    static TAGS: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)\[(blank_audio|musik|music|stille|silence|inaudible)\]|\((musik|music|stille|silence)\)").unwrap()
    });
    out = TAGS.replace_all(&out, "").into_owned();
    out = tidy(&out);
    if is_hallucination(&out) {
        return String::new();
    }
    if o.remove_fillers {
        out = remove_fillers(&out, if o.lang.is_empty() { "auto" } else { o.lang });
    }
    if o.voice_commands {
        out = apply_voice_commands(&out);
    }
    out = apply_replacements(&out, o.replacements);
    tidy(&out)
}

/// Hängt einen neuen Abschnitt an bereits geschriebenen Text an: Leerzeichen dazwischen, nach Satzende groß weiter.
pub fn join_segment(prev: &str, next: &str) -> String {
    if next.is_empty() {
        return String::new();
    }
    let at_start = prev.trim().is_empty()
        || prev.trim_end().ends_with(['.', '!', '?', '…', ':'])
        || prev.trim_end_matches([' ', '\t']).ends_with('\n');
    let mut n = next.to_string();
    if at_start {
        let lead = n.len() - n.trim_start().len();
        let mut chars = n[lead..].chars();
        if let Some(first) = chars.next() {
            if first.is_lowercase() {
                n = format!("{}{}{}", &n[..lead], first.to_uppercase(), chars.as_str());
            }
        }
    }
    let needs_space = !prev.is_empty()
        && !prev.ends_with(char::is_whitespace)
        && !n.starts_with(|c: char| c.is_whitespace() || ",.!?;:…)]".contains(c));
    if needs_space {
        format!(" {n}")
    } else {
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprachbefehle() {
        assert_eq!(
            apply_voice_commands("Hallo zusammen neuer Absatz wie geht es euch"),
            "Hallo zusammen\n\nWie geht es euch"
        );
        assert_eq!(
            apply_voice_commands("first line. New line. second line"),
            "first line\nSecond line"
        );
    }

    #[test]
    fn fuellwoerter() {
        assert_eq!(
            remove_fillers("Also äh ich wollte ähm sagen, dass", "de"),
            "Also ich wollte sagen, dass"
        );
        assert_eq!(remove_fillers("Äh, hallo.", "auto"), "hallo.");
        assert_eq!(
            remove_fillers("So um, I think uh yes", "en"),
            "So I think yes"
        );
        assert_eq!(remove_fillers("Er kommt um acht", "de"), "Er kommt um acht");
        assert_eq!(
            remove_fillers("Er kommt um acht äh.", "auto"),
            "Er kommt um acht."
        );
    }

    #[test]
    fn ersetzungen() {
        let r = vec![Replacement {
            from: "mfg".into(),
            to: "Mit freundlichen Grüßen".into(),
        }];
        assert_eq!(
            apply_replacements("Danke und MfG", &r),
            "Danke und Mit freundlichen Grüßen"
        );
        assert_eq!(apply_replacements("amfgx bleibt", &r), "amfgx bleibt");
    }

    #[test]
    fn halluzinationen() {
        assert!(is_hallucination("Untertitel im Auftrag des ZDF, 2020"));
        assert!(is_hallucination("Vielen Dank fürs Zuschauen!"));
        assert!(is_hallucination("you"));
        assert!(is_hallucination("[BLANK_AUDIO]"));
        assert!(!is_hallucination("Vielen Dank für deine Nachricht."));
        assert_eq!(
            local_cleanup(" [BLANK_AUDIO] ", &CleanupOpts::default()),
            ""
        );
    }

    #[test]
    fn aneinanderhaengen() {
        assert_eq!(join_segment("", "hallo"), "Hallo");
        assert_eq!(join_segment("Hallo.", "wie geht es"), " Wie geht es");
        assert_eq!(join_segment("Ich glaube", "dass es geht"), " dass es geht");
        assert_eq!(join_segment("Ich glaube ", ", dass"), ", dass");
        assert_eq!(join_segment("Zeile\n", "neu"), "Neu");
    }
}
