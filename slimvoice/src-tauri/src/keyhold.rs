//! Ein Tastenkürzel, zwei Arten:
//!  Halten  → Diktat läuft, solange die Tasten gedrückt sind (Push-to-talk)
//!  Tippen  → freihändig: Diktat läuft weiter (du kannst nebenher tippen), nochmal drücken = fertig
//! Die Aufnahme startet sofort beim Drücken – so geht kein Wort am Anfang verloren.

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Start,
    Stop,
    None,
}

pub struct KeyHold {
    pub hold_ms: u64,
    down: bool,
    started_at: u64,
    ours: bool,
    hands_free: bool,
}

impl KeyHold {
    pub fn new(hold_ms: u64) -> Self {
        Self {
            hold_ms,
            down: false,
            started_at: 0,
            ours: false,
            hands_free: false,
        }
    }

    pub fn pressed(&mut self, now: u64, recording: bool) -> Action {
        if self.down {
            return Action::None; // Tastenwiederholung
        }
        self.down = true;
        if recording {
            // läuft schon (freihändig oder über Menü/Knopf gestartet) → beenden
            self.ours = false;
            self.hands_free = false;
            return Action::Stop;
        }
        self.started_at = now;
        self.ours = true;
        self.hands_free = false;
        Action::Start
    }

    pub fn released(&mut self, now: u64, recording: bool) -> Action {
        if !self.down {
            return Action::None;
        }
        self.down = false;
        if !self.ours || !recording {
            self.ours = false;
            return Action::None;
        }
        if now.saturating_sub(self.started_at) < self.hold_ms {
            // nur kurz getippt → freihändig weiter
            self.hands_free = true;
            return Action::None;
        }
        self.ours = false;
        Action::Stop
    }

    /// Tasten des Kürzels gerade gedrückt?
    pub fn is_down(&self) -> bool {
        self.down
    }

    pub fn is_hands_free(&self) -> bool {
        self.hands_free
    }

    pub fn reset(&mut self) {
        self.down = false;
        self.ours = false;
        self.hands_free = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halten_ist_push_to_talk() {
        let mut k = KeyHold::new(350);
        assert_eq!(k.pressed(0, false), Action::Start);
        assert_eq!(k.pressed(100, true), Action::None); // Wiederholung
        assert_eq!(k.released(2000, true), Action::Stop);
    }

    #[test]
    fn tippen_ist_freihaendig() {
        let mut k = KeyHold::new(350);
        assert_eq!(k.pressed(0, false), Action::Start);
        assert_eq!(k.released(120, true), Action::None);
        assert!(k.is_hands_free());
        assert_eq!(k.pressed(5000, true), Action::Stop);
        assert_eq!(k.released(5100, false), Action::None);
    }

    #[test]
    fn anders_gestartet_dann_druecken_beendet() {
        let mut k = KeyHold::new(350);
        assert_eq!(k.pressed(0, true), Action::Stop);
        assert_eq!(k.released(50, false), Action::None);
    }
}
