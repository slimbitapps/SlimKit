'use strict';
/**
 * Ende-zu-Ende-Test: startet die echte App (Tauri) mit simuliertem Mikrofon (WAV-Datei) und einem lokalen
 * Test-Server statt OpenAI & Co. Gesteuert wird über die Test-Schnittstelle der App (nur mit SLIMVOICE_TEST).
 * Prüft Sprechpausen → Abschnitte → Erkennung → KI → Einfügen in allen Modi, Befehlsmodus, Halten/Tippen,
 * Wörter pro Programm, Verlauf. Macht Bildschirmfotos.
 *
 *   xvfb-run -a -s "-screen 0 1400x900x24" node test/e2e/run.cjs [screenshot-ordner]
 *   LOCAL_MODEL=base → zusätzlich echte lokale Erkennung mit Download + eingebautem Selbsttest (braucht Internet)
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'slimvoice-shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const BIN = process.env.SLIMVOICE_BIN || path.join(ROOT, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'slimvoice.exe' : 'slimvoice');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(150);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}
function shot(name) {
  if (process.platform !== 'linux') return;
  try {
    execFileSync('import', ['-window', 'root', path.join(SHOTS, name + '.png')]);
  } catch {
    /* kein ImageMagick */
  }
}

/** Simuliertes Mikrofon: Stille, „Sprache“, Stille, „Sprache“, lange Stille (Chromium-unabhängig, 48 kHz) */
function makeWav(file) {
  const rate = 48000;
  const parts = [
    [0.8, 0],
    [1.3, 1],
    [1.4, 0],
    [1.1, 1],
    [3.0, 0],
  ];
  const total = parts.reduce((n, p) => n + Math.round(p[0] * rate), 0);
  const pcm = new Int16Array(total);
  let o = 0;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [sec, voiced] of parts) {
    const n = Math.round(sec * rate);
    for (let i = 0; i < n; i++, o++) {
      const t = o / rate;
      const v = voiced ? (0.25 * Math.sin(2 * Math.PI * 180 * t) + 0.12 * rnd()) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.002 * rnd();
      pcm[o] = Math.round(v * 32767);
    }
  }
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  fs.writeFileSync(file, buf);
}

/** Test-Server im OpenAI-Format */
function startServer() {
  const calls = { stt: [], llm: [] };
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (o) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (req.url === '/v1/audio/transcriptions') {
      const text = body.toString('latin1');
      const model = /name="model"\r\n\r\n([^\r]+)/.exec(text)?.[1];
      const prompt = /name="prompt"\r\n\r\n([^\r]*)/.exec(text)?.[1] || '';
      const dataStart = text.indexOf('RIFF');
      const seconds = dataStart >= 0 ? (body.length - dataStart - 44) / 32000 : 0;
      calls.stt.push({ model, seconds, prompt });
      if (seconds > 2.6) return json({ text: 'hallo äh welt neuer absatz das ist ein test' });
      return json({ text: calls.stt.filter((c) => c.seconds <= 2.6).length % 2 ? 'hallo äh welt' : 'das ist ein test' });
    }
    if (req.url === '/v1/chat/completions') {
      const msg = JSON.parse(body.toString());
      const user = msg.messages[1].content;
      calls.llm.push({ model: msg.model, user, system: msg.messages[0].content });
      const dictation = /<dictation>\n([\s\S]*)\n<\/dictation>/.exec(user)?.[1];
      if (!dictation) {
        const instr = /<instruction>\n([\s\S]*)\n<\/instruction>/.exec(user)?.[1];
        const sel = /<selected_text>\n([\s\S]*)\n<\/selected_text>/.exec(user)?.[1];
        return json({ choices: [{ message: { content: instr ? `[${instr}] ${sel || ''}`.trim() : 'OK' } }] });
      }
      return json({ choices: [{ message: { content: dictation.replace(/welt/i, 'Welt').replace(/test$/i, 'Test') + '.' } }] });
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, calls, url: `http://127.0.0.1:${srv.address().port}/v1` })));
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimvoice-e2e-'));
  const wav = path.join(userData, 'mic.wav');
  const out = path.join(userData, 'out.txt');
  const portFile = path.join(userData, 'port');
  makeWav(wav);
  const { srv, calls, url } = await startServer();
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      onboarded: true,
      ui: { lang: 'de', theme: 'dark', mode: 'expert' },
      dictation: { mode: 'preview', tempo: 'balanced', sounds: false, language: 'de' },
      ai: { level: 'light', vocabulary: ['SlimBit'], profiles: [{ match: 'outlook', style: 'formal', vocabulary: ['Rechnungsnummer'], replacements: [{ from: 'mfg', to: 'Mit freundlichen Grüßen' }] }] },
      services: { stt: { provider: 'custom', baseUrl: url, model: 'big-whisper', fastModel: 'small-whisper' }, llm: { provider: 'custom', baseUrl: url, model: 'local-llm' } },
    }),
  );
  const env = { ...process.env, SLIMVOICE_TEST: '1', SLIMVOICE_USERDATA: userData, SLIMVOICE_OUTPUT: out, SLIMVOICE_FAKE_AUDIO: wav, SLIMVOICE_CONTROL_FILE: portFile, SLIMVOICE_FG_APP: 'OUTLOOK', SLIMVOICE_SELECTION: 'Hey Leute', LANG: 'de_DE.UTF-8' };
  const app = spawn(BIN, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let appLog = '';
  app.stdout.on('data', (d) => (appLog += d));
  app.stderr.on('data', (d) => (appLog += d));
  const readOut = () => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '');
  let base = '';
  const ctl = async (p, body) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  const dispatch = (ch, ...args) => ctl('/dispatch', { ch, args });
  const recording = async () => (await ctl('/state')).recording;

  try {
    await waitFor(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').length > 0, 60000, 'App startet');
    base = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8')}`;
    await waitFor(() => /setup: ready/.test(appLog), 60000, 'App fertig eingerichtet');
    await sleep(2500); // Fenster aufbauen lassen
    shot('settings-1-start');
    for (const page of ['dictation', 'words', 'ai', 'services', 'general']) {
      await ctl('/nav', { page });
      await sleep(700);
      shot('settings-' + page);
    }

    // ---------------------------------------------------------------- Verbindungstest
    const t1 = await dispatch('service:test', 'stt');
    const t2 = await dispatch('service:test', 'llm');
    assert.equal(t1.ok, true, JSON.stringify(t1));
    assert.equal(t2.ok, true, JSON.stringify(t2));
    console.log('✓ Verbindungstest Spracherkennung + KI');

    // ---------------------------------------------------------------- Live-Vorschau
    await ctl('/toggle');
    await waitFor(() => calls.stt.filter((c) => c.model === 'small-whisper').length >= 2, 20000, 'zwei Vorschau-Abschnitte');
    await sleep(300);
    shot('overlay-1-listening');
    await ctl('/toggle');
    await waitFor(() => readOut().length > 0, 15000, 'Text eingefügt (preview)');
    await sleep(300);
    shot('overlay-2-done');
    const out1 = readOut();
    console.log('  eingefügt:', JSON.stringify(out1));
    assert.equal(out1, 'Hallo Welt\n\nDas ist ein Test. ');
    const final = calls.stt.filter((c) => c.model === 'big-whisper' && c.seconds > 1);
    assert.equal(final.length, 1, 'eine Anfrage in bester Qualität');
    assert.ok(final[0].seconds > 2.6 && final[0].seconds < 4.6, 'nur Sprache, keine lange Stille: ' + final[0].seconds);
    // App-Profil „outlook“: eigene Wörter gehen an Erkennung und KI, Stil förmlich
    assert.match(final[0].prompt, /SlimBit, Rechnungsnummer/);
    assert.match(calls.llm.at(-1).system, /business email/);
    assert.match(calls.llm.at(-1).system, /Rechnungsnummer/);
    console.log('✓ Live-Vorschau: Abschnitte, Vorschau, beste Qualität, KI, Einfügen, Wörter pro Programm');

    // ---------------------------------------------------------------- Sofort einfügen, KI aus
    fs.writeFileSync(out, '');
    calls.stt.length = 0;
    calls.llm.length = 0;
    await dispatch('settings:set', { dictation: { mode: 'live' }, ai: { level: 'off' } });
    await ctl('/toggle');
    await waitFor(() => readOut().includes('ist ein test'), 20000, 'zwei Abschnitte live eingefügt');
    await ctl('/toggle');
    await sleep(800);
    console.log('  eingefügt:', JSON.stringify(readOut()));
    assert.match(readOut(), /^Hallo welt das ist ein test /);
    assert.equal(calls.llm.length, 0, 'KI aus');
    console.log('✓ Sofort einfügen (Füllwörter weg, KI aus)');

    // ---------------------------------------------------------------- Halten = sprechen, tippen = freihändig
    fs.writeFileSync(out, '');
    await ctl('/hold/press');
    await waitFor(recording, 3000, 'Halten startet');
    await sleep(3500);
    await ctl('/hold/release');
    await waitFor(async () => !(await recording()), 3000, 'Loslassen beendet');
    await waitFor(() => readOut().length > 0, 15000, 'Loslassen fügt ein');
    fs.writeFileSync(out, '');
    await ctl('/hold/press');
    await sleep(120);
    await ctl('/hold/release');
    await sleep(800);
    assert.equal(await recording(), true, 'kurz getippt → läuft freihändig weiter');
    await ctl('/hold/press');
    await ctl('/hold/release');
    await waitFor(async () => !(await recording()), 3000, 'nochmal drücken beendet');
    console.log('✓ Halten = sprechen, kurz tippen = freihändig');

    // ---------------------------------------------------------------- Befehlsmodus
    await sleep(1500);
    fs.writeFileSync(out, '');
    calls.llm.length = 0;
    await ctl('/command');
    await sleep(3500);
    shot('overlay-3-befehl');
    await ctl('/command');
    await waitFor(() => readOut().length > 0, 15000, 'Befehl ausgeführt');
    console.log('  eingefügt:', JSON.stringify(readOut()));
    assert.match(readOut(), /^\[.+\] Hey Leute$/);
    assert.match(calls.llm[0].user, /<selected_text>\nHey Leute/);
    console.log('✓ Befehlsmodus: Markierung + gesprochene Anweisung → KI → ersetzt');

    // ---------------------------------------------------------------- Erst aufnehmen + Abbrechen
    await sleep(1500);
    fs.writeFileSync(out, '');
    calls.stt.length = 0;
    await dispatch('settings:set', { dictation: { mode: 'batch' } });
    await ctl('/toggle');
    await sleep(2500);
    assert.equal(calls.stt.length, 0, 'batch: während der Aufnahme nichts verschickt');
    await ctl('/cancel');
    await sleep(1000);
    assert.equal(readOut(), '');
    assert.equal(calls.stt.length, 0);
    console.log('✓ Erst aufnehmen: nichts verschickt; Abbrechen fügt nichts ein');

    // ---------------------------------------------------------------- Fehlender Schlüssel / fehlendes Modell
    await dispatch('settings:set', { services: { stt: { provider: 'openai' } } });
    await ctl('/toggle');
    await sleep(800);
    shot('overlay-4-fehler');
    assert.equal(await recording(), false);
    await dispatch('settings:set', { services: { stt: { provider: 'local' } } });
    const snap = await dispatch('app:snapshot');
    assert.equal(Object.keys(snap.local.downloaded).length, 0);
    console.log('✓ Fehlender Schlüssel / fehlendes Modell wird abgefangen');

    // ---------------------------------------------------------------- Verlauf + Einrichtungs-Assistent
    const hist = await dispatch('history:list');
    assert.ok(hist.length >= 3, 'Verlauf hat Einträge');
    assert.ok(hist.some((h) => h.mode === 'command'));
    assert.ok(hist.some((h) => h.app === 'OUTLOOK'));
    await ctl('/nav', { page: 'history' });
    await sleep(700);
    shot('settings-history');
    await dispatch('settings:set', { onboarded: false, wizardStep: 0, ui: { mode: 'simple' } });
    await ctl('/nav', { page: 'welcome' });
    await sleep(900);
    shot('wizard-1');
    await dispatch('settings:set', { wizardStep: 1 });
    await sleep(900);
    shot('wizard-2-lokal');
    await dispatch('settings:set', { services: { stt: { provider: 'groq' } } });
    await sleep(900);
    shot('wizard-3-groq');
    // Schritt bleibt gespeichert (vorher fing der Assistent immer von vorne an)
    const s2 = await dispatch('app:snapshot');
    assert.equal(s2.settings.wizardStep, 1);
    console.log('✓ Verlauf, Einrichtungs-Assistent merkt sich den Schritt');

    // ---------------------------------------------------------------- Echte lokale Erkennung (nur mit Internet)
    if (process.env.LOCAL_MODEL) {
      console.log('… lokale Erkennung: Download', process.env.LOCAL_MODEL);
      const t0 = Date.now();
      const r = await dispatch('local:download', process.env.LOCAL_MODEL);
      console.log('  Download + Selbsttest:', Math.round((Date.now() - t0) / 1000), 's', JSON.stringify(r));
      assert.equal(r.ok, true);
      assert.equal(r.test.ok, true, 'Selbsttest erkennt die Sprachprobe');
      console.log('✓ Lokale Erkennung: Download + eingebauter Selbsttest');
    }

    console.log(`\nAlles grün. Screenshots: ${SHOTS}`);
  } catch (e) {
    console.error('✗', e);
    const log = path.join(userData, 'app.log');
    if (fs.existsSync(log)) console.error('--- app.log\n' + fs.readFileSync(log, 'utf8'));
    console.error('--- Ausgabe\n' + appLog.slice(-4000));
    process.exitCode = 1;
  } finally {
    app.kill();
    srv.close();
  }
})();
