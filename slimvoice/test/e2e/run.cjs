'use strict';
/**
 * Ende-zu-Ende-Test: startet die echte App mit einem simulierten Mikrofon (WAV-Datei mit zwei „Sätzen“
 * und Pausen dazwischen) und einem lokalen Test-Server statt OpenAI & Co.
 * Prüft: Sprechpausen-Erkennung → Abschnitte → Spracherkennung → KI → Einfügen, in allen drei Modi.
 * Macht dabei Screenshots der Oberfläche.
 *
 *   npm run test:e2e [screenshot-ordner]      (unter Linux ohne Bildschirm: xvfb-run -a npm run test:e2e)
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'slimvoice-shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

/** Simuliertes Mikrofon: Stille, „Sprache“ (moduliertes Rauschen + Ton), Stille, „Sprache“, lange Stille */
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
      const dataStart = text.indexOf('RIFF');
      const seconds = dataStart >= 0 ? (body.length - dataStart - 44) / 32000 : 0;
      calls.stt.push({ model, seconds });
      // 1 Abschnitt ≈ 1,5 s, beide zusammen > 2,5 s
      if (seconds > 2.6) return json({ text: 'hallo äh welt neuer absatz das ist ein test' });
      return json({ text: calls.stt.filter((c) => c.seconds <= 2.6).length % 2 ? 'hallo äh welt' : 'das ist ein test' });
    }
    if (req.url === '/v1/chat/completions') {
      const msg = JSON.parse(body.toString());
      const user = msg.messages[1].content;
      calls.llm.push({ model: msg.model, user });
      const dictation = /<dictation>\n([\s\S]*)\n<\/dictation>/.exec(user)?.[1];
      if (!dictation) return json({ choices: [{ message: { content: 'OK' } }] });
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
  makeWav(wav);
  const { srv, calls, url } = await startServer();
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      onboarded: true,
      ui: { lang: 'de', theme: 'dark' },
      dictation: { mode: 'preview', tempo: 'balanced', sounds: false, language: 'de' },
      ai: { level: 'light', vocabulary: ['SlimBit'] },
      services: { stt: { provider: 'custom', baseUrl: url, model: 'big-whisper', fastModel: 'small-whisper' }, llm: { provider: 'same', baseUrl: url, model: 'local-llm' } },
    }),
  );

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox', '--lang=de'],
    env: { ...process.env, SLIMVOICE_TEST: '1', SLIMVOICE_USERDATA: userData, SLIMVOICE_OUTPUT: out, SLIMVOICE_FAKE_AUDIO: wav, SLIMVOICE_RAW_AUDIO: '1', SLIMVOICE_FG_APP: 'OUTLOOK' },
  });
  const errors = [];
  const pageFor = async (name) => {
    await waitFor(() => app.windows().some((w) => w.url().includes(name)), 15000, name);
    const p = app.windows().find((w) => w.url().includes(name));
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
    return p;
  };
  const settingsWin = await pageFor('index.html');
  const overlay = await pageFor('overlay.html');
  const sv = (fn, arg) => app.evaluate(fn, arg);
  const readOut = () => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '');

  try {
    // ---------------------------------------------------------------- Einstellungen: Seiten durchklicken
    await settingsWin.setViewportSize({ width: 940, height: 680 });
    await settingsWin.waitForSelector('.nav-item');
    for (const [i, name] of ['start', 'diktat', 'ki', 'dienste', 'verlauf', 'allgemein'].entries()) {
      await settingsWin.locator('.nav-item').nth(i).click();
      await sleep(250);
      await settingsWin.screenshot({ path: path.join(SHOTS, `settings-${i + 1}-${name}.png`) });
    }
    // Dienst testen (gegen den Test-Server)
    await settingsWin.locator('.nav-item').nth(3).click();
    await settingsWin.locator('.test-row button').first().click();
    await settingsWin.waitForSelector('.test-row .badge.ok', { timeout: 10000 });
    await settingsWin.locator('.test-row button').nth(1).click();
    await waitFor(async () => (await settingsWin.locator('.test-row .badge.ok').count()) === 2, 10000, 'Verbindungstest KI');
    console.log('✓ Verbindungstest Spracherkennung + KI');

    // Einstellung über die Oberfläche ändern → landet in settings.json
    await settingsWin.locator('.nav-item').nth(2).click();
    await settingsWin.getByRole('radio', { name: /Stark/ }).click();
    await waitFor(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).ai.level === 'strong', 5000, 'KI-Stufe gespeichert');
    await settingsWin.getByRole('radio', { name: /Leicht/ }).click();
    console.log('✓ Einstellungen werden gespeichert');

    // ---------------------------------------------------------------- Modus „Live-Vorschau“
    calls.stt.length = 0;
    calls.llm.length = 0;
    await sv(({}) => globalThis.__slimvoice.toggleDictation(), {});
    await waitFor(() => calls.stt.filter((c) => c.model === 'small-whisper').length >= 2, 20000, 'zwei Vorschau-Abschnitte');
    await waitFor(async () => /Hallo welt/.test(await overlay.locator('#preview').innerText()), 5000, 'Vorschau im Overlay');
    await overlay.screenshot({ path: path.join(SHOTS, 'overlay-1-listening.png') });
    await sv(({}) => globalThis.__slimvoice.toggleDictation(), {});
    await waitFor(() => readOut().length > 0, 15000, 'Text eingefügt (preview)');
    await waitFor(async () => (await overlay.locator('#pill').getAttribute('data-state')) === 'done', 5000, 'Overlay fertig');
    await overlay.screenshot({ path: path.join(SHOTS, 'overlay-2-done.png') });
    const t1 = readOut();
    console.log('  eingefügt:', JSON.stringify(t1));
    assert.equal(t1, 'Hallo Welt\n\nDas ist ein Test. ');
    const final = calls.stt.filter((c) => c.model === 'big-whisper');
    assert.equal(final.length, 1, 'eine Anfrage in bester Qualität');
    assert.ok(final[0].seconds > 2.6 && final[0].seconds < 4.5, 'nur Sprache, keine lange Stille: ' + final[0].seconds);
    assert.equal(calls.llm.length, 1);
    assert.equal(calls.llm[0].model, 'local-llm');
    console.log('✓ Modus Live-Vorschau: Abschnitte, Vorschau, beste Qualität, KI, Einfügen');

    // ---------------------------------------------------------------- Modus „Sofort einfügen“
    fs.writeFileSync(out, '');
    calls.stt.length = 0;
    calls.llm.length = 0;
    await sv(({}) => globalThis.__slimvoice.settings.update({ dictation: { mode: 'live' }, ai: { level: 'off' } }), {});
    await sv(({}) => globalThis.__slimvoice.toggleDictation(), {});
    await waitFor(() => readOut().includes('ist ein test'), 20000, 'zwei Abschnitte live eingefügt');
    await sv(({}) => globalThis.__slimvoice.toggleDictation(), {});
    await sleep(800);
    const t2 = readOut();
    console.log('  eingefügt:', JSON.stringify(t2));
    assert.match(t2, /^Hallo welt das ist ein test /);
    assert.ok(calls.stt.every((c) => c.model === 'big-whisper'));
    assert.equal(calls.llm.length, 0, 'KI aus');
    console.log('✓ Modus Sofort einfügen (Füllwörter weg, KI aus)');

    // ---------------------------------------------------------------- Modus „Erst aufnehmen“ + Abbrechen
    fs.writeFileSync(out, '');
    calls.stt.length = 0;
    await sv(({}) => globalThis.__slimvoice.settings.update({ dictation: { mode: 'batch' } }), {});
    await sv(({}) => globalThis.__slimvoice.toggleDictation(), {});
    await sleep(2500);
    assert.equal(calls.stt.length, 0, 'batch: während der Aufnahme nichts verschickt');
    await sv(({}) => globalThis.__slimvoice.cancelDictation(), {});
    await sleep(1000);
    assert.equal(readOut(), '', 'abgebrochen → nichts eingefügt');
    assert.equal(calls.stt.length, 0);
    console.log('✓ Modus Erst aufnehmen: nichts verschickt; Abbrechen fügt nichts ein');

    // ---------------------------------------------------------------- Fehlender Schlüssel
    await sv(({}) => globalThis.__slimvoice.settings.update({ services: { stt: { provider: 'openai' } } }), {});
    await sv(({}) => globalThis.__slimvoice.toggleDictation(), {});
    await waitFor(async () => (await overlay.locator('#pill').getAttribute('data-state')) === 'error', 5000, 'Fehleranzeige');
    assert.match(await overlay.locator('#status').innerText(), /Kein API-Schlüssel für OpenAI/);
    await overlay.screenshot({ path: path.join(SHOTS, 'overlay-3-error.png') });
    console.log('✓ Fehlender Schlüssel wird verständlich angezeigt');

    // ---------------------------------------------------------------- Verlauf
    const hist = await sv(({}) => globalThis.__slimvoice.history.items, {});
    assert.ok(hist.length >= 2, 'Verlauf hat Einträge');
    assert.equal(hist[hist.length - 1].app, 'OUTLOOK');
    await settingsWin.locator('.nav-item').nth(4).click();
    await settingsWin.waitForSelector('.hist-item');
    await settingsWin.screenshot({ path: path.join(SHOTS, 'settings-5-verlauf.png') });
    console.log('✓ Verlauf');

    assert.deepEqual(errors, []);
    console.log(`\nAlles grün. Screenshots: ${SHOTS}`);
  } catch (e) {
    console.error('✗', e);
    console.error('Fehler in den Fenstern:', errors);
    const log = path.join(userData, 'app.log');
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8'));
    process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
    srv.close();
  }
})();
