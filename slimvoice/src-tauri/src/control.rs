//! Nur im Testbetrieb (SLIMVOICE_TEST): kleine Steuer-Schnittstelle auf 127.0.0.1, damit der
//! Ende-zu-Ende-Test die echte App fernsteuern kann (Diktat starten, Zustand lesen, Einstellungen setzen …).

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;

pub fn start() {
    let port: u16 = std::env::var("SLIMVOICE_CONTROL_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(0);
    let Ok(l) = TcpListener::bind(("127.0.0.1", port)) else { return };
    if let Ok(addr) = l.local_addr() {
        if let Ok(f) = std::env::var("SLIMVOICE_CONTROL_FILE") {
            let _ = std::fs::write(f, addr.port().to_string());
        }
    }
    std::thread::spawn(move || {
        for stream in l.incoming() {
            let Ok(mut st) = stream else { continue };
            let mut buf = Vec::new();
            let mut tmp = [0u8; 65536];
            let (head_end, len) = loop {
                let n = st.read(&mut tmp).unwrap_or(0);
                if n == 0 {
                    break (0, 0);
                }
                buf.extend_from_slice(&tmp[..n]);
                if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buf[..p]).to_lowercase();
                    let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                    break (p + 4, len);
                }
            };
            while buf.len() < head_end + len {
                let n = st.read(&mut tmp).unwrap_or(0);
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
            let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
            let body: Value = serde_json::from_slice(&buf[head_end..]).unwrap_or(Value::Null);
            let out = handle(&path, body);
            let text = out.to_string();
            let _ = write!(st, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{text}", text.len());
        }
    });
}

fn handle(path: &str, body: Value) -> Value {
    let s = crate::st();
    let now = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    match path {
        "/state" => {
            let r = s.rec.lock().unwrap();
            json!({ "recording": r.recording, "id": r.id, "app": r.app_name })
        }
        "/toggle" => {
            crate::toggle_dictation(crate::StartOpts { how: "hotkey".into(), command: false });
            json!(true)
        }
        "/command" => {
            crate::toggle_dictation(crate::StartOpts { how: "hotkey".into(), command: true });
            json!(true)
        }
        "/cancel" => {
            crate::cancel_dictation();
            json!(true)
        }
        "/hold/press" | "/hold/release" => {
            let rec = s.rec.lock().unwrap().recording;
            let a = if path.ends_with("press") { s_hold_press(now(), rec) } else { s_hold_release(now(), rec) };
            json!(format!("{a:?}"))
        }
        "/nav" => {
            crate::show_settings(body["page"].as_str());
            json!(true)
        }
        "/dispatch" => {
            let ch = body["ch"].as_str().unwrap_or("").to_string();
            let args = body["args"].as_array().cloned().unwrap_or_default();
            tauri::async_runtime::block_on(crate::dispatch(&ch, &args)).unwrap_or_else(|e| json!({ "error": e }))
        }
        _ => json!({ "error": "unknown" }),
    }
}

fn s_hold_press(now: u64, rec: bool) -> crate::keyhold::Action {
    let a = crate::hold_pressed(now, rec);
    a
}
fn s_hold_release(now: u64, rec: bool) -> crate::keyhold::Action {
    crate::hold_released(now, rec)
}
