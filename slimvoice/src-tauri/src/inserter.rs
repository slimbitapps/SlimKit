//! Text dort einfügen, wo gerade der Cursor steht – in jeder App.
//! Über die Zwischenablage (Strg+V / ⌘V simulieren, danach alten Inhalt zurück) oder als Tastendrücke.
//! Mac: braucht die Freigabe „Bedienungshilfen“.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

pub struct Inserter {
    test_file: Option<PathBuf>,
    lock: Mutex<()>,
}

#[cfg(target_os = "macos")]
const MOD: Key = Key::Meta;
#[cfg(not(target_os = "macos"))]
const MOD: Key = Key::Control;

enum Saved {
    Text(String),
    Image(arboard::ImageData<'static>),
    Nothing,
}

impl Inserter {
    pub fn new() -> Self {
        Self {
            test_file: std::env::var("SLIMVOICE_OUTPUT")
                .ok()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
            lock: Mutex::new(()),
        }
    }

    fn shortcut(c: char) -> Result<(), String> {
        let mut e = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        e.key(MOD, Direction::Press).map_err(|e| e.to_string())?;
        let r = e
            .key(Key::Unicode(c), Direction::Click)
            .map_err(|e| e.to_string());
        e.key(MOD, Direction::Release).map_err(|e| e.to_string())?;
        r
    }

    fn save(cb: &mut arboard::Clipboard) -> Saved {
        if let Ok(t) = cb.get_text() {
            return Saved::Text(t);
        }
        if let Ok(img) = cb.get_image() {
            return Saved::Image(img.to_owned_img());
        }
        Saved::Nothing
    }

    fn restore(cb: &mut arboard::Clipboard, s: Saved) {
        let _ = match s {
            Saved::Text(t) => cb.set_text(t),
            Saved::Image(i) => cb.set_image(i),
            Saved::Nothing => cb.clear(),
        };
    }

    /// method: paste | type | copy. Blockiert kurz – im Hintergrund-Thread aufrufen.
    pub fn insert(&self, text: &str, method: &str, restore: bool) -> Result<(), String> {
        let _g = self.lock.lock().unwrap();
        if text.is_empty() {
            return Ok(());
        }
        if let Some(f) = &self.test_file {
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(f)
                .map_err(|e| e.to_string())?;
            return file.write_all(text.as_bytes()).map_err(|e| e.to_string());
        }
        // Finger von den Tasten des Kürzels runter lassen
        std::thread::sleep(Duration::from_millis(90));
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        match method {
            "copy" => cb.set_text(text.to_string()).map_err(|e| e.to_string()),
            "type" => {
                let mut e = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
                e.text(text).map_err(|e| e.to_string())
            }
            _ => {
                let saved = if restore {
                    Some(Self::save(&mut cb))
                } else {
                    None
                };
                cb.set_text(text.to_string()).map_err(|e| e.to_string())?;
                std::thread::sleep(Duration::from_millis(30));
                Self::shortcut('v')?;
                if let Some(s) = saved {
                    std::thread::sleep(Duration::from_millis(350));
                    if cb.get_text().map(|t| t == text).unwrap_or(false) {
                        Self::restore(&mut cb, s);
                    }
                }
                Ok(())
            }
        }
    }

    /// Markierten Text der App im Vordergrund holen (Strg+C / ⌘C). Leer = nichts markiert.
    pub fn copy_selection(&self) -> String {
        let _g = self.lock.lock().unwrap();
        if self.test_file.is_some() {
            return std::env::var("SLIMVOICE_SELECTION").unwrap_or_default();
        }
        let Ok(mut cb) = arboard::Clipboard::new() else {
            return String::new();
        };
        let saved = Self::save(&mut cb);
        let marker = format!(
            "\u{200b}slimvoice{}\u{200b}",
            chrono::Utc::now().timestamp_millis()
        );
        let _ = cb.set_text(marker.clone());
        std::thread::sleep(Duration::from_millis(150));
        if Self::shortcut('c').is_err() {
            Self::restore(&mut cb, saved);
            return String::new();
        }
        let mut text = String::new();
        for _ in 0..10 {
            std::thread::sleep(Duration::from_millis(50));
            text = cb.get_text().unwrap_or_default();
            if text != marker {
                break;
            }
        }
        Self::restore(&mut cb, saved);
        if text == marker {
            String::new()
        } else {
            text
        }
    }

    /// Name der App im Vordergrund, z. B. „Outlook“, „Slack“, „Code“
    pub fn foreground_app(&self) -> String {
        if self.test_file.is_some() {
            return std::env::var("SLIMVOICE_FG_APP").unwrap_or_default();
        }
        active_win_pos_rs::get_active_window()
            .map(|w| w.app_name)
            .unwrap_or_default()
    }
}

impl Default for Inserter {
    fn default() -> Self {
        Self::new()
    }
}
