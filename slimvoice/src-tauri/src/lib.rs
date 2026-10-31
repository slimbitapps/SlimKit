//! SlimVoice – Diktieren, das wirklich funktioniert. Läuft im Infobereich (Windows) bzw. in der Menüleiste (Mac).
//! Ein Tastenkürzel: halten = sprechen, kurz tippen = freihändig. Die kleine Anzeige nimmt nie den Fokus –
//! der Text landet dort, wo der Cursor steht, und man kann währenddessen weitertippen.

pub mod audio;
pub mod inserter;
pub mod keyhold;
pub mod local;
pub mod prompts;
pub mod providers;
pub mod session;
pub mod store;
pub mod text;
pub mod vad;
pub mod wav;

mod control;

use once_cell::sync::OnceCell;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use store::Get;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const WEBSITE: &str = "https://slimbitapps.github.io/";

pub fn is_test() -> bool {
    std::env::var("SLIMVOICE_TEST")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

// ------------------------------------------------------------------ Zustand
pub struct Rec {
    pub recording: bool,
    pub id: u64,
    pub session: Option<Arc<session::Session>>,
    recorder: Option<audio::Recorder>,
    command: Option<CommandCtx>,
    pub app_name: String,
    started: Option<Instant>,
}

#[derive(Clone)]
struct CommandCtx {
    selection: String,
}

pub struct State {
    pub handle: AppHandle,
    pub dir: PathBuf,
    pub settings: Mutex<store::Settings>,
    secrets: Mutex<store::Secrets>,
    pub history: Mutex<store::History>,
    pub engine: Arc<local::Engine>,
    inserter: Arc<inserter::Inserter>,
    pub rec: Mutex<Rec>,
    hold: Mutex<keyhold::KeyHold>,
    shortcuts: Mutex<HashMap<u32, &'static str>>,
    hotkey_ok: Mutex<Value>,
    last_text: Mutex<String>,
    download: Mutex<Value>,
    unload_gen: AtomicU64,
    mic_test: Mutex<Option<audio::Recorder>>,
    last_access: AtomicBool,
}

static STATE: OnceCell<Arc<State>> = OnceCell::new();
pub fn st() -> &'static Arc<State> {
    STATE.get().expect("state")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn log(msg: impl AsRef<str>) {
    if let Some(s) = STATE.get() {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(s.dir.join("app.log"))
        {
            let _ = writeln!(f, "[{}] {}", chrono::Utc::now().to_rfc3339(), msg.as_ref());
        }
    }
}

fn ui_lang() -> &'static str {
    let l = st().settings.lock().unwrap().str("/ui/lang");
    if l == "de" || l == "en" {
        return if l == "de" { "de" } else { "en" };
    }
    if sys_locale::get_locale()
        .unwrap_or_default()
        .starts_with("de")
    {
        "de"
    } else {
        "en"
    }
}
fn tr(de: &'static str, en: &'static str) -> &'static str {
    if ui_lang() == "de" {
        de
    } else {
        en
    }
}

// ------------------------------------------------------------------ Mac-Freigabe „Bedienungshilfen“
pub fn accessibility_ok() -> bool {
    #[cfg(target_os = "macos")]
    {
        if is_test() {
            return true;
        }
        macos_accessibility_client::accessibility::application_is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

// ------------------------------------------------------------------ Modelle / Dienste
struct Resolved {
    stt_provider: String,
    models: session::Models,
    llm_provider: String,
}

fn has_key(p: &str) -> bool {
    providers::llm_info(p)
        .map(|i| i.key_optional)
        .unwrap_or(false)
        || !st().secrets.lock().unwrap().get(p).is_empty()
}

/// „auto“: derselbe Dienst wie die Spracherkennung, sonst der erste mit Schlüssel
fn resolve_llm(cfg: &Value) -> String {
    let p = cfg.s("/services/llm/provider");
    if !p.is_empty() && p != "auto" && p != "same" {
        return p;
    }
    let stt = cfg.s("/services/stt/provider");
    if providers::llm_info(&stt).is_some() && stt != "custom" && has_key(&stt) {
        return stt;
    }
    ["groq", "openai", "gemini", "anthropic"]
        .iter()
        .find(|k| has_key(k))
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn resolve(cfg: &Value) -> Resolved {
    let tempo = providers::tempo_idx(&cfg.s("/dictation/tempo"));
    let stt = cfg.s("/services/stt/provider");
    let llm_provider = resolve_llm(cfg);
    let llm_model = providers::llm_info(&llm_provider)
        .map(|i| {
            let m = cfg.s("/services/llm/model");
            if m.is_empty() {
                i.main[tempo].to_string()
            } else {
                m
            }
        })
        .unwrap_or_default();
    if stt == "local" || providers::stt_info(&stt).is_none() {
        let key = local::model(&cfg.s("/services/local/model"))
            .key
            .to_string();
        return Resolved {
            stt_provider: "local".into(),
            models: session::Models {
                stt_main: key.clone(),
                stt_preview: key,
                max_seconds: 1800,
                llm_model,
                pipeline: true,
            },
            llm_provider,
        };
    }
    let info = providers::stt_info(&stt).unwrap();
    let pick = |ptr: &str, def: &str| {
        let v = cfg.s(ptr);
        if v.is_empty() {
            def.to_string()
        } else {
            v
        }
    };
    Resolved {
        stt_provider: stt,
        models: session::Models {
            stt_main: pick("/services/stt/model", info.main[tempo]),
            stt_preview: pick("/services/stt/fastModel", info.preview),
            max_seconds: info.max_seconds,
            llm_model,
            pipeline: false,
        },
        llm_provider,
    }
}

fn local_ready(cfg: &Value) -> bool {
    let key = local::model(&cfg.s("/services/local/model")).key;
    st().engine.is_downloaded(key)
}

// ------------------------------------------------------------------ Anzeige (Overlay)
fn overlay_event(ev: Value) {
    let _ = st().handle.emit_to("overlay", "ui:event", ev);
}

fn create_overlay(app: &AppHandle) {
    if app.get_webview_window("overlay").is_some() {
        return;
    }
    let w = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("SlimVoice")
        .inner_size(460.0, 168.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .visible(false)
        .build();
    if let Err(e) = w {
        log(format!("overlay: {e}"));
    }
}

fn show_overlay() {
    let app = &st().handle;
    let Some(w) = app.get_webview_window("overlay") else {
        return;
    };
    let top = st().settings.lock().unwrap().str("/dictation/overlay") == "top";
    if let Ok(pos) = app.cursor_position() {
        if let Ok(Some(m)) = app.monitor_from_point(pos.x, pos.y) {
            let wa = m.work_area();
            let scale = m.scale_factor();
            let (w_px, h_px) = ((460.0 * scale) as i32, (168.0 * scale) as i32);
            let x = wa.position.x + (wa.size.width as i32 - w_px) / 2;
            let y = if top {
                wa.position.y + (12.0 * scale) as i32
            } else {
                wa.position.y + wa.size.height as i32 - h_px - (12.0 * scale) as i32
            };
            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    let _ = w.show();
}

fn hide_overlay_soon(ms: u64) {
    let id = st().rec.lock().unwrap().id;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        let r = st().rec.lock().unwrap();
        if !r.recording && r.id == id {
            if let Some(w) = st().handle.get_webview_window("overlay") {
                let _ = w.hide();
            }
            let _ = st().handle.emit_to("overlay", "ui:hidden", ());
        }
    });
}

// ------------------------------------------------------------------ Einstellungsfenster
pub fn show_settings(page: Option<&str>) {
    let app = &st().handle;
    if let Some(w) = app.get_webview_window("main") {
        if let Some(p) = page {
            let _ = app.emit_to("main", "nav", p);
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let url = match page {
        Some(p) => format!("index.html?page={p}"),
        None => "index.html".into(),
    };
    let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
        .title("SlimVoice")
        .inner_size(980.0, 720.0)
        .min_inner_size(780.0, 560.0)
        .center()
        .build();
    match w {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) => log(format!("settings window: {e}")),
    }
}

fn settings_changed() {
    let _ = st().handle.emit_to("main", "settings:changed", ());
    update_tray();
}

// ------------------------------------------------------------------ Infobereich / Menüleiste
fn tray_icon(recording: bool) -> tauri::image::Image<'static> {
    #[cfg(target_os = "macos")]
    let bytes: &'static [u8] = if recording {
        include_bytes!("../icons/trayRecTemplate@2x.png")
    } else {
        include_bytes!("../icons/trayTemplate@2x.png")
    };
    #[cfg(not(target_os = "macos"))]
    let bytes: &'static [u8] = if recording {
        include_bytes!("../icons/tray-rec.png")
    } else {
        include_bytes!("../icons/tray.png")
    };
    tauri::image::Image::from_bytes(bytes).expect("tray icon")
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let s = st();
    let cfg = s.settings.lock().unwrap().data.clone();
    let recording = s.rec.lock().unwrap().recording;
    let start = MenuItem::with_id(
        app,
        "toggle",
        if recording {
            tr("Diktat beenden", "Stop dictation")
        } else {
            tr("Diktat starten", "Start dictation")
        },
        true,
        None::<&str>,
    )?;
    let cancel = MenuItem::with_id(
        app,
        "cancel",
        tr("Diktat abbrechen", "Cancel dictation"),
        recording,
        None::<&str>,
    )?;
    let radio = |prefix: &str,
                 cur: &str,
                 items: &[(&str, &str, &str)]|
     -> tauri::Result<Vec<CheckMenuItem<tauri::Wry>>> {
        items
            .iter()
            .map(|(v, de, en)| {
                CheckMenuItem::with_id(
                    app,
                    format!("{prefix}:{v}"),
                    if ui_lang() == "de" { *de } else { *en },
                    true,
                    cur == *v,
                    None::<&str>,
                )
            })
            .collect()
    };
    let modes = radio(
        "mode",
        &cfg.s("/dictation/mode"),
        &[
            ("live", "Sofort einfügen", "Insert right away"),
            ("preview", "Live-Vorschau", "Live preview"),
            ("batch", "Erst aufnehmen", "Record first"),
        ],
    )?;
    let levels = radio(
        "ai",
        &cfg.s("/ai/level"),
        &[
            ("off", "Aus", "Off"),
            ("punct", "Nur Satzzeichen", "Punctuation only"),
            ("light", "Leicht", "Light"),
            ("strong", "Stark", "Strong"),
        ],
    )?;
    let mode_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = modes
        .iter()
        .map(|m| m as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let level_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = levels
        .iter()
        .map(|m| m as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let mode_menu = Submenu::with_items(app, tr("Modus", "Mode"), true, &mode_refs)?;
    let ai_menu = Submenu::with_items(app, tr("KI-Korrektur", "AI correction"), true, &level_refs)?;
    let has_last =
        !s.last_text.lock().unwrap().is_empty() || !s.history.lock().unwrap().items.is_empty();
    let copy = MenuItem::with_id(
        app,
        "copy_last",
        tr("Letztes Diktat kopieren", "Copy last dictation"),
        has_last,
        None::<&str>,
    )?;
    let history = MenuItem::with_id(
        app,
        "history",
        tr("Verlauf …", "History …"),
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        "settings",
        tr("Einstellungen …", "Settings …"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        tr("SlimVoice beenden", "Quit SlimVoice"),
        true,
        None::<&str>,
    )?;
    Menu::with_items(
        app,
        &[
            &start,
            &cancel,
            &PredefinedMenuItem::separator(app)?,
            &mode_menu,
            &ai_menu,
            &PredefinedMenuItem::separator(app)?,
            &copy,
            &history,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn update_tray() {
    let app = st().handle.clone();
    let recording = st().rec.lock().unwrap().recording;
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(tray) = app2.tray_by_id("main") {
            if let Ok(menu) = build_menu(&app2) {
                let _ = tray.set_menu(Some(menu));
            }
            let _ = tray.set_icon(Some(tray_icon(recording)));
            #[cfg(target_os = "macos")]
            let _ = tray.set_icon_as_template(true);
            let key = st().settings.lock().unwrap().str("/hotkey/toggle");
            let _ = tray.set_tooltip(Some(format!("SlimVoice – {key}")));
        }
    });
}

fn on_menu(id: &str) {
    match id {
        "toggle" => toggle_dictation(StartOpts::default()),
        "cancel" => cancel_dictation(),
        "copy_last" => {
            let t = {
                let l = st().last_text.lock().unwrap().clone();
                if l.is_empty() {
                    st().history
                        .lock()
                        .unwrap()
                        .items
                        .first()
                        .and_then(|i| i["text"].as_str().map(|s| s.to_string()))
                        .unwrap_or_default()
                } else {
                    l
                }
            };
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(t.trim().to_string());
            }
        }
        "history" => show_settings(Some("history")),
        "settings" => show_settings(None),
        "quit" => st().handle.exit(0),
        other => {
            if let Some((group, v)) = other.split_once(':') {
                let partial = match group {
                    "mode" => json!({ "dictation": { "mode": v } }),
                    "ai" => json!({ "ai": { "level": v } }),
                    _ => return,
                };
                st().settings.lock().unwrap().update(&partial);
                settings_changed();
            }
        }
    }
}

// ------------------------------------------------------------------ Tastenkürzel
fn register_shortcuts() -> Value {
    let app = &st().handle;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut map = st().shortcuts.lock().unwrap();
    map.clear();
    let cfg = st().settings.lock().unwrap().data.clone();
    let mut ok = serde_json::Map::new();
    for (kind, ptr) in [
        ("toggle", "/hotkey/toggle"),
        ("command", "/hotkey/command"),
        ("cancel", "/hotkey/cancel"),
    ] {
        let accel = cfg.s(ptr);
        if accel.is_empty() {
            ok.insert(kind.into(), json!(true));
            continue;
        }
        let res = accel
            .parse::<Shortcut>()
            .map_err(|e| e.to_string())
            .and_then(|sc| {
                map.insert(sc.id(), kind);
                gs.register(sc).map_err(|e| e.to_string())
            });
        if let Err(e) = &res {
            log(format!("hotkey {kind} {accel}: {e}"));
        }
        ok.insert(kind.into(), json!(res.is_ok()));
    }
    let v = Value::Object(ok);
    *st().hotkey_ok.lock().unwrap() = v.clone();
    v
}

pub fn hold_pressed(now: u64, recording: bool) -> keyhold::Action {
    let a = st().hold.lock().unwrap().pressed(now, recording);
    match a {
        keyhold::Action::Start => start_dictation(StartOpts {
            how: "hold".into(),
            command: false,
        }),
        keyhold::Action::Stop => stop_dictation(),
        keyhold::Action::None => {}
    }
    a
}

pub fn hold_released(now: u64, recording: bool) -> keyhold::Action {
    let a = st().hold.lock().unwrap().released(now, recording);
    if a == keyhold::Action::Stop {
        stop_dictation();
    } else if st().hold.lock().unwrap().is_hands_free() && recording {
        let id = st().rec.lock().unwrap().id;
        overlay_event(json!({ "id": id, "type": "handsfree" }));
    }
    a
}

fn on_shortcut(sc: &Shortcut, state: ShortcutState) {
    let kind = st().shortcuts.lock().unwrap().get(&sc.id()).copied();
    let recording = st().rec.lock().unwrap().recording;
    match (kind, state) {
        (Some("toggle"), ShortcutState::Pressed) => {
            hold_pressed(now_ms(), recording);
        }
        (Some("toggle"), ShortcutState::Released) => {
            hold_released(now_ms(), recording);
        }
        (Some("command"), ShortcutState::Pressed) => toggle_dictation(StartOpts {
            how: "hotkey".into(),
            command: true,
        }),
        (Some("cancel"), ShortcutState::Pressed) => {
            if recording {
                cancel_dictation()
            }
        }
        _ => {}
    }
}

// ------------------------------------------------------------------ Diktat
#[derive(Default, Clone)]
pub struct StartOpts {
    pub how: String,
    pub command: bool,
}

pub fn toggle_dictation(o: StartOpts) {
    if st().rec.lock().unwrap().recording {
        stop_dictation();
    } else {
        start_dictation(o);
    }
}

fn error_and_reset(id: u64, ev: Value) {
    {
        let mut r = st().rec.lock().unwrap();
        r.recording = false;
    }
    st().hold.lock().unwrap().reset();
    update_tray();
    let mut ev = ev;
    ev["id"] = json!(id);
    ev["type"] = json!("error");
    overlay_event(ev);
}

pub fn start_dictation(o: StartOpts) {
    let s = st();
    let id = {
        let mut r = s.rec.lock().unwrap();
        if r.recording {
            return;
        }
        r.recording = true;
        r.id += 1;
        r.started = Some(Instant::now());
        r.id
    };
    clear_unload();
    update_tray();
    let cfg = s.settings.lock().unwrap().data.clone();
    let res = resolve(&cfg);
    let lang = ui_lang();
    let hotkey = if o.command {
        cfg.s("/hotkey/command")
    } else {
        cfg.s("/hotkey/toggle")
    };
    show_overlay();
    let _ = s.handle.emit_to(
        "overlay",
        "rec:start",
        json!({
            "id": id, "lang": lang, "mode": if o.command { "batch".to_string() } else { cfg.s("/dictation/mode") },
            "position": cfg.s("/dictation/overlay"), "sounds": cfg.b("/dictation/sounds"), "hotkey": hotkey,
            "how": if o.how.is_empty() { "hotkey" } else { &o.how }, "command": if o.command { "pending" } else { "" },
        }),
    );

    // Startklar?
    if res.stt_provider == "local" {
        if !local_ready(&cfg) {
            return error_and_reset(id, json!({ "code": "local_missing" }));
        }
    } else if !providers::stt_info(&res.stt_provider)
        .map(|i| i.key_optional)
        .unwrap_or(false)
        && s.secrets.lock().unwrap().get(&res.stt_provider).is_empty()
    {
        return error_and_reset(
            id,
            json!({ "code": "no_key", "provider": res.stt_provider }),
        );
    }
    let llm_ok = !res.models.llm_model.is_empty() && has_key(&res.llm_provider);
    if o.command && !llm_ok {
        return error_and_reset(id, json!({ "code": "no_llm" }));
    }
    let mut models = res.models.clone();
    if !o.command && cfg.s("/ai/level") != "off" && !llm_ok {
        models.llm_model.clear();
        overlay_event(json!({ "id": id, "type": "warning", "code": "ai_no_key" }));
    }
    let access = accessibility_ok();
    let method = if !access && cfg.s("/dictation/insert") != "copy" {
        overlay_event(json!({ "id": id, "type": "warning", "code": "mac_accessibility" }));
        "copy".to_string()
    } else {
        cfg.s("/dictation/insert")
    };
    // lokales Modell schon mal laden – parallel zur Aufnahme
    if res.stt_provider == "local" {
        let key = models.stt_main.clone();
        let gpu = cfg.b("/services/local/gpu");
        let eng = s.engine.clone();
        std::thread::spawn(move || {
            if let Err(e) = eng.load(&key, gpu) {
                log(format!("load: {e}"));
            }
        });
    }

    // Aufnahme sofort starten – kein Wort am Anfang geht verloren
    let (tx, rx) = std::sync::mpsc::channel();
    let pause = cfg.n("/dictation/pauseMs") as u32;
    let pause = if pause > 0 {
        pause
    } else {
        match cfg.s("/dictation/tempo").as_str() {
            "fast" => 550,
            "best" => 950,
            _ => 750,
        }
    };
    let recorder = audio::Recorder::start(
        audio::RecOpts {
            device: cfg.s("/dictation/micId"),
            pause_ms: pause,
            sensitivity: cfg.n("/dictation/sensitivity") as u32,
            vad: true,
        },
        tx,
    );
    s.rec.lock().unwrap().recorder = Some(recorder);

    let stt_provider = res.stt_provider.clone();
    let llm_provider = res.llm_provider.clone();
    let command = o.command;
    tauri::async_runtime::spawn(async move {
        let s = st();
        // Befehlsmodus: markierten Text holen, solange die App im Vordergrund noch den Fokus hat
        let selection = if command && access {
            if cfg!(target_os = "macos") {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            let ins = s.inserter.clone();
            tokio::time::timeout(
                Duration::from_millis(2000),
                tauri::async_runtime::spawn_blocking(move || ins.copy_selection()),
            )
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default()
        } else {
            String::new()
        };
        if command {
            overlay_event(
                json!({ "id": id, "type": "command", "command": if selection.is_empty() { "write" } else { "selection" } }),
            );
        }
        let ins = s.inserter.clone();
        let app_name = tokio::time::timeout(
            Duration::from_millis(500),
            tauri::async_runtime::spawn_blocking(move || ins.foreground_app()),
        )
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
        remember_app(&app_name);
        let (ai, profile) = session::ai_for_app(&cfg, &app_name);
        let mut ai = ai;
        if command {
            ai.level = "off".into();
            ai.voice_commands = false;
            ai.replacements.clear();
        }
        overlay_event(json!({ "id": id, "type": "info", "app": app_name, "profile": profile }));
        let session_cfg = session::Cfg {
            mode: if command {
                "batch".into()
            } else {
                cfg.s("/dictation/mode")
            },
            language: cfg.s("/dictation/language"),
            trailing_space: !command && cfg.b("/dictation/trailingSpace"),
            ai,
        };
        let deps = make_deps(
            &cfg,
            id,
            &stt_provider,
            &llm_provider,
            &models,
            &method,
            command,
        );
        let sess = session::Session::new(id, session_cfg, models.clone(), deps);
        {
            let mut r = s.rec.lock().unwrap();
            if r.id != id {
                return;
            }
            r.session = Some(sess.clone());
            r.command = if command {
                Some(CommandCtx { selection })
            } else {
                None
            };
            r.app_name = app_name;
        }
        // Audio-Ereignisse weiterreichen (Pegel → Anzeige, Abschnitte → Diktat)
        tauri::async_runtime::spawn_blocking(move || {
            let mut idx = 0;
            let mut errored = false;
            while let Ok(msg) = rx.recv() {
                match msg {
                    audio::AudioMsg::Level { level, speaking } => {
                        let _ = st().handle.emit_to(
                            "overlay",
                            "rec:level",
                            json!({ "level": level, "speaking": speaking }),
                        );
                    }
                    audio::AudioMsg::Segment(pcm) => {
                        sess.add_segment(idx, pcm);
                        idx += 1;
                    }
                    audio::AudioMsg::Error(e) => {
                        log(format!("audio: {e}"));
                        errored = true;
                        overlay_event(
                            json!({ "id": id, "type": "error", "code": "mic", "message": e }),
                        );
                    }
                    audio::AudioMsg::Ended => break,
                }
            }
            if errored && idx == 0 {
                let mut r = st().rec.lock().unwrap();
                if r.id == id {
                    r.recording = false;
                }
                drop(r);
                update_tray();
                return;
            }
            tauri::async_runtime::spawn(finish_session(sess));
        });
        let max = cfg.n("/dictation/maxMinutes").max(1.0) as u64;
        tokio::time::sleep(Duration::from_secs(max * 60)).await;
        if st().rec.lock().unwrap().id == id {
            stop_dictation();
        }
    });
}

fn make_deps(
    cfg: &Value,
    id: u64,
    stt_provider: &str,
    llm_provider: &str,
    models: &session::Models,
    method: &str,
    command: bool,
) -> session::Deps {
    let s = st();
    let stt_provider = stt_provider.to_string();
    let llm_provider = llm_provider.to_string();
    let language = cfg.s("/dictation/language");
    let base = cfg.s("/services/stt/baseUrl");
    let llm_base = cfg.s("/services/llm/baseUrl");
    let tempo = cfg.s("/dictation/tempo");
    let gpu = cfg.b("/services/local/gpu");
    let best = tempo == "best";
    let restore = cfg.b("/dictation/restoreClipboard");
    let stt_key = s.secrets.lock().unwrap().get(&stt_provider);
    let llm_key = s.secrets.lock().unwrap().get(&llm_provider);
    let llm_model = models.llm_model.clone();
    let method = method.to_string();
    session::Deps {
        transcribe: Arc::new(move |pcm, model, prompt| {
            let (p, lang, base, key) = (
                stt_provider.clone(),
                language.clone(),
                base.clone(),
                stt_key.clone(),
            );
            Box::pin(async move {
                if p == "local" {
                    let eng = st().engine.clone();
                    let lang2 = lang.clone();
                    let r = tauri::async_runtime::spawn_blocking(move || {
                        eng.transcribe(
                            &model,
                            gpu,
                            &pcm,
                            if lang2.is_empty() { "auto" } else { &lang2 },
                            &prompt,
                            best,
                        )
                    })
                    .await
                    .map_err(|e| providers::SvError::new("local", e.to_string()))??;
                    Ok(r.text)
                } else {
                    providers::transcribe(providers::SttReq {
                        provider: &p,
                        api_key: &key,
                        base_url: &base,
                        model: &model,
                        language: &lang,
                        prompt: &prompt,
                        wav: wav::encode_wav(&pcm),
                    })
                    .await
                }
            })
        }),
        complete: Arc::new(move |system, user| {
            let (p, key, base, model, tempo) = (
                llm_provider.clone(),
                llm_key.clone(),
                llm_base.clone(),
                llm_model.clone(),
                tempo.clone(),
            );
            Box::pin(async move {
                providers::complete(providers::LlmReq {
                    provider: &p,
                    api_key: &key,
                    base_url: &base,
                    model: &model,
                    tempo: &tempo,
                    system: &system,
                    user: &user,
                })
                .await
            })
        }),
        insert: Arc::new(move |text| {
            let method = method.clone();
            Box::pin(async move {
                if command {
                    return;
                }
                *st().last_text.lock().unwrap() = text.clone();
                let ins = st().inserter.clone();
                let t2 = text.clone();
                let r =
                    tauri::async_runtime::spawn_blocking(move || ins.insert(&t2, &method, restore))
                        .await;
                if !matches!(r, Ok(Ok(()))) {
                    log(format!("insert failed: {r:?}"));
                    if let Ok(mut cb) = arboard::Clipboard::new() {
                        let _ = cb.set_text(text);
                    }
                    overlay_event(json!({ "id": id, "type": "warning", "code": "insert_failed" }));
                }
            })
        }),
        emit: Arc::new(move |mut ev| {
            ev["id"] = json!(id);
            overlay_event(ev);
        }),
    }
}

pub fn stop_dictation() {
    let rec = {
        let mut r = st().rec.lock().unwrap();
        if !r.recording {
            return;
        }
        r.recording = false;
        r.recorder.take()
    };
    st().hold.lock().unwrap().reset();
    update_tray();
    let id = st().rec.lock().unwrap().id;
    overlay_event(json!({ "id": id, "type": "state", "state": "processing" }));
    let _ = st()
        .handle
        .emit_to("overlay", "rec:stop", json!({ "id": id }));
    if let Some(r) = rec {
        std::thread::spawn(move || r.stop());
    }
}

pub fn cancel_dictation() {
    let (rec, sess, id) = {
        let mut r = st().rec.lock().unwrap();
        r.recording = false;
        (r.recorder.take(), r.session.clone(), r.id)
    };
    if let Some(s) = sess {
        s.cancel();
    }
    st().hold.lock().unwrap().reset();
    if let Some(r) = rec {
        std::thread::spawn(move || r.stop());
    }
    update_tray();
    let _ = st()
        .handle
        .emit_to("overlay", "rec:cancel", json!({ "id": id }));
    hide_overlay_soon(150);
}

async fn finish_session(sess: Arc<session::Session>) {
    let s = st();
    let id = sess.id;
    let res = sess.finish().await;
    if sess.cancelled.load(Ordering::SeqCst) {
        return;
    }
    let (command, app_name, started) = {
        let r = s.rec.lock().unwrap();
        (
            r.command.clone().filter(|_| r.id == id),
            r.app_name.clone(),
            r.started,
        )
    };
    let was_command = command.is_some();
    let mut outcome = match res {
        Ok(o) => o,
        Err(e) => {
            log(format!("finish: {e}"));
            overlay_event(
                json!({ "id": id, "type": "error", "code": e.code, "message": e.message }),
            );
            schedule_unload(&sess);
            return;
        }
    };
    if let Some(c) = command.filter(|_| !outcome.raw.is_empty()) {
        overlay_event(
            json!({ "id": id, "type": "state", "state": "processing", "text": outcome.raw }),
        );
        let cfg = s.settings.lock().unwrap().data.clone();
        let p = prompts::build_command(
            &outcome.raw,
            &c.selection,
            &sess.cfg.ai.style,
            &sess.cfg.ai.vocabulary,
            &sess.cfg.ai.custom_instruction,
        );
        match (make_deps(
            &cfg,
            id,
            "",
            &resolve_llm(&cfg),
            &sess.models,
            &cfg.s("/dictation/insert"),
            false,
        )
        .complete)(p.system, p.user)
        .await
        {
            Ok(out) => {
                let out = prompts::clean_model_output(&out);
                if !out.is_empty() && !sess.cancelled.load(Ordering::SeqCst) {
                    let method = if accessibility_ok() {
                        cfg.s("/dictation/insert")
                    } else {
                        "copy".into()
                    };
                    let restore = cfg.b("/dictation/restoreClipboard");
                    let ins = s.inserter.clone();
                    let o2 = out.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        ins.insert(&o2, &method, restore)
                    })
                    .await;
                    *s.last_text.lock().unwrap() = out.clone();
                }
                outcome.raw = if c.selection.is_empty() {
                    outcome.raw
                } else {
                    format!(
                        "{}\n\n— {}",
                        outcome.raw,
                        c.selection.chars().take(500).collect::<String>()
                    )
                };
                outcome.text = out;
            }
            Err(e) => {
                overlay_event(
                    json!({ "id": id, "type": "error", "code": e.code, "message": e.message }),
                );
                schedule_unload(&sess);
                return;
            }
        }
    }
    if !outcome.text.is_empty() {
        let cfg = s.settings.lock().unwrap().data.clone();
        if cfg.b("/history/keep") {
            let mode = if was_command {
                "command".to_string()
            } else {
                sess.cfg.mode.clone()
            };
            s.history.lock().unwrap().add(
                json!({
                    "text": outcome.text, "raw": if outcome.raw != outcome.text { json!(outcome.raw) } else { Value::Null },
                    "app": if app_name.is_empty() { Value::Null } else { json!(app_name) }, "mode": mode,
                    "seconds": started.map(|t| t.elapsed().as_secs()).unwrap_or(0),
                }),
                cfg.n("/history/max").max(1.0) as usize,
            );
            let _ = s.handle.emit_to("main", "history:changed", ());
        }
        overlay_event(json!({ "id": id, "type": "state", "state": "done", "text": outcome.text }));
        hide_overlay_soon(1400);
    } else {
        overlay_event(json!({ "id": id, "type": "state", "state": "empty" }));
        hide_overlay_soon(1800);
    }
    update_tray();
    schedule_unload(&sess);
}

fn remember_app(name: &str) {
    if name.is_empty() || name.to_lowercase().contains("slimvoice") {
        return;
    }
    let mut s = st().settings.lock().unwrap();
    let mut seen = s.data.list("/seenApps");
    seen.retain(|a| a != name);
    seen.insert(0, name.to_string());
    seen.truncate(20);
    s.update(&json!({ "seenApps": seen }));
}

// ------------------------------------------------------------------ Lokales Modell im Speicher halten
fn clear_unload() {
    st().unload_gen.fetch_add(1, Ordering::SeqCst);
}
fn schedule_unload(sess: &session::Session) {
    if !sess.models.pipeline {
        return;
    }
    let min = st()
        .settings
        .lock()
        .unwrap()
        .data
        .n("/services/local/keepLoadedMin");
    if min <= 0.0 {
        return;
    }
    let gen = st().unload_gen.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs((min * 60.0) as u64)).await;
        if st().unload_gen.load(Ordering::SeqCst) == gen && !st().rec.lock().unwrap().recording {
            st().engine.unload();
        }
    });
}

// ------------------------------------------------------------------ Modell herunterladen + Selbsttest
fn local_event(ev: Value) {
    let status = st().download.lock().unwrap().clone();
    let mut ev = ev;
    ev["status"] = status;
    let _ = st().handle.emit_to("main", "local:event", ev);
}

/// Prüft das geladene Modell mit einer eingebauten Sprachprobe. Klappt es mit der Grafikkarte nicht,
/// wird automatisch der Prozessor genommen – so bekommt niemand „Das ist das erste Mal“ statt seines Textes.
pub fn self_test(key: &str) -> Value {
    let eng = st().engine.clone();
    let (samples, _) = wav::decode_wav(local::SELFTEST_WAV).unwrap_or_default();
    let pcm: Vec<i16> = samples.iter().map(|v| (v * 32767.0) as i16).collect();
    let ok = |t: &str| {
        local::SELFTEST_WORDS
            .iter()
            .filter(|w| t.to_lowercase().contains(*w))
            .count()
            >= 2
    };
    let gpu_wanted = st().settings.lock().unwrap().data.b("/services/local/gpu");
    let mut tries = vec![gpu_wanted];
    if gpu_wanted {
        tries.push(false);
    }
    let mut last = String::new();
    for gpu in tries {
        match eng.transcribe(key, gpu, &pcm, "en", "", false) {
            Ok(t) if ok(&t.text) => {
                if gpu_wanted && !gpu {
                    st().settings
                        .lock()
                        .unwrap()
                        .update(&json!({ "services": { "local": { "gpu": false } } }));
                }
                return json!({ "ok": true, "text": t.text, "ms": t.ms, "gpu": t.gpu });
            }
            Ok(t) => last = t.text,
            Err(e) => last = e.to_string(),
        }
    }
    json!({ "ok": false, "text": last })
}

async fn local_download(key: String) -> Value {
    let s = st();
    let m = local::model(&key);
    *s.download.lock().unwrap() = json!({ "downloading": m.key, "progress": 0, "loaded": 0, "total": m.size_mb as u64 * 1_000_000 });
    local_event(json!({ "type": "loading" }));
    let res = if s.engine.is_downloaded(m.key) {
        Ok(())
    } else {
        s.engine
            .download(m.key, |loaded, total| {
                *st().download.lock().unwrap() = json!({ "downloading": key, "progress": (loaded as f64 / total.max(1) as f64 * 100.0), "loaded": loaded, "total": total });
                local_event(json!({ "type": "progress" }));
            })
            .await
    };
    *s.download.lock().unwrap() =
        json!({ "downloading": "", "progress": 0, "loaded": 0, "total": 0 });
    if let Err(e) = res {
        local_event(
            json!({ "type": if e.code == "cancelled" { "cancelled" } else { "error" }, "message": e.message }),
        );
        return json!({ "ok": false, "message": e.message, "offline": e.code == "network" });
    }
    s.settings
        .lock()
        .unwrap()
        .update(&json!({ "services": { "local": { "model": m.key } } }));
    local_event(json!({ "type": "testing" }));
    let k = m.key.to_string();
    let test = tauri::async_runtime::spawn_blocking(move || self_test(&k))
        .await
        .unwrap_or(json!({ "ok": false }));
    local_event(json!({ "type": "ready", "test": test }));
    settings_changed();
    json!({ "ok": true, "test": test })
}

// ------------------------------------------------------------------ Schnappschuss für die Oberfläche
fn snapshot() -> Value {
    let s = st();
    let settings = s.settings.lock().unwrap().data.clone();
    let stt: serde_json::Map<String, Value> = ["openai", "groq", "gemini", "custom"]
        .iter()
        .filter_map(|k| providers::stt_info(k).map(|i| (k.to_string(), json!({ "label": i.label, "models": i.models, "preview": i.preview, "main": { "fast": i.main[0], "balanced": i.main[1], "best": i.main[2] }, "baseUrl": i.base_url, "keyOptional": i.key_optional, "keyUrl": i.key_url }))))
        .collect();
    let llm: serde_json::Map<String, Value> = ["openai", "groq", "gemini", "anthropic", "custom"]
        .iter()
        .filter_map(|k| providers::llm_info(k).map(|i| (k.to_string(), json!({ "label": i.label, "models": i.models, "main": { "fast": i.main[0], "balanced": i.main[1], "best": i.main[2] }, "baseUrl": i.base_url, "keyOptional": i.key_optional, "keyUrl": i.key_url }))))
        .collect();
    let models: serde_json::Map<String, Value> = local::MODELS
        .iter()
        .map(|m| {
            (
                m.key.to_string(),
                json!({ "sizeMB": m.size_mb, "ramGB": m.ram_gb }),
            )
        })
        .collect();
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let apple_silicon = cfg!(all(target_os = "macos", target_arch = "aarch64"));
    json!({
        "settings": settings,
        "secrets": s.secrets.lock().unwrap().summary(),
        "platform": std::env::consts::OS.replace("macos", "darwin").replace("windows", "win32"),
        "version": env!("CARGO_PKG_VERSION"),
        "lang": ui_lang(),
        "stt": stt, "llm": llm,
        "hotkeys": s.hotkey_ok.lock().unwrap().clone(),
        "local": {
            "models": models, "downloaded": s.engine.downloaded_sizes(), "status": s.download.lock().unwrap().clone(),
            "cores": cores, "gpu": apple_silicon, "appleSilicon": apple_silicon,
            "loaded": s.engine.loaded().map(|(k, g)| json!({ "model": k, "gpu": g })),
        },
        "permissions": { "accessibility": accessibility_ok(), "mic": "unknown" },
        "recording": s.rec.lock().unwrap().recording,
        "website": WEBSITE,
        "email": "SlimBitApps@gmail.com",
    })
}

// ------------------------------------------------------------------ Befehle aus der Oberfläche
fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}
fn arg_s(args: &[Value], i: usize) -> String {
    args.get(i)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
async fn call(ch: String, args: Vec<Value>) -> Result<Value, String> {
    dispatch(&ch, &args).await
}

pub async fn dispatch(ch: &str, args: &[Value]) -> Result<Value, String> {
    let s = st();
    Ok(match ch {
        "app:snapshot" => snapshot(),
        "settings:set" => {
            let before = s.settings.lock().unwrap().data.clone();
            s.settings.lock().unwrap().update(&arg(args, 0));
            let after = s.settings.lock().unwrap().data.clone();
            if before["hotkey"] != after["hotkey"] {
                register_shortcuts();
            }
            if before["autostart"] != after["autostart"] {
                apply_autostart();
            }
            settings_changed();
            snapshot()
        }
        "secret:set" => {
            let name = arg_s(args, 0);
            if !name.chars().all(|c| c.is_ascii_lowercase()) {
                return Err("bad name".into());
            }
            s.secrets.lock().unwrap().set(&name, &arg_s(args, 1));
            s.secrets.lock().unwrap().summary()
        }
        "hotkey:check" => {
            let accel = arg_s(args, 0);
            let cfg = s.settings.lock().unwrap().data.clone();
            if accel.is_empty()
                || [
                    cfg.s("/hotkey/toggle"),
                    cfg.s("/hotkey/command"),
                    cfg.s("/hotkey/cancel"),
                ]
                .contains(&accel)
            {
                return Ok(json!(true));
            }
            let ok = accel.parse::<Shortcut>().ok().map(|sc| {
                let gs = s.handle.global_shortcut();
                let ok = gs.register(sc).is_ok();
                let _ = gs.unregister(sc);
                ok
            });
            json!(ok.unwrap_or(false))
        }
        "service:test" => service_test(&arg_s(args, 0), &arg_s(args, 1)).await,
        "dictation:toggle" => {
            toggle_dictation(StartOpts {
                how: "button".into(),
                command: false,
            });
            Value::Null
        }
        "dictation:cancel" => {
            cancel_dictation();
            Value::Null
        }
        "history:list" => Value::Array(s.history.lock().unwrap().items.clone()),
        "history:remove" => {
            s.history.lock().unwrap().remove(&arg_s(args, 0));
            update_tray();
            Value::Null
        }
        "history:clear" => {
            s.history.lock().unwrap().clear();
            update_tray();
            Value::Null
        }
        "clipboard:write" => {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(arg_s(args, 0));
            }
            Value::Null
        }
        "perm:request" => {
            #[cfg(target_os = "macos")]
            {
                let _ =
                    macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
                open_url(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
                );
            }
            json!({ "accessibility": accessibility_ok() })
        }
        "perm:openMic" => {
            open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
            Value::Null
        }
        "shell:openExternal" => {
            let url = arg_s(args, 0);
            if url.starts_with("https://") || url.starts_with("mailto:") {
                open_url(&url);
            }
            Value::Null
        }
        "local:status" => {
            json!({ "ok": true, "downloaded": s.engine.downloaded_sizes(), "status": s.download.lock().unwrap().clone() })
        }
        "local:download" => local_download(arg_s(args, 0)).await,
        "local:cancel" => {
            s.engine.cancel_download();
            Value::Null
        }
        "local:delete" => {
            s.engine.delete(local::model(&arg_s(args, 0)).key);
            settings_changed();
            Value::Null
        }
        "local:selftest" => {
            let key = local::model(&s.settings.lock().unwrap().str("/services/local/model"))
                .key
                .to_string();
            tauri::async_runtime::spawn_blocking(move || self_test(&key))
                .await
                .unwrap_or(json!({ "ok": false }))
        }
        "mic:list" => json!(audio::list_inputs()),
        "mic:test" => {
            let start = arg_s(args, 0) == "start";
            let old = s.mic_test.lock().unwrap().take();
            if let Some(r) = old {
                std::thread::spawn(move || r.stop());
            }
            if start {
                let (tx, rx) = std::sync::mpsc::channel();
                let dev = s.settings.lock().unwrap().str("/dictation/micId");
                *s.mic_test.lock().unwrap() = Some(audio::Recorder::start(
                    audio::RecOpts {
                        device: dev,
                        pause_ms: 800,
                        sensitivity: 50,
                        vad: false,
                    },
                    tx,
                ));
                std::thread::spawn(move || {
                    while let Ok(m) = rx.recv() {
                        match m {
                            audio::AudioMsg::Level { level, .. } => {
                                let _ = st().handle.emit_to(
                                    "main",
                                    "mic:level",
                                    json!({ "level": level }),
                                );
                            }
                            audio::AudioMsg::Error(e) => {
                                let _ =
                                    st().handle
                                        .emit_to("main", "mic:level", json!({ "error": e }));
                            }
                            audio::AudioMsg::Ended => break,
                            _ => {}
                        }
                    }
                });
            }
            Value::Null
        }
        "app:detect" => {
            // „Diese App hinzufügen“: kurz warten, bis man in die gewünschte App gewechselt hat
            tokio::time::sleep(Duration::from_millis(3000)).await;
            let ins = s.inserter.clone();
            let name = tauri::async_runtime::spawn_blocking(move || ins.foreground_app())
                .await
                .unwrap_or_default();
            remember_app(&name);
            json!(name)
        }
        "overlay:action" => {
            match arg_s(args, 0).as_str() {
                "stop" => stop_dictation(),
                "cancel" => cancel_dictation(),
                "settings" => {
                    cancel_dictation();
                    show_settings(Some("services"));
                }
                _ => hide_overlay_soon(0),
            }
            Value::Null
        }
        "app:log" => {
            log(format!("ui: {args:?}"));
            Value::Null
        }
        other => return Err(format!("unknown channel {other}")),
    })
}

fn open_url(url: &str) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = st().handle.opener().open_url(url, None::<&str>) {
        log(format!("open {url}: {e}"));
    }
}

async fn service_test(kind: &str, provider: &str) -> Value {
    let mut cfg = st().settings.lock().unwrap().data.clone();
    if !provider.is_empty() {
        let ptr = if kind == "stt" { "stt" } else { "llm" };
        let same = cfg["services"][ptr]["provider"] == provider;
        cfg["services"][ptr]["provider"] = json!(provider);
        if !same {
            cfg["services"][ptr]["model"] = json!("");
        }
    }
    let r = resolve(&cfg);
    let t0 = Instant::now();
    let res: Result<(), providers::SvError> = async {
        if kind == "stt" && r.stt_provider == "local" {
            if !local_ready(&cfg) {
                return Err(providers::SvError::new("local_missing", "not downloaded"));
            }
            let key = r.models.stt_main.clone();
            let t = tauri::async_runtime::spawn_blocking(move || self_test(&key))
                .await
                .unwrap_or(json!({ "ok": false }));
            if t["ok"] != true {
                return Err(providers::SvError::new(
                    "local",
                    t["text"].as_str().unwrap_or("").to_string(),
                ));
            }
            Ok(())
        } else if kind == "stt" {
            // 0,6 s leises Rauschen – es geht nur darum, ob Schlüssel, Adresse und Modell stimmen
            let pcm: Vec<i16> = (0..9600).map(|_| rand::random::<i16>() % 30).collect();
            let key = st().secrets.lock().unwrap().get(&r.stt_provider);
            providers::transcribe(providers::SttReq {
                provider: &r.stt_provider,
                api_key: &key,
                base_url: &cfg.s("/services/stt/baseUrl"),
                model: &r.models.stt_main,
                language: &cfg.s("/dictation/language"),
                prompt: "",
                wav: wav::encode_wav(&pcm),
            })
            .await
            .map(|_| ())
        } else {
            if r.llm_provider.is_empty() {
                return Err(providers::SvError::new("no_key", "no provider"));
            }
            let key = st().secrets.lock().unwrap().get(&r.llm_provider);
            let out = providers::complete(providers::LlmReq {
                provider: &r.llm_provider,
                api_key: &key,
                base_url: &cfg.s("/services/llm/baseUrl"),
                model: &r.models.llm_model,
                tempo: &cfg.s("/dictation/tempo"),
                system: "Reply with the single word OK.",
                user: "Ping",
            })
            .await?;
            if out.is_empty() {
                return Err(providers::SvError::new("empty", "empty"));
            }
            Ok(())
        }
    }
    .await;
    match res {
        Ok(()) => json!({ "ok": true, "ms": t0.elapsed().as_millis() as u64 }),
        Err(e) => {
            json!({ "ok": false, "code": e.code, "message": e.message.chars().take(300).collect::<String>() })
        }
    }
}

fn apply_autostart() {
    if is_test() {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let on = st().settings.lock().unwrap().data.b("/autostart");
    let al = st().handle.autolaunch();
    let _ = if on { al.enable() } else { al.disable() };
}

// ------------------------------------------------------------------ Start
pub fn run() {
    let mut builder = tauri::Builder::default();
    if !is_test() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            show_settings(None)
        }));
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|_app, sc, ev| on_shortcut(sc, ev.state()))
                .build(),
        )
        .invoke_handler(tauri::generate_handler![call])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let dir = std::env::var("SLIMVOICE_USERDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    app.path()
                        .app_data_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                });
            let _ = std::fs::create_dir_all(&dir);
            let state = Arc::new(State {
                handle: app.handle().clone(),
                settings: Mutex::new(store::Settings::load(dir.join("settings.json"))),
                secrets: Mutex::new(store::Secrets::load(dir.join("secrets.json"))),
                history: Mutex::new(store::History::load(dir.join("history.json"))),
                engine: Arc::new(local::Engine::new(dir.join("models"))),
                inserter: Arc::new(inserter::Inserter::new()),
                rec: Mutex::new(Rec {
                    recording: false,
                    id: 0,
                    session: None,
                    recorder: None,
                    command: None,
                    app_name: String::new(),
                    started: None,
                }),
                hold: Mutex::new(keyhold::KeyHold::new(350)),
                shortcuts: Mutex::new(HashMap::new()),
                hotkey_ok: Mutex::new(json!({})),
                last_text: Mutex::new(String::new()),
                download: Mutex::new(
                    json!({ "downloading": "", "progress": 0, "loaded": 0, "total": 0 }),
                ),
                unload_gen: AtomicU64::new(0),
                mic_test: Mutex::new(None),
                last_access: AtomicBool::new(accessibility_ok()),
                dir,
            });
            let _ = STATE.set(state);
            let step = |name: &str| {
                if is_test() {
                    eprintln!("[slimvoice] setup: {name}");
                }
            };
            if is_test() {
                control::start();
            }
            step("overlay");
            create_overlay(app.handle());
            step("tray");
            let menu = build_menu(app.handle())?;
            if std::env::var("SLIMVOICE_NO_TRAY").is_err() {
                TrayIconBuilder::with_id("main")
                    .icon(tray_icon(false))
                    .icon_as_template(cfg!(target_os = "macos"))
                    .menu(&menu)
                    .show_menu_on_left_click(cfg!(target_os = "macos"))
                    .on_menu_event(|_app, e| on_menu(e.id.as_ref()))
                    .on_tray_icon_event(|_tray, e| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = e
                        {
                            if !cfg!(target_os = "macos") {
                                show_settings(None);
                            }
                        }
                    })
                    .build(app)?;
            }
            step("shortcuts");
            register_shortcuts();
            apply_autostart();
            update_tray();
            step("windows");

            let cfg = st().settings.lock().unwrap().data.clone();
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden || !cfg.b("/onboarded") {
                show_settings(if cfg.b("/onboarded") {
                    None
                } else {
                    Some("welcome")
                });
            }
            // Lokales Modell schon mal laden, damit das erste Diktat nicht warten muss
            if cfg.s("/services/stt/provider") == "local" && local_ready(&cfg) && !is_test() {
                let key = local::model(&cfg.s("/services/local/model"))
                    .key
                    .to_string();
                let gpu = cfg.b("/services/local/gpu");
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    let _ = st().engine.load(&key, gpu);
                });
            }
            // Mac: Freigabe „Bedienungshilfen“ jede Sekunde prüfen – die Oberfläche merkt die Änderung sofort
            std::thread::spawn(|| loop {
                std::thread::sleep(Duration::from_millis(1000));
                let now = accessibility_ok();
                if st().last_access.swap(now, Ordering::SeqCst) != now {
                    let _ = st().handle.emit_to(
                        "main",
                        "perm:changed",
                        json!({ "accessibility": now }),
                    );
                }
            });
            step("ready");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("SlimVoice konnte nicht starten")
        .run(|_app, event| {
            // Fenster zu ≠ App zu: SlimVoice läuft im Hintergrund weiter
            if let tauri::RunEvent::ExitRequested {
                api, code: None, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}
