'use strict';
/**
 * Anbindung der Dienste: Spracherkennung (Audio → Text) und KI-Korrektur (Text → besserer Text).
 * OpenAI-kompatibel (OpenAI, Groq, eigener/lokaler Server), Google Gemini und Anthropic Claude.
 */
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Modelle je Dienst und Tempo. preview = für die Live-Vorschau, main = für den eingefügten Text.
 * Alle Namen lassen sich in den Einstellungen überschreiben.
 */
/** Lokale Modelle (Whisper, laufen in der App). Größen: ungefähr, je nach Grafikkarte/Prozessor. */
const LOCAL_MODELS = {
  base: { id: 'onnx-community/whisper-base', sizeMB: 80, ramGB: 2 },
  small: { id: 'onnx-community/whisper-small', sizeMB: 250, ramGB: 4 },
  turbo: { id: 'onnx-community/whisper-large-v3-turbo', sizeMB: 900, ramGB: 8 },
};

const STT = {
  local: {
    label: 'On this computer',
    preview: '',
    main: { fast: '', balanced: '', best: '' },
    models: [],
    maxSeconds: 1800,
    keyOptional: true,
    local: true,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    preview: 'gpt-4o-mini-transcribe',
    main: { fast: 'gpt-4o-mini-transcribe', balanced: 'gpt-4o-transcribe', best: 'gpt-4o-transcribe' },
    models: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
    maxSeconds: 600,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    preview: 'whisper-large-v3-turbo',
    main: { fast: 'whisper-large-v3-turbo', balanced: 'whisper-large-v3-turbo', best: 'whisper-large-v3' },
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    maxSeconds: 600,
    keyUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    preview: 'gemini-2.5-flash-lite',
    main: { fast: 'gemini-2.5-flash-lite', balanced: 'gemini-2.5-flash', best: 'gemini-2.5-pro' },
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    maxSeconds: 300,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  custom: {
    label: 'Custom / local (OpenAI-compatible)',
    baseUrl: 'http://localhost:8000/v1',
    preview: 'whisper-1',
    main: { fast: 'whisper-1', balanced: 'whisper-1', best: 'whisper-1' },
    models: ['whisper-1', 'Systran/faster-whisper-large-v3', 'deepdml/faster-whisper-large-v3-turbo-ct2'],
    maxSeconds: 600,
    keyOptional: true,
  },
};

const LLM = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    main: { fast: 'gpt-4.1-mini', balanced: 'gpt-4.1-mini', best: 'gpt-4.1' },
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano'],
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    main: { fast: 'llama-3.3-70b-versatile', balanced: 'llama-3.3-70b-versatile', best: 'llama-3.3-70b-versatile' },
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    main: { fast: 'gemini-2.5-flash-lite', balanced: 'gemini-2.5-flash', best: 'gemini-2.5-flash' },
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  },
  anthropic: {
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    main: { fast: 'claude-opus-5-5', balanced: 'claude-opus-5-5', best: 'claude-opus-5-5' },
    effort: { fast: 'low', balanced: 'low', best: 'medium' },
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  custom: {
    label: 'Custom / local (OpenAI-compatible)',
    baseUrl: 'http://localhost:11434/v1',
    main: { fast: 'llama3.2', balanced: 'llama3.2', best: 'llama3.2' },
    models: ['llama3.2', 'qwen2.5:7b', 'gemma3'],
    keyOptional: true,
  },
};

class ServiceError extends Error {
  /** code: no_key | auth | quota | network | timeout | bad_request | server | refusal | empty */
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

function errorFor(status, body) {
  const msg = typeof body === 'string' ? body.slice(0, 300) : '';
  if (status === 401 || status === 403) return new ServiceError('auth', msg, status);
  if (status === 429) return new ServiceError('quota', msg, status);
  if (status === 404) return new ServiceError('bad_request', 'Model not found? ' + msg, status);
  if (status >= 400 && status < 500) return new ServiceError('bad_request', msg, status);
  return new ServiceError('server', msg, status);
}

async function request(url, init, timeoutMs, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ServiceError('timeout', 'timeout');
    throw new ServiceError('network', String(e?.message || e));
  }
  const text = await res.text();
  if (!res.ok) throw errorFor(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');
/** ~1 s Rechenzeit pro 10 s Audio + Puffer */
const sttTimeout = (wavBytes) => 30000 + Math.round(wavBytes / 32000) * 1000;

// ------------------------------------------------------------------ Spracherkennung
/**
 * @param {{provider:string, apiKey:string, baseUrl?:string, model:string, language?:string, prompt?:string, wav:Buffer, fetchImpl?:Function}} o
 */
async function transcribe(o) {
  const p = STT[o.provider];
  if (!p) throw new ServiceError('bad_request', 'unknown provider ' + o.provider);
  if (!o.apiKey && !p.keyOptional) throw new ServiceError('no_key', 'no key');
  const base = trimSlash(o.baseUrl || p.baseUrl);
  if (o.provider === 'gemini') return transcribeGemini(o, base);

  const form = new FormData();
  form.append('file', new Blob([o.wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', o.model);
  form.append('response_format', 'json');
  if (o.language && o.language !== 'auto') form.append('language', o.language);
  if (o.prompt) form.append('prompt', o.prompt);
  const headers = o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {};
  const json = await request(`${base}/audio/transcriptions`, { method: 'POST', headers, body: form }, sttTimeout(o.wav.length), o.fetchImpl);
  return String(json.text ?? '').trim();
}

async function transcribeGemini(o, base) {
  const lang = o.language && o.language !== 'auto' ? ` The language is "${o.language}".` : '';
  const hint = o.prompt ? ` Spelling hints (names and terms that may occur): ${o.prompt}` : '';
  const instruction =
    `Transcribe this audio exactly as spoken.${lang} Add normal punctuation and capitalization. ` +
    `Output only the transcript – no comments, no timestamps, no speaker labels. If there is no speech, output nothing.${hint}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: 'audio/wav', data: o.wav.toString('base64') } }] }],
    generationConfig: { temperature: 0, ...geminiThinking(o.model) },
  };
  const json = await request(
    `${base}/models/${encodeURIComponent(o.model)}:generateContent`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey }, body: JSON.stringify(body) },
    sttTimeout(o.wav.length) + 15000,
    o.fetchImpl,
  );
  return geminiText(json);
}

function geminiThinking(model) {
  // Flash-Modelle denken sonst erst nach – kostet hier nur Zeit
  return /flash/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
}
function geminiText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((p) => p.text || '')
    .join('')
    .trim();
}

// ------------------------------------------------------------------ KI-Korrektur
/**
 * @param {{provider:string, apiKey:string, baseUrl?:string, model:string, system:string, user:string, tempo?:string, fetchImpl?:Function}} o
 */
async function complete(o) {
  const p = LLM[o.provider];
  if (!p) throw new ServiceError('bad_request', 'unknown provider ' + o.provider);
  if (!o.apiKey && !p.keyOptional) throw new ServiceError('no_key', 'no key');
  const base = trimSlash(o.baseUrl || p.baseUrl);
  const timeout = 45000;

  if (o.provider === 'anthropic') return completeAnthropic(o, base, timeout);

  if (o.provider === 'gemini') {
    const body = {
      systemInstruction: { parts: [{ text: o.system }] },
      contents: [{ role: 'user', parts: [{ text: o.user }] }],
      generationConfig: { temperature: 0.1, ...geminiThinking(o.model) },
    };
    const json = await request(
      `${base}/models/${encodeURIComponent(o.model)}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey }, body: JSON.stringify(body) },
      timeout,
      o.fetchImpl,
    );
    return geminiText(json);
  }

  // OpenAI-kompatibel
  const reasoning = /^(o\d|gpt-5)/i.test(o.model);
  const body = {
    model: o.model,
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ],
    ...(reasoning ? {} : { temperature: 0.1 }),
  };
  const headers = { 'content-type': 'application/json', ...(o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {}) };
  const json = await request(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, timeout, o.fetchImpl);
  return String(json?.choices?.[0]?.message?.content ?? '').trim();
}

/** Modelle, für die Anthropic einen automatischen Ersatz bei einer Ablehnung anbietet */
const ANTHROPIC_FALLBACK = /^claude-(opus-5-5|sonnet-5-5|opus-5$|fable-5)/;

async function completeAnthropic(o, base, timeout) {
  const client = new Anthropic({ apiKey: o.apiKey, baseURL: base, timeout, maxRetries: 1, fetch: o.fetchImpl });
  const params = {
    model: o.model,
    max_tokens: 16000,
    system: o.system,
    messages: [{ role: 'user', content: o.user }],
    output_config: { effort: LLM.anthropic.effort[o.tempo] || 'low' },
  };
  let response;
  try {
    if (ANTHROPIC_FALLBACK.test(o.model)) {
      response = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } else {
      response = await client.messages.create(params);
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ServiceError('auth', e.message, e.status);
    if (e instanceof Anthropic.RateLimitError) throw new ServiceError('quota', e.message, e.status);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ServiceError('timeout', e.message);
    if (e instanceof Anthropic.APIConnectionError) throw new ServiceError('network', e.message);
    if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) throw new ServiceError('bad_request', e.message, e.status);
    if (e instanceof Anthropic.APIError) throw new ServiceError('server', e.message, e.status);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new ServiceError('refusal', response.stop_details?.explanation || 'refusal');
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Welche Modelle gelten gerade (eigene Angabe vor Voreinstellung).
 * hasKey(provider) → ob ein Schlüssel hinterlegt ist (für die automatische Wahl der KI-Korrektur).
 */
function resolveModels(services, tempo, hasKey = () => true) {
  const sttProvider = STT[services.stt.provider] ? services.stt.provider : 'local';
  const stt = STT[sttProvider];
  const llmProvider = resolveLlmProvider(services, hasKey);
  const llm = LLM[llmProvider];
  if (stt.local) {
    const id = (LOCAL_MODELS[services.local?.model] || LOCAL_MODELS.small).id;
    // lokal: Vorschau und Endergebnis mit demselben Modell → Vorschau wird wiederverwendet, keine doppelte Rechenzeit
    return { sttProvider, sttMain: id, sttPreview: id, sttMaxSeconds: stt.maxSeconds, pipeline: true, llmProvider, llmModel: llm ? services.llm.model || llm.main[tempo] : '' };
  }
  return {
    sttProvider,
    sttMain: services.stt.model || stt.main[tempo] || stt.main.balanced,
    sttPreview: services.stt.fastModel || stt.preview,
    sttMaxSeconds: stt.maxSeconds,
    llmProvider,
    llmModel: llm ? services.llm.model || llm.main[tempo] || '' : '',
  };
}
/** „auto“: derselbe Dienst wie die Spracherkennung, sonst der erste mit Schlüssel */
function resolveLlmProvider(services, hasKey = () => true) {
  const p = services.llm.provider;
  if (p && p !== 'same' && p !== 'auto') return p;
  if (LLM[services.stt.provider] && !STT[services.stt.provider]?.local && hasKey(services.stt.provider)) return services.stt.provider;
  return ['groq', 'openai', 'gemini', 'anthropic'].find((k) => hasKey(k)) || '';
}

module.exports = { STT, LLM, LOCAL_MODELS, ServiceError, transcribe, complete, resolveModels, resolveLlmProvider };
