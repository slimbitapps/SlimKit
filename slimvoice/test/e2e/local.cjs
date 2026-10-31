'use strict';
/**
 * Test der lokalen Spracherkennung mit echtem Modell-Download (braucht Internet, läuft in GitHub Actions).
 * Mikrofon = WAV-Datei mit gesprochenem Satz (SPEECH_WAV, z. B. mit espeak-ng erzeugt).
 *
 *   SPEECH_WAV=/tmp/mic.wav xvfb-run -a node test/e2e/local.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(200);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

(async () => {
  const wav = process.env.SPEECH_WAV;
  assert.ok(wav && fs.existsSync(wav), 'SPEECH_WAV fehlt');
  const model = process.env.LOCAL_MODEL || 'base';
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimvoice-local-'));
  const out = path.join(userData, 'out.txt');
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      onboarded: true,
      dictation: { mode: process.env.LOCAL_MODE || 'batch', language: 'en', sounds: false },
      ai: { level: 'off' },
      services: { stt: { provider: 'local' }, local: { model, device: 'auto' } },
    }),
  );
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox', '--lang=en'],
    env: { ...process.env, SLIMVOICE_TEST: '1', SLIMVOICE_USERDATA: userData, SLIMVOICE_OUTPUT: out, SLIMVOICE_FAKE_AUDIO: wav, SLIMVOICE_RAW_AUDIO: '1' },
  });
  const sv = (fn, arg) => app.evaluate(fn, arg);
  const readOut = () => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '');
  try {
    let t0 = Date.now();
    const res = await sv((_e, key) => globalThis.__slimvoice.localDownload(key), model);
    console.log('Download + Laden:', res.ok ? 'ok' : res.message, `${Math.round((Date.now() - t0) / 1000)} s`, JSON.stringify(res.loaded || {}));
    assert.equal(res.ok, true, 'Modell geladen');
    const cached = Object.entries(res.cached || {}).map(([k, v]) => `${k}: ${Math.round(v / 1e6)} MB`);
    console.log('Im Cache:', cached.join(', '));

    t0 = Date.now();
    await sv(() => globalThis.__slimvoice.toggleDictation());
    await sleep(Number(process.env.RECORD_MS || 7000));
    await sv(() => globalThis.__slimvoice.toggleDictation());
    await waitFor(() => readOut().trim().length > 0, 180000, 'Text eingefügt');
    const text = readOut();
    console.log('Erkannt:', JSON.stringify(text), `(${Math.round((Date.now() - t0) / 1000)} s inkl. Aufnahme)`);
    assert.match(text, /hello|world|test|speech|recognition/i);

    // zweiter Start: Modell ist im Cache → kein Download mehr nötig
    const status = await sv(() => globalThis.__slimvoice.engine.send('status'));
    assert.ok(Object.keys(status.cached).some((k) => k.includes('whisper')), 'Modell liegt im Cache');
    console.log('\n✓ Lokale Spracherkennung funktioniert');
  } catch (e) {
    console.error('✗', e);
    const log = path.join(userData, 'app.log');
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8'));
    process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
  }
})();
