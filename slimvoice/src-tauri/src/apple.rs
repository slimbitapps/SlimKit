//! Apples eingebaute Spracherkennung (nur Mac) – dieselbe Technik wie das Mac-Diktat:
//! läuft auf dem Gerät, ist sehr schnell und versteht auch leises Sprechen.
//! Auf anderen Systemen gibt es nur Platzhalter, die „nicht verfügbar“ melden.

use std::sync::mpsc::{channel, Receiver};
#[cfg(target_os = "macos")]
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

pub enum Event {
    Partial(String),
    Final(String),
    Error(String),
}

#[cfg(target_os = "macos")]
mod ffi {
    use std::os::raw::{c_char, c_void};
    pub type Callback = extern "C" fn(*mut c_void, i32, *const c_char);
    extern "C" {
        pub fn sv_apple_status() -> i32;
        pub fn sv_apple_request() -> i32;
        pub fn sv_apple_available(lang: *const c_char) -> i32;
        pub fn sv_apple_start(lang: *const c_char, hints: *const c_char, allow_server: i32, user: *mut c_void, cb: Callback) -> *mut c_void;
        pub fn sv_apple_feed(s: *mut c_void, pcm: *const i16, n: i32);
        pub fn sv_apple_finish(s: *mut c_void);
        pub fn sv_apple_free(s: *mut c_void);
    }
}

/// Berechtigung: 0 = noch nicht gefragt, 1 = abgelehnt, 2 = eingeschränkt, 3 = erlaubt, -1 = kein Mac
pub fn status() -> i32 {
    #[cfg(target_os = "macos")]
    unsafe {
        return ffi::sv_apple_status();
    }
    #[allow(unreachable_code)]
    -1
}

/// Systemdialog „Spracherkennung erlauben?“ – blockiert, bis geantwortet wurde
pub fn request() -> i32 {
    #[cfg(target_os = "macos")]
    unsafe {
        return ffi::sv_apple_request();
    }
    #[allow(unreachable_code)]
    -1
}

/// 0 = Sprache nicht verfügbar, 1 = nur online bei Apple, 2 = direkt auf dem Gerät
pub fn available(lang: &str) -> i32 {
    #[cfg(target_os = "macos")]
    {
        let l = std::ffi::CString::new(lang).unwrap_or_default();
        return unsafe { ffi::sv_apple_available(l.as_ptr()) };
    }
    #[allow(unreachable_code)]
    {
        let _ = lang;
        0
    }
}

pub struct Session {
    #[cfg(target_os = "macos")]
    ptr: *mut std::os::raw::c_void,
    /// gehört dem Rückruf; wird erst nach sv_apple_free freigegeben
    #[cfg(target_os = "macos")]
    user: *mut Sender<Event>,
    rx: Receiver<Event>,
    finished: bool,
}

// Zeiger werden nur über die thread-sicheren Swift-Funktionen benutzt
unsafe impl Send for Session {}

#[cfg(target_os = "macos")]
extern "C" fn on_event(user: *mut std::os::raw::c_void, kind: i32, text: *const std::os::raw::c_char) {
    if user.is_null() {
        return;
    }
    let tx = unsafe { &*(user as *const Sender<Event>) };
    let t = if text.is_null() { String::new() } else { unsafe { std::ffi::CStr::from_ptr(text) }.to_string_lossy().to_string() };
    let _ = tx.send(match kind {
        0 => Event::Partial(t),
        1 => Event::Final(t),
        _ => Event::Error(t),
    });
}

impl Session {
    /// Startet eine Erkennung. hints = Fachwörter, die Apple bevorzugen soll.
    pub fn start(lang: &str, hints: &[String]) -> Result<Self, String> {
        let (tx, rx) = channel::<Event>();
        #[cfg(target_os = "macos")]
        {
            let l = std::ffi::CString::new(lang).unwrap_or_default();
            let h = std::ffi::CString::new(hints.join("\n").replace('\0', "")).unwrap_or_default();
            let user = Box::into_raw(Box::new(tx));
            let ptr = unsafe { ffi::sv_apple_start(l.as_ptr(), h.as_ptr(), 0, user as *mut _, on_event) };
            if ptr.is_null() {
                drop(unsafe { Box::from_raw(user) });
                return Err("apple_unavailable".into());
            }
            return Ok(Self { ptr, user, rx, finished: false });
        }
        #[allow(unreachable_code)]
        {
            let _ = (lang, hints, tx, rx);
            Err("apple_unavailable".into())
        }
    }

    pub fn feed(&self, pcm: &[i16]) {
        #[cfg(target_os = "macos")]
        if !pcm.is_empty() && !self.finished {
            unsafe { ffi::sv_apple_feed(self.ptr, pcm.as_ptr(), pcm.len() as i32) };
        }
        #[cfg(not(target_os = "macos"))]
        let _ = pcm;
    }

    /// Neuestes Zwischenergebnis seit dem letzten Aufruf (falls es eins gibt)
    pub fn latest_partial(&self) -> Option<String> {
        let mut last = None;
        while let Ok(ev) = self.rx.try_recv() {
            match ev {
                Event::Partial(t) | Event::Final(t) => last = Some(t),
                Event::Error(_) => {}
            }
        }
        last
    }

    /// Audio ist zu Ende → auf das Endergebnis warten
    pub fn finish(mut self, timeout: Duration) -> Result<String, String> {
        #[cfg(target_os = "macos")]
        unsafe {
            ffi::sv_apple_finish(self.ptr)
        };
        self.finished = true;
        let until = Instant::now() + timeout;
        let mut last = String::new();
        loop {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                // lieber das letzte Zwischenergebnis als gar nichts
                return if last.is_empty() { Err("apple_timeout".into()) } else { Ok(last) };
            }
            match self.rx.recv_timeout(left) {
                Ok(Event::Partial(t)) => last = t,
                Ok(Event::Final(t)) => return Ok(if t.is_empty() { last } else { t }),
                Ok(Event::Error(e)) => return if last.is_empty() { Err(e) } else { Ok(last) },
                Err(_) => return if last.is_empty() { Err("apple_timeout".into()) } else { Ok(last) },
            }
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        unsafe {
            ffi::sv_apple_free(self.ptr);
            drop(Box::from_raw(self.user));
        }
    }
}

/// Ganze Aufnahme auf einmal erkennen (für „Erst aufnehmen“, „Sofort einfügen“ …)
pub fn transcribe(pcm: &[i16], lang: &str, hints: &[String]) -> Result<String, String> {
    let s = Session::start(lang, hints)?;
    for chunk in pcm.chunks(16_000) {
        s.feed(chunk);
    }
    let secs = pcm.len() as u64 / 16_000;
    s.finish(Duration::from_secs(10 + secs))
}
