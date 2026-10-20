'use strict';
/**
 * End-to-End-Test: startet die echte App (Electron) und spielt alles durch –
 * Einführung, Rechtsklick-Menü einrichten, Start per Rechtsklick (--action=…),
 * Ordnerstruktur, Umbenennen, Bilder, Datum, PDF, Sortieren, Senden & Empfangen (Handy-Fenster),
 * Automatik "Neues Jahr", Verlauf mit Rückgängig, Einstellungen. Macht dabei Screenshots.
 *
 *   npm run test:e2e [screenshot-ordner]
 *   E2E_LANG=en node test/e2e/run.cjs marketing/raw/en
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'slimkit-shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const lang = process.env.E2E_LANG || 'de';
const L = (de, en) => (lang === 'de' ? de : en);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ls = (d) => fs.readdirSync(d).filter((n) => !n.startsWith('.')).sort();

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimkit-e2e-'));
  const services = path.join(userData, 'Services');
  // Testordner mit echten Bildern (schöne Farbverläufe statt eigener Fotos)
  const work = path.join(fs.realpathSync(os.tmpdir()), `slimkit-e2e-files-${Date.now()}`);
  const photos = path.join(work, L('Fotos 2025', 'Photos 2025'));
  const months = L(['2025-01 Januar', '2025-02 Februar', '2025-03 März', '2025-07 Urlaub Italien', '2025-12 Weihnachten'], ['2025-01 January', '2025-02 February', '2025-03 March', '2025-07 Italy trip', '2025-12 Christmas']);
  for (const m of months) fs.mkdirSync(path.join(photos, m), { recursive: true });
  fs.mkdirSync(path.join(photos, months[3], L('Strand', 'Beach')), { recursive: true });
  fs.mkdirSync(path.join(photos, months[3], 'Rom'), { recursive: true });
  const school = path.join(work, L('Schule', 'School'));
  fs.mkdirSync(path.join(school, L('Schuljahr 2025-2026', 'School year 2025-2026'), L('Mathe', 'Maths')), { recursive: true });
  fs.mkdirSync(path.join(school, L('Schuljahr 2025-2026', 'School year 2025-2026'), L('Deutsch', 'English')), { recursive: true });
  fs.mkdirSync(path.join(school, L('Schuljahr 2025-2026', 'School year 2025-2026'), L('Bio', 'Biology')), { recursive: true });
  const inbox = path.join(work, L('Vom Handy', 'From phone'));
  fs.mkdirSync(inbox);

  const app = await electron.launch({
    executablePath: process.env.SLIMKIT_EXE || require('electron'),
    args: process.env.SLIMKIT_EXE ? ['--no-sandbox', `--lang=${lang}`] : [ROOT, '--no-sandbox', `--lang=${lang}`],
    env: { ...process.env, SLIMKIT_TEST: '1', SLIMKIT_USERDATA: userData, SLIMKIT_SERVICES_DIR: services, SLIMKIT_PORT: '0', LANG: lang === 'de' ? 'de_DE.UTF-8' : 'en_US.UTF-8' },
  });
  const win = await app.firstWindow();
  const errors = [];
  const watch = (p, name) => {
    p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  };
  watch(win, 'app');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  const shot = async (page, name) => {
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const launch = async (action, paths) => {
    await app.evaluate((_e, argv) => global.__slimkit.launch(argv), [`--action=${action}`, ...paths]);
  };

  // Echte JPEG-Bilder erzeugen (2400×1600) – ein Bild je Farbverlauf
  const COLORS = [['#ff9a8b', '#ff6a88'], ['#43cea2', '#185a9d'], ['#f6d365', '#fda085'], ['#a18cd1', '#fbc2eb'], ['#84fab0', '#8fd3f4'], ['#30cfd0', '#330867']];
  const imgNames = ['IMG_20250714_101500.jpg', 'IMG_20250714_113012.jpg', 'IMG_20250715_090144.jpg', 'IMG_20250716_183000.jpg', 'IMG_20250717_120000.jpg', 'IMG_20250718_200500.jpg'];
  const jpgs = await app.evaluate(
    async ({ BrowserWindow }, { colors, names }) => {
      const out = [];
      const w = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { offscreen: true } });
      for (let i = 0; i < names.length; i++) {
        const [a, b] = colors[i];
        await w.loadURL(`data:text/html,<body style="margin:0;height:100vh;background:linear-gradient(135deg,${encodeURIComponent(a)},${encodeURIComponent(b)})"><div style="position:absolute;left:12%;top:58%;width:76%;height:30%;border-radius:50% 50% 0 0;background:rgba(255,255,255,.25)"></div></body>`);
        await new Promise((r) => setTimeout(r, 120));
        const img = await w.webContents.capturePage();
        out.push(img.resize({ width: 2400, height: 1600 }).toJPEG(92).toString('base64'));
      }
      w.destroy();
      return out;
    },
    { colors: COLORS, names: imgNames },
  );
  jpgs.forEach((b, i) => fs.writeFileSync(path.join(photos, months[3], imgNames[i]), Buffer.from(b, 'base64')));
  for (const n of imgNames.slice(0, 2)) fs.copyFileSync(path.join(photos, months[3], n), path.join(photos, months[0], n));
  fs.writeFileSync(path.join(photos, months[1], L('Liste.txt', 'List.txt')), 'x');
  const italy = path.join(photos, months[3]);

  // ---------------------------------------------------------------- Einführung
  await win.waitForSelector('[data-testid="onboarding"]');
  await win.click(`[data-testid="lang-${lang}"]`);
  await shot(win, '01-onb-language');
  await win.click('[data-testid="onb-next"]');
  await win.click('[data-testid="theme-dark"]');
  await shot(win, '02-onb-theme');
  await win.click('[data-testid="onb-next"]');
  await shot(win, '03-onb-mode');
  await win.click('[data-testid="onb-next"]');
  if (process.platform === 'darwin' || process.platform === 'win32') {
    await win.click('[data-testid="onb-menu-install"]');
    await win.waitForSelector('.perm-card.ok');
    await shot(win, '04-onb-menu');
    if (process.platform === 'darwin') {
      const wf = ls(services);
      assert.ok(wf.length >= 6, 'Schnellaktionen angelegt: ' + wf.join(', '));
      const plist = fs.readFileSync(path.join(services, wf.find((x) => x.includes('…') || x.includes('...')), 'Contents', 'document.wflow'), 'utf8');
      assert.match(plist, /--action=open/);
    }
    await win.click('[data-testid="onb-next"]');
  }
  await shot(win, '05-onb-tour');
  await win.click('[data-testid="onb-next"]');
  await win.waitForSelector('[data-testid="tile-structure"]');
  await shot(win, '10-home');

  // ---------------------------------------------------------------- Rechtsklick → "SlimKit öffnen" mit Auswahl
  await launch('open', [path.join(italy, imgNames[0]), path.join(italy, imgNames[1]), path.join(italy, imgNames[2])]);
  await win.waitForSelector('[data-testid="selection"]');
  await sleep(300);
  await shot(win, '11-home-selection');
  await win.click('[data-testid="clear-selection"]');

  // ---------------------------------------------------------------- Ordnerstruktur kopieren
  await launch('structure', [photos]);
  await win.waitForSelector('[data-testid="structure-tree"]');
  assert.equal(await win.inputValue('[data-testid="structure-name"]'), L('Fotos 2026', 'Photos 2026'));
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="structure-tree"] .tree-row').length > 5);
  await shot(win, '20-structure');
  await win.click('[data-testid="structure-apply"]');
  await win.waitForSelector('[data-testid="done"]');
  await shot(win, '21-structure-done');
  const dest = path.join(work, L('Fotos 2026', 'Photos 2026'));
  assert.deepEqual(ls(dest), months.map((m) => m.replace('2025', '2026')));
  assert.deepEqual(ls(path.join(dest, months[3].replace('2025', '2026'))), L(['Rom', 'Strand'], ['Beach', 'Rom']));
  assert.deepEqual(ls(path.join(dest, months[0].replace('2025', '2026'))), [], 'keine Fotos mitkopiert');
  // Rückgängig
  await win.click('[data-testid="undo"]');
  await waitFor(() => !fs.existsSync(dest), 5000, 'Struktur rückgängig');
  // Nochmal anlegen (für spätere Screenshots)
  await launch('structure', [photos]);
  await win.waitForSelector('[data-testid="structure-tree"] .tree-row:nth-child(4)');
  await win.click('[data-testid="structure-apply"]');
  await win.waitForSelector('[data-testid="done"]');
  assert.ok(fs.existsSync(dest));
  await win.click('[data-testid="finish"]');

  // ---------------------------------------------------------------- Umbenennen
  await launch('rename', [italy]);
  await win.waitForSelector('[data-testid="rename-preview"] .trow');
  await win.fill('[data-testid="rename-base"]', L('Urlaub Italien', 'Italy trip'));
  await win.waitForFunction((n) => document.querySelector('[data-testid="rename-preview"] .trow .new')?.textContent === n, L('Urlaub Italien 01.jpg', 'Italy trip 01.jpg'));
  await shot(win, '30-rename');
  await win.click('[data-testid="rename-apply"]');
  await win.waitForSelector('[data-testid="done"]');
  assert.deepEqual(
    ls(italy).filter((n) => n.endsWith('.jpg')),
    [1, 2, 3, 4, 5, 6].map((i) => `${L('Urlaub Italien', 'Italy trip')} 0${i}.jpg`),
  );
  await win.click('[data-testid="undo"]');
  await waitFor(() => fs.existsSync(path.join(italy, imgNames[0])), 5000, 'Umbenennen rückgängig');
  await win.click('[data-testid="finish"]');

  // ---------------------------------------------------------------- Datum aus Dateinamen
  await launch('dates', [italy]);
  await win.click('[data-testid="dates-name"]');
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="dates-preview"] .trow.changed').length >= 6);
  await shot(win, '40-dates');
  await win.click('[data-testid="dates-apply"]');
  await win.waitForSelector('[data-testid="done"]');
  const st = fs.statSync(path.join(italy, imgNames[0]));
  assert.equal(new Date(st.mtimeMs).getFullYear(), 2025);
  assert.equal(new Date(st.mtimeMs).getMonth(), 6);
  await win.click('[data-testid="finish"]');

  // ---------------------------------------------------------------- Bilder verkleinern
  await launch('images', [italy]);
  await win.waitForSelector('[data-testid="images-list"] .thumb-row');
  await win.click('[data-testid="images-size-small"]');
  await shot(win, '50-images');
  await win.click('[data-testid="images-apply"]');
  await win.waitForSelector('[data-testid="done"]', { timeout: 30000 });
  await shot(win, '51-images-done');
  const resized = path.join(italy, L('Verkleinert', 'Resized'));
  assert.equal(ls(resized).length, 6);
  const dims = await app.evaluate(({ nativeImage }, f) => nativeImage.createFromPath(f).getSize(), path.join(resized, imgNames[0]));
  assert.deepEqual(dims, { width: 1280, height: 853 });
  assert.ok(fs.statSync(path.join(resized, imgNames[0])).size < fs.statSync(path.join(italy, imgNames[0])).size);
  await win.click('[data-testid="finish"]');

  // ---------------------------------------------------------------- PDF zusammenfügen
  await launch('pdf', [path.join(italy, imgNames[0]), path.join(italy, imgNames[1]), path.join(italy, imgNames[2])]);
  await win.waitForSelector('[data-testid="pdf-list"] .trow');
  await shot(win, '55-pdf');
  await win.click('[data-testid="pdf-apply"]');
  await win.waitForSelector('[data-testid="done"]');
  const pdf = ls(italy).find((n) => n.endsWith('.pdf'));
  assert.ok(pdf, 'PDF erstellt');
  assert.match(fs.readFileSync(path.join(italy, pdf)).subarray(0, 5).toString(), /%PDF-/);
  await win.click('[data-testid="finish"]');

  // ---------------------------------------------------------------- Sortieren (Vorschau)
  await launch('sort', [italy]);
  await win.waitForSelector('[data-testid="sort-preview"] .trow');
  await shot(win, '56-sort');
  await win.click('[data-testid="back"]');

  // ---------------------------------------------------------------- Aufs Handy senden
  async function openPhone(url) {
    await app.evaluate(
      ({ BrowserWindow }, { url, ua }) => {
        const b = new BrowserWindow({ x: 20, y: 20, width: 390, height: 844, show: true, title: 'phone', webPreferences: { partition: 'phone-' + Math.random() } });
        b.webContents.setUserAgent(ua);
        b.loadURL(url);
      },
      { url, ua: PHONE_UA },
    );
    const p = await app.waitForEvent('window', (x) => x.url().startsWith('http://127.0.0.1'));
    watch(p, 'phone');
    return p;
  }
  await launch('send', [path.join(italy, imgNames[0]), path.join(italy, imgNames[1]), path.join(italy, imgNames[3]), path.join(photos, months[1])]);
  await win.waitForSelector('[data-testid="qr"] svg');
  await shot(win, '60-send-qr');
  const sendUrl = await app.evaluate(() => global.__slimkit.transferUrl());
  const phone = await openPhone(sendUrl);
  await phone.waitForSelector('.files li');
  await phone.waitForFunction(() => [...document.querySelectorAll('img.thumb')].every((i) => i.complete && i.naturalWidth > 0));
  assert.equal(await phone.locator('.files li').count(), 4);
  assert.ok(await phone.locator('[data-testid="zip"]').count());
  await shot(phone, '61-phone-send');
  const zip = await phone.evaluate(async () => {
    const a = document.querySelector('[data-testid="zip"]');
    const r = await fetch(a.getAttribute('href'));
    const b = new Uint8Array(await r.arrayBuffer());
    return { ok: r.ok, len: b.length, sig: b[0] === 0x50 && b[1] === 0x4b };
  });
  assert.ok(zip.ok && zip.sig && zip.len > 1000, 'ZIP geladen');
  await win.waitForSelector('.list-row >> text=iPhone');
  await shot(win, '62-send-connected');
  await phone.close();
  await win.click('[data-testid="back"]');

  // ---------------------------------------------------------------- Vom Handy empfangen
  await launch('receive', [inbox]);
  await win.waitForSelector('[data-testid="qr"] svg');
  const recUrl = await app.evaluate(() => global.__slimkit.transferUrl());
  const phone2 = await openPhone(recUrl);
  await phone2.waitForSelector('[data-testid="file-input"]', { state: 'attached' });
  await shot(phone2, '63-phone-receive');
  await phone2.setInputFiles('[data-testid="file-input"]', [path.join(italy, imgNames[4]), path.join(italy, imgNames[5])]);
  await phone2.waitForSelector('.status.ok');
  await shot(phone2, '64-phone-received');
  await waitFor(() => ls(inbox).length === 2, 8000, 'Dateien empfangen');
  assert.deepEqual(ls(inbox), [imgNames[4], imgNames[5]].sort());
  await win.waitForSelector('[data-testid="receive-list"] .ok-ic');
  await shot(win, '65-receive');
  await phone2.close();
  await win.click('[data-testid="back"]');

  // ---------------------------------------------------------------- Pfad kopieren (ohne Fenster-Wechsel)
  await launch('copypath', [path.join(italy, imgNames[0])]);
  await waitFor(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === path.join(italy, imgNames[0]), 4000, 'Pfad kopiert');

  // ---------------------------------------------------------------- Automatik "Neues Jahr"
  await app.evaluate((_e, parent) => global.__slimkit.setSettings({ automations: [{ id: 'y1', type: 'year', enabled: true, parent, month: 1, day: 1, lastYear: 2025 }, { id: 't1', type: 'tidy', enabled: false, folder: parent, by: 'type', minAgeSec: 60 }] }), school);
  await win.click('[data-testid="open-auto"]');
  await win.waitForSelector('[data-testid="auto-item"]');
  await shot(win, '70-auto');
  // "Jetzt" ausführen: Stichtag ist vorbei → lastYear 2025 < aktuelles Jahr
  await win.click('[data-testid="auto-run"] >> nth=0');
  const nowYear = new Date().getFullYear();
  const nextName = L(`Schuljahr ${nowYear}-${nowYear + 1}`, `School year ${nowYear}-${nowYear + 1}`);
  if (nowYear > 2025) {
    await waitFor(() => fs.existsSync(path.join(school, nextName)), 5000, 'Neues Schuljahr angelegt');
    assert.deepEqual(ls(path.join(school, nextName)), ls(path.join(school, L('Schuljahr 2025-2026', 'School year 2025-2026'))));
  }

  // ---------------------------------------------------------------- Verlauf
  await win.click('[data-testid="open-history"]');
  await win.waitForSelector('[data-testid="history-item"]');
  await shot(win, '75-history');
  assert.ok((await win.locator('[data-testid="history-item"]').count()) >= 5);

  // ---------------------------------------------------------------- Einstellungen
  await win.click('[data-testid="open-settings"]');
  await win.click('[data-testid="settings-menu"]');
  await shot(win, '80-settings-menu');
  await win.click('[data-testid="settings-about"]');
  await shot(win, '81-settings-about');
  await win.keyboard.press('Escape');

  // Expertenmodus + hell
  await app.evaluate(() => global.__slimkit.setSettings({ prefs: { mode: 'expert', theme: 'light' } }));
  await win.click('.header .brand');
  await win.waitForSelector('[data-testid="tile-dupes"]');
  await sleep(500);
  await shot(win, '85-home-expert-light');
  await launch('structure', [photos]);
  await win.waitForSelector('[data-testid="structure-tree"] .tree-row:nth-child(4)');
  await shot(win, '86-structure-light');

  // ---------------------------------------------------------------- Ergebnis
  const relevant = errors.filter((e) => !/favicon|ERR_ABORTED|Autofill/.test(e));
  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
  if (relevant.length) {
    console.error('Fehler in der Konsole:\n' + relevant.join('\n'));
    process.exit(1);
  }
  console.log('E2E ok – Screenshots in', SHOTS);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
