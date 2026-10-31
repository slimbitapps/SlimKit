'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const text = require('../electron/core/text.cjs');
const wav = require('../electron/core/wav.cjs');
const prompts = require('../electron/core/prompts.cjs');
const providers = require('../electron/core/providers.cjs');
const { DictationSession, profileFor } = require('../electron/core/session.cjs');
const { DEFAULTS, merge, SecretStore } = require('../electron/core/settings.cjs');

test('Sprachbefehle', () => {
  assert.equal(text.applyVoiceCommands('Hallo zusammen neuer Absatz wie geht es euch'), 'Hallo zusammen\n\nWie geht es euch');
  assert.equal(text.applyVoiceCommands('first line. New line. second line'), 'first line\nSecond line');
});

test('Füllwörter', () => {
  assert.equal(text.removeFillers('Also äh ich wollte ähm sagen, dass'), 'Also ich wollte sagen, dass');
  assert.equal(text.removeFillers('Äh, hallo.'), 'hallo.');
  assert.equal(text.removeFillers('So um, I think uh yes', 'en'), 'So I think yes');
  // „er“ und „um“ im Deutschen nicht anfassen
  assert.equal(text.removeFillers('Er kommt um acht', 'de'), 'Er kommt um acht');
  assert.equal(text.removeFillers('Er kommt um acht äh', 'auto'), 'Er kommt um acht');
});

test('Ersetzungen', () => {
  assert.equal(text.applyReplacements('Danke und mfg', [{ from: 'mfg', to: 'Mit freundlichen Grüßen' }]), 'Danke und Mit freundlichen Grüßen');
  assert.equal(text.applyReplacements('amfgx bleibt', [{ from: 'mfg', to: 'X' }]), 'amfgx bleibt');
});

test('Halluzinationen bei Stille', () => {
  assert.ok(text.isHallucination('Untertitel im Auftrag des ZDF, 2020'));
  assert.ok(text.isHallucination('Vielen Dank fürs Zuschauen!'));
  assert.ok(text.isHallucination('Thank you for watching.'));
  assert.ok(!text.isHallucination('Vielen Dank für deine Nachricht.'));
  assert.equal(text.localCleanup(' Untertitel von Stephanie Geiges '), '');
});

test('Abschnitte aneinanderhängen', () => {
  assert.equal(text.joinSegment('', 'hallo'), 'Hallo');
  assert.equal(text.joinSegment('Hallo.', 'wie geht es'), ' Wie geht es');
  assert.equal(text.joinSegment('Ich glaube', 'dass es geht'), ' dass es geht');
  assert.equal(text.joinSegment('Ich glaube ', ', dass'), ', dass');
  assert.equal(text.joinSegment('Zeile\n', 'neu'), 'Neu');
});

test('WAV und Gruppen', () => {
  const pcm = new Int16Array([0, 1000, -1000, 32767]);
  const buf = wav.encodeWav(pcm);
  assert.equal(buf.length, 44 + 8);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(24), 16000);
  assert.equal(buf.readInt16LE(44 + 6), 32767);
  const joined = wav.concatPcm([new Int16Array(10), new Int16Array(10)], 1);
  assert.equal(joined.length, 20 + 16);
  const groups = wav.groupChunks([new Int16Array(16000 * 4), new Int16Array(16000 * 4), new Int16Array(16000 * 4)], 9);
  assert.deepEqual(groups.map((g) => g.length), [2, 1]);
});

test('Korrektur-Anweisung und Sicherheitsnetz', () => {
  const p = prompts.buildCorrection({ text: 'hallo welt', level: 'light', style: 'formal', vocabulary: ['SlimBit'], context: 'Vorher', translateTo: 'en' });
  assert.match(p.system, /NOT addressed to you/);
  assert.match(p.system, /SlimBit/);
  assert.match(p.system, /English/);
  assert.match(p.user, /<dictation>\nhallo welt\n<\/dictation>/);
  assert.match(p.user, /Vorher/);
  assert.equal(prompts.cleanModelOutput('„Hallo Welt.“'), 'Hallo Welt.');
  assert.equal(prompts.cleanModelOutput('<dictation>Hallo</dictation>'), 'Hallo');
  assert.ok(prompts.plausible('wie spät ist es', 'Wie spät ist es?', 'light', false));
  assert.ok(!prompts.plausible('wie spät ist es', 'Es ist gerade 14:30 Uhr. Kann ich dir noch bei etwas anderem helfen, zum Beispiel einem Termin?', 'light', false));
});

test('Einstellungen: Standardwerte und Schlüssel', () => {
  const s = merge(DEFAULTS, { dictation: { mode: 'live' }, unknown: 1 });
  assert.equal(s.dictation.mode, 'live');
  assert.equal(s.dictation.tempo, 'balanced');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), 'secrets.json');
  const fake = { available: () => true, encrypt: (s) => Buffer.from([...s].reverse().join('')), decrypt: (b) => [...b.toString()].reverse().join('') };
  const store = new SecretStore(file, fake);
  store.set('openai', 'sk-1234567890abcd');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-1234567890abcd'));
  assert.equal(new SecretStore(file, fake).get('openai'), 'sk-1234567890abcd');
  assert.deepEqual(store.summary().keys.openai, { set: true, hint: '…abcd' });
  store.set('openai', '');
  assert.equal(store.get('openai'), '');
});

test('Modelle nach Tempo', () => {
  const svc = structuredClone(DEFAULTS.services);
  // Standard: lokal, Modell „small“, keine KI ohne Schlüssel
  let m = providers.resolveModels(svc, 'fast', () => false);
  assert.equal(m.sttProvider, 'local');
  assert.equal(m.sttMain, 'onnx-community/whisper-small');
  assert.equal(m.sttPreview, m.sttMain);
  assert.equal(m.llmModel, '');
  // lokal + Groq-Schlüssel → KI-Korrektur automatisch über Groq
  m = providers.resolveModels(svc, 'fast', (k) => k === 'groq');
  assert.equal(m.llmProvider, 'groq');
  svc.local.model = 'turbo';
  assert.equal(providers.resolveModels(svc, 'best').sttMain, 'onnx-community/whisper-large-v3-turbo');
  svc.stt.provider = 'openai';
  m = providers.resolveModels(svc, 'fast');
  assert.equal(m.sttMain, 'gpt-4o-mini-transcribe');
  assert.equal(m.llmProvider, 'openai');
  svc.stt.provider = 'custom';
  m = providers.resolveModels(svc, 'best');
  assert.equal(m.llmProvider, 'custom');
  svc.llm.provider = 'anthropic';
  m = providers.resolveModels(svc, 'best');
  assert.equal(m.llmModel, 'claude-opus-5-5');
  svc.llm.model = 'claude-haiku-5-5';
  assert.equal(providers.resolveModels(svc, 'best').llmModel, 'claude-haiku-5-5');
});

test('App-Profile', () => {
  const profiles = [{ match: 'outlook', style: 'formal' }, { match: 'Slack', style: 'casual', level: 'punct' }];
  assert.equal(profileFor(profiles, 'OUTLOOK').style, 'formal');
  assert.equal(profileFor(profiles, 'slack').level, 'punct');
  assert.equal(profileFor(profiles, 'Code'), null);
});

// ------------------------------------------------------------------ Dienste gegen einen Testserver
function mockServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const out = await handler(req, Buffer.concat(chunks));
      res.writeHead(out.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('OpenAI-kompatible Spracherkennung und Korrektur', async () => {
  const seen = [];
  const { srv, url } = await mockServer((req, body) => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: body.toString('latin1') });
    if (req.url === '/v1/audio/transcriptions') return { body: { text: ' hallo welt ' } };
    if (req.url === '/v1/chat/completions') return { body: { choices: [{ message: { content: 'Hallo Welt.' } }] } };
    return { status: 404, body: {} };
  });
  try {
    const t = await providers.transcribe({ provider: 'custom', apiKey: 'k', baseUrl: url + '/v1/', model: 'whisper-1', language: 'de', prompt: 'SlimBit', wav: wav.encodeWav(new Int16Array(160)) });
    assert.equal(t, 'hallo welt');
    assert.equal(seen[0].auth, 'Bearer k');
    assert.match(seen[0].body, /name="model"\r\n\r\nwhisper-1/);
    assert.match(seen[0].body, /name="language"\r\n\r\nde/);
    assert.match(seen[0].body, /RIFF/);
    const c = await providers.complete({ provider: 'custom', apiKey: '', baseUrl: url + '/v1', model: 'llama3.2', system: 's', user: 'u' });
    assert.equal(c, 'Hallo Welt.');
    assert.equal(seen[1].auth, undefined);
    assert.equal(JSON.parse(seen[1].body).messages[0].content, 's');
  } finally {
    srv.close();
  }
});

test('Fehler werden verständlich eingeordnet', async () => {
  const { srv, url } = await mockServer(() => ({ status: 401, body: { error: 'bad key' } }));
  try {
    await assert.rejects(
      providers.transcribe({ provider: 'openai', apiKey: 'x', baseUrl: url, model: 'm', wav: Buffer.alloc(44) }),
      (e) => e.code === 'auth',
    );
    await assert.rejects(providers.transcribe({ provider: 'openai', apiKey: '', model: 'm', wav: Buffer.alloc(44) }), (e) => e.code === 'no_key');
  } finally {
    srv.close();
  }
});

test('Gemini: Audio inline, Text zurück', async () => {
  let got;
  const { srv, url } = await mockServer((req, body) => {
    got = { url: req.url, key: req.headers['x-goog-api-key'], json: JSON.parse(body.toString()) };
    return { body: { candidates: [{ content: { parts: [{ text: 'Hallo ' }, { text: 'Welt' }] } }] } };
  });
  try {
    const t = await providers.transcribe({ provider: 'gemini', apiKey: 'g', baseUrl: url, model: 'gemini-2.5-flash', wav: wav.encodeWav(new Int16Array(16)) });
    assert.equal(t, 'Hallo Welt');
    assert.equal(got.url, '/models/gemini-2.5-flash:generateContent');
    assert.equal(got.key, 'g');
    assert.equal(got.json.contents[0].parts[1].inline_data.mime_type, 'audio/wav');
    assert.deepEqual(got.json.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  } finally {
    srv.close();
  }
});

test('Anthropic: Messages-Anfrage mit Ersatzmodell bei Ablehnung', async () => {
  let got;
  const { srv, url } = await mockServer((req, body) => {
    got = { url: req.url, key: req.headers['x-api-key'] || req.headers.authorization, beta: req.headers['anthropic-beta'], json: JSON.parse(body.toString()) };
    return {
      body: {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
        content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Hallo Welt.' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
  });
  try {
    const out = await providers.complete({ provider: 'anthropic', apiKey: 'a', baseUrl: url, model: 'claude-opus-5-5', system: 's', user: 'u', tempo: 'best' });
    assert.equal(out, 'Hallo Welt.');
    assert.match(got.url, /^\/v1\/messages/);
    assert.match(got.key, /^(Bearer )?a$/);
    assert.match(got.beta, /server-side-fallback-2026-07-01/);
    assert.equal(got.json.fallbacks, 'default');
    assert.deepEqual(got.json.output_config, { effort: 'medium' });
    assert.equal(got.json.system, 's');
  } finally {
    srv.close();
  }
});

// ------------------------------------------------------------------ Ablauf eines Diktats
function makeSession(mode, { stt, llm, ai = {}, dictation = {}, models = {} } = {}) {
  const cfg = merge(DEFAULTS, { dictation: { mode, ...dictation }, ai: { level: 'light', ...ai } });
  const inserted = [];
  const events = [];
  const calls = { stt: [], llm: [] };
  const s = new DictationSession({
    id: 1,
    cfg,
    models: { sttMain: 'main', sttPreview: 'preview', sttMaxSeconds: 600, llmModel: 'llm', ...models },
    deps: {
      transcribe: async (o) => {
        calls.stt.push(o);
        return stt(o);
      },
      complete: async (o) => {
        calls.llm.push(o);
        return llm ? llm(o) : o.user.match(/<dictation>\n([\s\S]*)\n<\/dictation>/)[1].toUpperCase();
      },
      insert: async (t) => {
        inserted.push(t);
      },
      emit: (e) => events.push(e),
    },
  });
  return { s, inserted, events, calls };
}
const pcm = (n = 1600) => new Int16Array(n);
const tick = () => new Promise((r) => setTimeout(r, 5));

test('Modus live: Abschnitte werden in der richtigen Reihenfolge eingefügt', async () => {
  const delays = [30, 5];
  let i = 0;
  const { s, inserted, calls } = makeSession('live', {
    stt: async () => {
      const n = i++;
      await new Promise((r) => setTimeout(r, delays[n]));
      return ['erster satz.', 'zweiter satz.'][n];
    },
  });
  s.addSegment(0, pcm());
  s.addSegment(1, pcm());
  const res = await s.finish();
  assert.deepEqual(inserted, ['ERSTER SATZ. ', 'ZWEITER SATZ. ']);
  assert.equal(res.text, 'ERSTER SATZ. ZWEITER SATZ.');
  assert.equal(calls.stt[0].model, 'main');
});

test('Modus preview: Vorschau schnell, am Ende einmal in bester Qualität', async () => {
  const { s, inserted, events, calls } = makeSession('preview', {
    stt: async (o) => (o.model === 'preview' ? 'vorschau' : 'hallo äh welt neuer absatz zweite zeile'),
  });
  s.addSegment(0, pcm());
  s.addSegment(1, pcm());
  await tick();
  assert.ok(events.some((e) => e.type === 'preview' && e.text === 'Vorschau vorschau'));
  const res = await s.finish();
  assert.equal(inserted.length, 1);
  assert.equal(res.raw, 'Hallo welt\n\nZweite zeile');
  assert.equal(inserted[0], 'HALLO WELT\n\nZWEITE ZEILE ');
  // beide Abschnitte in einer Anfrage
  assert.equal(calls.stt.filter((c) => c.model === 'main').length, 1);
});

test('Modus preview: gleiches Modell → Vorschau wird wiederverwendet (keine Doppelkosten)', async () => {
  const { s, calls } = makeSession('preview', { stt: async () => 'eins', models: { sttPreview: 'same', sttMain: 'same' } });
  s.addSegment(0, pcm());
  await s.finish();
  assert.equal(calls.stt.length, 1);
});

test('Modus batch, KI aus, App-Profil, Ersetzungen', async () => {
  const { s, inserted, calls } = makeSession('batch', {
    stt: async () => 'gruß mfg',
    ai: { level: 'off', replacements: [{ from: 'mfg', to: 'Max' }], profiles: [] },
    dictation: { trailingSpace: false },
  });
  s.addSegment(0, pcm());
  await s.finish();
  assert.deepEqual(inserted, ['Gruß Max']);
  assert.equal(calls.llm.length, 0);
});

test('KI antwortet statt zu korrigieren → Originaltext bleibt', async () => {
  const { s, inserted, events } = makeSession('batch', {
    stt: async () => 'wie spät ist es',
    llm: async () => 'Es ist 14:30 Uhr. Brauchst du sonst noch etwas? Ich helfe dir gerne weiter bei allem.',
  });
  s.addSegment(0, pcm());
  await s.finish();
  assert.equal(inserted[0], 'Wie spät ist es ');
  assert.ok(events.some((e) => e.code === 'ai_implausible'));
});

test('KI-Fehler → Originaltext, Spracherkennungs-Fehler → Vorschau als Ersatz', async () => {
  const { s, inserted, events } = makeSession('preview', {
    stt: async (o) => {
      if (o.model === 'main') throw Object.assign(new Error('down'), { code: 'server' });
      return 'aus der vorschau';
    },
    llm: async () => {
      throw Object.assign(new Error('x'), { code: 'quota' });
    },
  });
  s.addSegment(0, pcm());
  await s.finish();
  assert.equal(inserted[0], 'Aus der vorschau ');
  assert.ok(events.some((e) => e.code === 'used_preview'));
  assert.ok(events.some((e) => e.code === 'ai_failed:quota'));
});

test('Abbrechen fügt nichts ein', async () => {
  const { s, inserted } = makeSession('batch', { stt: async () => 'text' });
  s.addSegment(0, pcm());
  s.cancel();
  await s.finish();
  assert.deepEqual(inserted, []);
});

test('Profil überschreibt Stil und Stufe', () => {
  const { s } = makeSession('batch', { stt: async () => '', ai: { profiles: [{ match: 'outlook', style: 'formal', level: 'inherit' }] } });
  const s2 = new DictationSession({ id: 2, cfg: s.cfg, models: s.models, appName: 'OUTLOOK', deps: s.deps });
  assert.equal(s2.ai.style, 'formal');
  assert.equal(s2.ai.level, 'light');
});

// ------------------------------------------------------------------ Taste halten / tippen
const { KeyHoldMachine } = require('../electron/core/keyhook.cjs');
function machine() {
  let t = 0;
  const timers = [];
  const log = [];
  let recording = false;
  const m = new KeyHoldMachine({
    holdMs: 200,
    now: () => t,
    setTimer: (fn, ms) => {
      const tm = { at: t + ms, fn };
      timers.push(tm);
      return tm;
    },
    clearTimer: (tm) => timers.splice(timers.indexOf(tm), 1),
    isRecording: () => recording,
    onStart: (how) => {
      recording = true;
      log.push('start:' + how);
    },
    onStop: () => {
      recording = false;
      log.push('stop');
    },
    onAbort: () => {
      recording = false;
      log.push('abort');
    },
  });
  m.setKey(3613);
  const advance = (ms) => {
    t += ms;
    for (const tm of [...timers]) if (tm.at <= t) (timers.splice(timers.indexOf(tm), 1), tm.fn());
  };
  return { m, log, advance };
}

test('Taste halten = Push-to-talk', () => {
  const { m, log, advance } = machine();
  m.keydown(3613);
  advance(100);
  m.keydown(3613); // Wiederholung
  advance(800);
  m.keyup(3613);
  assert.deepEqual(log, ['start:hold', 'stop']);
});

test('Kurz tippen = freihändig, nochmal tippen = Ende', () => {
  const { m, log, advance } = machine();
  m.keydown(3613);
  advance(80);
  m.keyup(3613);
  advance(3000);
  m.keydown(30); // normales Tippen während des Diktats stört nicht
  m.keyup(30);
  m.keydown(3613);
  advance(60);
  m.keyup(3613);
  assert.deepEqual(log, ['start:tap', 'stop']);
});

test('Tastenkombination (rechte Strg + C) startet kein Diktat', () => {
  const { m, log, advance } = machine();
  m.keydown(3613);
  advance(50);
  m.keydown(46);
  advance(500);
  m.keyup(46);
  m.keyup(3613);
  assert.deepEqual(log, []);
});

test('Lokal + „Erst aufnehmen“: rechnet schon während der Aufnahme, am Ende keine zweite Runde', async () => {
  const { s, inserted, calls } = makeSession('batch', { stt: async () => 'eins zwei', ai: { level: 'off' }, models: { sttPreview: 'm', sttMain: 'm', pipeline: true } });
  s.addSegment(0, pcm());
  s.addSegment(1, pcm());
  await tick();
  assert.equal(calls.stt.length, 2, 'während der Aufnahme umgewandelt');
  await s.finish();
  assert.equal(calls.stt.length, 2, 'am Ende nichts mehr');
  assert.deepEqual(inserted, ['Eins zwei eins zwei ']);
});

test('Befehlsmodus: Anweisung + Markierung', () => {
  const p = prompts.buildCommand({ instruction: 'übersetze ins Englische', selection: 'Hallo Welt' });
  assert.match(p.user, /<selected_text>\nHallo Welt\n<\/selected_text>/);
  assert.match(p.system, /replaces the selection/);
  const q = prompts.buildCommand({ instruction: 'schreib eine Absage' });
  assert.match(q.system, /Nothing is selected/);
});
