//! Einstellungen, API-Schlüssel und Verlauf – als JSON-Dateien im Benutzerordner der App.
//! Schreibt sicher (erst Temp-Datei, dann umbenennen).

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn defaults() -> Value {
    json!({
        "version": 4,
        "onboarded": false,
        "wizardStep": 0,
        "ui": { "lang": "", "theme": "system", "mode": "simple" },
        // toggle: Halten = sprechen, Tippen = freihändig · command: Befehlsmodus für markierten Text
        "hotkey": {
            "toggle": if cfg!(target_os = "macos") { "Alt+Space" } else { "Control+Shift+Space" },
            "cancel": "",
            "command": if cfg!(target_os = "macos") { "Alt+Shift+Space" } else { "Alt+Shift+Space" }
        },
        "dictation": {
            "mode": "preview", "tempo": "balanced", "language": "auto", "pauseMs": 0, "sensitivity": 50,
            "micId": "", "maxMinutes": 15, "sounds": true, "overlay": "bottom",
            "insert": "paste", "restoreClipboard": true, "trailingSpace": true
        },
        "ai": {
            "level": "off", "style": "neutral", "removeFillers": true, "voiceCommands": true, "translateTo": "",
            "customInstruction": "", "vocabulary": [], "replacements": [], "profiles": [], "useContext": true
        },
        "services": {
            "stt": { "provider": "local", "model": "", "fastModel": "", "baseUrl": "" },
            "llm": { "provider": "auto", "model": "", "baseUrl": "" },
            "local": { "model": "small", "ready": {}, "keepLoadedMin": 15, "gpu": false }
        },
        "history": { "keep": true, "max": 200 },
        "autostart": false,
        "seenApps": []
    })
}

/// Gespeicherte Werte über die Standardwerte legen (fehlende Felder bleiben Standard)
pub fn merge(base: &Value, over: &Value) -> Value {
    match (base, over) {
        (Value::Object(b), Value::Object(o)) => {
            let mut out = b.clone();
            for (k, v) in o {
                let merged = match out.get(k) {
                    Some(bv @ Value::Object(_)) if v.is_object() => merge(bv, v),
                    _ => v.clone(),
                };
                out.insert(k.clone(), merged);
            }
            Value::Object(out)
        }
        (_, Value::Null) => base.clone(),
        _ => over.clone(),
    }
}

pub fn read_json(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn write_json(path: &Path, v: &Value) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

pub struct Settings {
    path: PathBuf,
    pub data: Value,
}

impl Settings {
    pub fn load(path: PathBuf) -> Self {
        let saved = read_json(&path).unwrap_or(Value::Null);
        let mut data = merge(&defaults(), &saved);
        // Version 4: lokal standardmäßig auf dem Prozessor rechnen (Metal-Grafik war beim Start langsam + laut)
        if saved.get("version").and_then(|v| v.as_u64()).unwrap_or(0) < 4 {
            data["services"]["local"]["gpu"] = Value::Bool(false);
            data["version"] = Value::from(4);
            if data["services"]["local"]["model"] == "turbo" {
                data["services"]["local"]["model"] = Value::from("small");
            }
        }
        Self { data, path }
    }
    pub fn update(&mut self, partial: &Value) {
        self.data = merge(&self.data, partial);
        write_json(&self.path, &self.data);
    }
    pub fn str(&self, ptr: &str) -> String {
        self.data
            .pointer(ptr)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }
}

/// Einfache Lesehilfen für einen Einstellungs-Schnappschuss
pub trait Get {
    fn s(&self, ptr: &str) -> String;
    fn b(&self, ptr: &str) -> bool;
    fn n(&self, ptr: &str) -> f64;
    fn list(&self, ptr: &str) -> Vec<String>;
}
impl Get for Value {
    fn s(&self, ptr: &str) -> String {
        self.pointer(ptr)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }
    fn b(&self, ptr: &str) -> bool {
        self.pointer(ptr).and_then(|v| v.as_bool()).unwrap_or(false)
    }
    fn n(&self, ptr: &str) -> f64 {
        self.pointer(ptr).and_then(|v| v.as_f64()).unwrap_or(0.0)
    }
    fn list(&self, ptr: &str) -> Vec<String> {
        self.pointer(ptr)
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// API-Schlüssel: liegen in einer eigenen Datei im Benutzerordner, verschleiert (nicht im Klartext).
/// Bewusst nicht im Schlüsselbund: unsignierte Testversionen würden sonst bei jedem Update nachfragen.
pub struct Secrets {
    path: PathBuf,
    raw: Value,
}

fn obfuscate(data: &[u8]) -> Vec<u8> {
    let key = b"SlimBit-Apps/SlimVoice-local-key";
    data.iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect()
}

impl Secrets {
    pub fn load(path: PathBuf) -> Self {
        let raw = read_json(&path).unwrap_or(json!({}));
        Self { path, raw }
    }
    pub fn get(&self, name: &str) -> String {
        use base64::Engine;
        let Some(v) = self.raw.get(name).and_then(|v| v.as_str()) else {
            return String::new();
        };
        base64::engine::general_purpose::STANDARD
            .decode(v)
            .ok()
            .and_then(|b| String::from_utf8(obfuscate(&b)).ok())
            .unwrap_or_default()
    }
    pub fn set(&mut self, name: &str, value: &str) {
        use base64::Engine;
        let v = value.trim();
        if let Value::Object(m) = &mut self.raw {
            if v.is_empty() {
                m.remove(name);
            } else {
                m.insert(
                    name.into(),
                    Value::String(
                        base64::engine::general_purpose::STANDARD.encode(obfuscate(v.as_bytes())),
                    ),
                );
            }
        }
        write_json(&self.path, &self.raw);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
        }
    }
    /// Nur ob ein Schlüssel da ist und die letzten 4 Zeichen – nie den Schlüssel selbst an die Oberfläche
    pub fn summary(&self) -> Value {
        let mut keys = serde_json::Map::new();
        if let Value::Object(m) = &self.raw {
            for name in m.keys() {
                let v = self.get(name);
                if !v.is_empty() {
                    let hint = if v.chars().count() > 8 {
                        format!(
                            "…{}",
                            v.chars()
                                .rev()
                                .take(4)
                                .collect::<Vec<_>>()
                                .into_iter()
                                .rev()
                                .collect::<String>()
                        )
                    } else {
                        String::new()
                    };
                    keys.insert(name.clone(), json!({ "set": true, "hint": hint }));
                }
            }
        }
        json!({ "keys": keys, "encrypted": false })
    }
}

/// Verlauf der letzten Diktate (bleibt lokal)
pub struct History {
    path: PathBuf,
    pub items: Vec<Value>,
}

impl History {
    pub fn load(path: PathBuf) -> Self {
        let items = read_json(&path)
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        Self { path, items }
    }
    pub fn add(&mut self, mut entry: Value, max: usize) -> Value {
        let id = format!(
            "{:x}{:04x}",
            chrono::Utc::now().timestamp_millis(),
            rand::random::<u16>()
        );
        entry["id"] = json!(id);
        entry["at"] = json!(chrono::Utc::now().to_rfc3339());
        self.items.insert(0, entry.clone());
        self.items.truncate(max.max(1));
        self.save();
        entry
    }
    pub fn remove(&mut self, id: &str) {
        self.items.retain(|i| i["id"] != id);
        self.save();
    }
    pub fn clear(&mut self) {
        self.items.clear();
        self.save();
    }
    fn save(&self) {
        write_json(&self.path, &Value::Array(self.items.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standardwerte_zusammenfuehren() {
        let s = merge(
            &defaults(),
            &json!({ "dictation": { "mode": "live" }, "unknown": 1 }),
        );
        assert_eq!(s.s("/dictation/mode"), "live");
        assert_eq!(s.s("/dictation/tempo"), "balanced");
        assert_eq!(s.s("/services/stt/provider"), "local");
    }

    #[test]
    fn schluessel_verschleiert() {
        let dir = std::env::temp_dir().join(format!("sv-{}", rand::random::<u32>()));
        let path = dir.join("secrets.json");
        let mut s = Secrets::load(path.clone());
        s.set("openai", "sk-1234567890abcd");
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("sk-1234567890abcd"));
        assert_eq!(
            Secrets::load(path.clone()).get("openai"),
            "sk-1234567890abcd"
        );
        assert_eq!(s.summary()["keys"]["openai"]["hint"], "…abcd");
        s.set("openai", "");
        assert_eq!(s.get("openai"), "");
    }
}
