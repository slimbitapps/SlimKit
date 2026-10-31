//! Online-Dienste: Spracherkennung (Audio → Text) und KI-Korrektur (Text → besserer Text).
//! OpenAI-kompatibel (OpenAI, Groq, eigener Server), Google Gemini und Anthropic Claude.

use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct SvError {
    /// no_key | auth | quota | network | timeout | bad_request | server | refusal | empty | local | local_missing
    pub code: String,
    pub message: String,
}
impl SvError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for SvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

pub struct SttInfo {
    pub label: &'static str,
    pub base_url: &'static str,
    pub preview: &'static str,
    pub main: [&'static str; 3], // fast, balanced, best
    pub models: &'static [&'static str],
    pub max_seconds: u32,
    pub key_optional: bool,
    pub key_url: &'static str,
}

pub fn stt_info(p: &str) -> Option<SttInfo> {
    Some(match p {
        "openai" => SttInfo {
            label: "OpenAI",
            base_url: "https://api.openai.com/v1",
            preview: "gpt-4o-mini-transcribe",
            main: [
                "gpt-4o-mini-transcribe",
                "gpt-4o-transcribe",
                "gpt-4o-transcribe",
            ],
            models: &["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
            max_seconds: 600,
            key_optional: false,
            key_url: "https://platform.openai.com/api-keys",
        },
        "groq" => SttInfo {
            label: "Groq",
            base_url: "https://api.groq.com/openai/v1",
            preview: "whisper-large-v3-turbo",
            main: [
                "whisper-large-v3-turbo",
                "whisper-large-v3-turbo",
                "whisper-large-v3",
            ],
            models: &["whisper-large-v3-turbo", "whisper-large-v3"],
            max_seconds: 600,
            key_optional: false,
            key_url: "https://console.groq.com/keys",
        },
        "gemini" => SttInfo {
            label: "Google Gemini",
            base_url: "https://generativelanguage.googleapis.com/v1beta",
            preview: "gemini-2.5-flash-lite",
            main: [
                "gemini-2.5-flash-lite",
                "gemini-2.5-flash",
                "gemini-2.5-pro",
            ],
            models: &[
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite",
                "gemini-2.5-pro",
            ],
            max_seconds: 300,
            key_optional: false,
            key_url: "https://aistudio.google.com/apikey",
        },
        "custom" => SttInfo {
            label: "Custom / local (OpenAI-compatible)",
            base_url: "http://localhost:8000/v1",
            preview: "whisper-1",
            main: ["whisper-1", "whisper-1", "whisper-1"],
            models: &["whisper-1", "Systran/faster-whisper-large-v3"],
            max_seconds: 600,
            key_optional: true,
            key_url: "",
        },
        _ => return None,
    })
}

pub struct LlmInfo {
    pub label: &'static str,
    pub base_url: &'static str,
    pub main: [&'static str; 3],
    pub models: &'static [&'static str],
    pub key_optional: bool,
    pub key_url: &'static str,
}

pub fn llm_info(p: &str) -> Option<LlmInfo> {
    Some(match p {
        "openai" => LlmInfo {
            label: "OpenAI",
            base_url: "https://api.openai.com/v1",
            main: ["gpt-4.1-mini", "gpt-4.1-mini", "gpt-4.1"],
            models: &["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano"],
            key_optional: false,
            key_url: "https://platform.openai.com/api-keys",
        },
        "groq" => LlmInfo {
            label: "Groq",
            base_url: "https://api.groq.com/openai/v1",
            main: [
                "llama-3.3-70b-versatile",
                "llama-3.3-70b-versatile",
                "llama-3.3-70b-versatile",
            ],
            models: &["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
            key_optional: false,
            key_url: "https://console.groq.com/keys",
        },
        "gemini" => LlmInfo {
            label: "Google Gemini",
            base_url: "https://generativelanguage.googleapis.com/v1beta",
            main: [
                "gemini-2.5-flash-lite",
                "gemini-2.5-flash",
                "gemini-2.5-flash",
            ],
            models: &[
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite",
                "gemini-2.5-pro",
            ],
            key_optional: false,
            key_url: "https://aistudio.google.com/apikey",
        },
        "anthropic" => LlmInfo {
            label: "Anthropic Claude",
            base_url: "https://api.anthropic.com",
            main: ["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5"],
            models: &["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
            key_optional: false,
            key_url: "https://platform.claude.com/settings/keys",
        },
        "custom" => LlmInfo {
            label: "Custom / local (OpenAI-compatible)",
            base_url: "http://localhost:11434/v1",
            main: ["llama3.2", "llama3.2", "llama3.2"],
            models: &["llama3.2", "qwen2.5:7b", "gemma3"],
            key_optional: true,
            key_url: "",
        },
        _ => return None,
    })
}

pub fn tempo_idx(tempo: &str) -> usize {
    match tempo {
        "fast" => 0,
        "best" => 2,
        _ => 1,
    }
}

fn client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_default()
}

fn error_for(status: u16, body: &str) -> SvError {
    let msg: String = body.chars().take(300).collect();
    match status {
        401 | 403 => SvError::new("auth", msg),
        429 => SvError::new("quota", msg),
        404 => SvError::new("bad_request", format!("Model not found? {msg}")),
        400..=499 => SvError::new("bad_request", msg),
        _ => SvError::new("server", msg),
    }
}

async fn send(req: reqwest::RequestBuilder) -> Result<Value, SvError> {
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            SvError::new("timeout", e.to_string())
        } else {
            SvError::new("network", e.to_string())
        }
    })?;
    let status = res.status().as_u16();
    let text = res
        .text()
        .await
        .map_err(|e| SvError::new("network", e.to_string()))?;
    if !(200..300).contains(&status) {
        return Err(error_for(status, &text));
    }
    Ok(serde_json::from_str(&text).unwrap_or_else(|_| json!({ "text": text })))
}

fn trim_slash(u: &str) -> String {
    u.trim_end_matches('/').to_string()
}

pub struct SttReq<'a> {
    pub provider: &'a str,
    pub api_key: &'a str,
    pub base_url: &'a str,
    pub model: &'a str,
    pub language: &'a str,
    pub prompt: &'a str,
    pub wav: Vec<u8>,
}

pub async fn transcribe(r: SttReq<'_>) -> Result<String, SvError> {
    let info = stt_info(r.provider)
        .ok_or_else(|| SvError::new("bad_request", format!("unknown provider {}", r.provider)))?;
    if r.api_key.is_empty() && !info.key_optional {
        return Err(SvError::new("no_key", "no key"));
    }
    let base = trim_slash(if r.base_url.is_empty() {
        info.base_url
    } else {
        r.base_url
    });
    // ca. 1 s Rechenzeit pro 10 s Audio + Puffer
    let timeout = Duration::from_secs(30 + (r.wav.len() / 32_000) as u64);
    if r.provider == "gemini" {
        let lang = if r.language.is_empty() || r.language == "auto" {
            String::new()
        } else {
            format!(" The language is \"{}\".", r.language)
        };
        let hint = if r.prompt.is_empty() {
            String::new()
        } else {
            format!(
                " Spelling hints (names and terms that may occur): {}",
                r.prompt
            )
        };
        let instruction = format!("Transcribe this audio exactly as spoken.{lang} Add normal punctuation and capitalization. Output only the transcript – no comments, no timestamps, no speaker labels. If there is no speech, output nothing.{hint}");
        use base64::Engine;
        let body = json!({
            "contents": [{ "role": "user", "parts": [{ "text": instruction }, { "inline_data": { "mime_type": "audio/wav", "data": base64::engine::general_purpose::STANDARD.encode(&r.wav) } }] }],
            "generationConfig": gemini_config(r.model),
        });
        let req = client(timeout + Duration::from_secs(15))
            .post(format!("{base}/models/{}:generateContent", r.model))
            .header("x-goog-api-key", r.api_key)
            .json(&body);
        return Ok(gemini_text(&send(req).await?));
    }
    let part = reqwest::multipart::Part::bytes(r.wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .unwrap();
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", r.model.to_string())
        .text("response_format", "json");
    if !r.language.is_empty() && r.language != "auto" {
        form = form.text("language", r.language.to_string());
    }
    if !r.prompt.is_empty() {
        form = form.text("prompt", r.prompt.to_string());
    }
    let mut req = client(timeout)
        .post(format!("{base}/audio/transcriptions"))
        .multipart(form);
    if !r.api_key.is_empty() {
        req = req.bearer_auth(r.api_key);
    }
    let v = send(req).await?;
    Ok(v["text"].as_str().unwrap_or("").trim().to_string())
}

fn gemini_config(model: &str) -> Value {
    // Flash-Modelle denken sonst erst nach – kostet hier nur Zeit
    if model.contains("flash") {
        json!({ "temperature": 0, "thinkingConfig": { "thinkingBudget": 0 } })
    } else {
        json!({ "temperature": 0 })
    }
}

fn gemini_text(v: &Value) -> String {
    v["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p["text"].as_str())
                .collect::<String>()
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub struct LlmReq<'a> {
    pub provider: &'a str,
    pub api_key: &'a str,
    pub base_url: &'a str,
    pub model: &'a str,
    pub tempo: &'a str,
    pub system: &'a str,
    pub user: &'a str,
}

pub async fn complete(r: LlmReq<'_>) -> Result<String, SvError> {
    let info = llm_info(r.provider).ok_or_else(|| SvError::new("no_key", "no AI service"))?;
    if r.api_key.is_empty() && !info.key_optional {
        return Err(SvError::new("no_key", "no key"));
    }
    let base = trim_slash(if r.base_url.is_empty() {
        info.base_url
    } else {
        r.base_url
    });
    let http = client(Duration::from_secs(60));
    match r.provider {
        "anthropic" => {
            // Claude: raw HTTP (es gibt kein offizielles Rust-SDK)
            let effort = match r.tempo {
                "best" => "medium",
                _ => "low",
            };
            let mut body = json!({
                "model": r.model, "max_tokens": 16000, "system": r.system,
                "messages": [{ "role": "user", "content": r.user }],
                "output_config": { "effort": effort },
            });
            let mut req = http
                .post(format!("{base}/v1/messages"))
                .header("x-api-key", r.api_key)
                .header("anthropic-version", "2023-06-01");
            // Bei einer Ablehnung automatisch ein Ersatzmodell nehmen (nur bei Modellen, die das unterstützen)
            if r.model.starts_with("claude-opus-5")
                || r.model.starts_with("claude-sonnet-5-5")
                || r.model.starts_with("claude-fable-5")
            {
                body["fallbacks"] = json!("default");
                req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
            }
            let v = send(req.json(&body)).await?;
            if v["stop_reason"] == "refusal" {
                return Err(SvError::new(
                    "refusal",
                    v["stop_details"]["explanation"]
                        .as_str()
                        .unwrap_or("refusal"),
                ));
            }
            Ok(v["content"]
                .as_array()
                .map(|c| {
                    c.iter()
                        .filter(|b| b["type"] == "text")
                        .filter_map(|b| b["text"].as_str())
                        .collect::<String>()
                })
                .unwrap_or_default()
                .trim()
                .to_string())
        }
        "gemini" => {
            let body = json!({
                "systemInstruction": { "parts": [{ "text": r.system }] },
                "contents": [{ "role": "user", "parts": [{ "text": r.user }] }],
                "generationConfig": gemini_config(r.model),
            });
            let v = send(
                http.post(format!("{base}/models/{}:generateContent", r.model))
                    .header("x-goog-api-key", r.api_key)
                    .json(&body),
            )
            .await?;
            Ok(gemini_text(&v))
        }
        _ => {
            let reasoning = r.model.starts_with("gpt-5") || r.model.starts_with('o');
            let mut body = json!({ "model": r.model, "messages": [{ "role": "system", "content": r.system }, { "role": "user", "content": r.user }] });
            if !reasoning {
                body["temperature"] = json!(0.1);
            }
            let mut req = http.post(format!("{base}/chat/completions")).json(&body);
            if !r.api_key.is_empty() {
                req = req.bearer_auth(r.api_key);
            }
            let v = send(req).await?;
            Ok(v["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string())
        }
    }
}

#[cfg(test)]
pub mod mock {
    //! Winziger HTTP-Testserver (ohne Zusatz-Bibliothek)
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    pub struct Seen {
        pub path: String,
        pub headers: String,
        pub body: Vec<u8>,
    }

    pub fn serve(
        reply: impl Fn(&str, &[u8]) -> (u16, String) + Send + 'static,
    ) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", l.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
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
                        let len = head
                            .lines()
                            .find_map(|l| {
                                l.strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
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
                let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                let body = buf[head_end..].to_vec();
                let (status, text) = reply(&path, &body);
                s2.lock().unwrap().push(Seen {
                    path,
                    headers: head.to_lowercase(),
                    body,
                });
                let _ = write!(st, "HTTP/1.1 {status} OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{text}", text.len());
            }
        });
        (url, seen)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn openai_kompatibel() {
        let (url, seen) = mock::serve(|path, _| match path {
            "/v1/audio/transcriptions" => (200, r#"{"text":" hallo welt "}"#.into()),
            "/v1/chat/completions" => (
                200,
                r#"{"choices":[{"message":{"content":"Hallo Welt."}}]}"#.into(),
            ),
            _ => (404, "{}".into()),
        });
        let t = transcribe(SttReq {
            provider: "custom",
            api_key: "k",
            base_url: &format!("{url}/v1/"),
            model: "whisper-1",
            language: "de",
            prompt: "SlimBit",
            wav: crate::wav::encode_wav(&[0; 160]),
        })
        .await
        .unwrap();
        assert_eq!(t, "hallo welt");
        {
            let s = seen.lock().unwrap();
            assert!(s[0].headers.contains("authorization: bearer k"));
            let body = String::from_utf8_lossy(&s[0].body);
            assert!(body.contains("name=\"model\"\r\n\r\nwhisper-1"));
            assert!(body.contains("name=\"language\"\r\n\r\nde"));
            assert!(body.contains("RIFF"));
        }
        let c = complete(LlmReq {
            provider: "custom",
            api_key: "",
            base_url: &format!("{url}/v1"),
            model: "llama",
            tempo: "fast",
            system: "s",
            user: "u",
        })
        .await
        .unwrap();
        assert_eq!(c, "Hallo Welt.");
    }

    #[tokio::test]
    async fn fehler_verstaendlich() {
        let (url, _) = mock::serve(|_, _| (401, r#"{"error":"bad key"}"#.into()));
        let e = transcribe(SttReq {
            provider: "openai",
            api_key: "x",
            base_url: &url,
            model: "m",
            language: "",
            prompt: "",
            wav: vec![0; 44],
        })
        .await
        .unwrap_err();
        assert_eq!(e.code, "auth");
        let e = transcribe(SttReq {
            provider: "openai",
            api_key: "",
            base_url: "",
            model: "m",
            language: "",
            prompt: "",
            wav: vec![],
        })
        .await
        .unwrap_err();
        assert_eq!(e.code, "no_key");
    }

    #[tokio::test]
    async fn gemini_und_claude() {
        let (url, seen) = mock::serve(|path, _| {
            if path.contains("generateContent") {
                (
                    200,
                    r#"{"candidates":[{"content":{"parts":[{"text":"Hallo "},{"text":"Welt"}]}}]}"#
                        .into(),
                )
            } else {
                (200, r#"{"type":"message","stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"Fertig."}]}"#.into())
            }
        });
        let t = transcribe(SttReq {
            provider: "gemini",
            api_key: "g",
            base_url: &url,
            model: "gemini-2.5-flash",
            language: "",
            prompt: "",
            wav: vec![1, 2, 3],
        })
        .await
        .unwrap();
        assert_eq!(t, "Hallo Welt");
        let c = complete(LlmReq {
            provider: "anthropic",
            api_key: "a",
            base_url: &url,
            model: "claude-opus-5-5",
            tempo: "best",
            system: "s",
            user: "u",
        })
        .await
        .unwrap();
        assert_eq!(c, "Fertig.");
        let s = seen.lock().unwrap();
        assert!(s[0]
            .path
            .ends_with("/models/gemini-2.5-flash:generateContent"));
        assert!(s[0].headers.contains("x-goog-api-key: g"));
        assert_eq!(s[1].path, "/v1/messages");
        assert!(s[1].headers.contains("x-api-key: a"));
        assert!(s[1].headers.contains("server-side-fallback-2026-07-01"));
        let body: Value = serde_json::from_slice(&s[1].body).unwrap();
        assert_eq!(body["output_config"]["effort"], "medium");
        assert_eq!(body["fallbacks"], "default");
    }
}
