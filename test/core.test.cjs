'use strict';
/** Tests der Kern-Logik (ohne Oberfläche): node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { safeName, uniquePath, kindOf, isEffectivelyEmpty } = require('../electron/core/fsutil.cjs');
const { findYears, suggestYearMap, applyMap, planStructure, applyStructure, latestYearFolder, captureTemplate, planFromTemplate } = require('../electron/core/structure.cjs');
const { computeRenames, applyRenames } = require('../electron/core/rename.cjs');
const { exifDate, dateFromName, takenDate, planDates, applyDates } = require('../electron/core/dates.cjs');
const { planSort, applyMoves, planFlatten, findEmptyDirs, findDuplicates, sizeReport, fileList, hashFile } = require('../electron/core/organize.cjs');
const { History } = require('../electron/core/history.cjs');
const { crc32 } = require('../electron/core/zip.cjs');
const { parseLaunch, winRegFile, macScript } = require('../electron/core/contextmenu.cjs');
const { isDue, planYear, AutomationRunner, cleanupCandidates } = require('../electron/core/automations.cjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slimkit-test-'));
}
function touch(p, content = 'x', mtime) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
}
const ls = (dir) => fs.readdirSync(dir).sort();

// ------------------------------------------------------------------ Hilfen
test('safeName entfernt verbotene Zeichen', () => {
  assert.equal(safeName('a/b:c*?.txt'), 'a_b_c__.txt');
  assert.equal(safeName('CON.txt'), '_CON.txt');
  assert.equal(safeName('  name. '), 'name');
  assert.equal(safeName(''), 'file');
});

test('uniquePath hängt (2) an', () => {
  const d = tmp();
  touch(path.join(d, 'a.jpg'));
  assert.equal(uniquePath(path.join(d, 'a.jpg')), path.join(d, 'a (2).jpg'));
  assert.equal(uniquePath(path.join(d, 'b.jpg')), path.join(d, 'b.jpg'));
  assert.equal(kindOf('X.HEIC'), 'image');
  assert.equal(kindOf('a.pdf'), 'doc');
});

// ------------------------------------------------------------------ Ordnerstruktur
test('Jahreszahlen erkennen und ersetzen', () => {
  assert.deepEqual(findYears('Fotos 2025'), [2025]);
  assert.deepEqual(findYears('Schuljahr 2025-2026'), [2025, 2026]);
  assert.deepEqual(findYears('Rechnung 120250'), []);
  assert.deepEqual(suggestYearMap('Fotos 2025'), { 2025: '2026' });
  assert.deepEqual(suggestYearMap('Schuljahr 2025-2026'), { 2025: '2026', 2026: '2027' });
  assert.deepEqual(suggestYearMap('Fotos', ['2024-01', '2024-02', '2023']), { 2024: '2025' });
  assert.equal(applyMap('Schuljahr 2025-2026', { 2025: '2026', 2026: '2027' }), 'Schuljahr 2026-2027');
  assert.equal(applyMap('2025-03 März', { 2025: '2026' }), '2026-03 März');
  assert.equal(applyMap('Nr 120250', { 2025: '2026' }), 'Nr 120250');
  assert.equal(applyMap('Klasse 9', {}, [{ from: '9', to: '10' }]), 'Klasse 10');
});

test('Ordnerstruktur ohne Dateien kopieren, Jahr ersetzen, Vorlagen mitnehmen', async () => {
  const d = tmp();
  const src = path.join(d, 'Fotos 2025');
  touch(path.join(src, '2025-01 Januar', 'IMG_1.jpg'));
  touch(path.join(src, '2025-01 Januar', 'Urlaub', 'IMG_2.jpg'));
  touch(path.join(src, '2025-02 Februar', 'liste.xlsx'));
  fs.mkdirSync(path.join(src, 'Leer'));
  touch(path.join(src, '.DS_Store'));
  const dest = path.join(d, 'Fotos 2026');
  const plan = await planStructure(src, dest, { map: { 2025: '2026' }, includeExt: ['xlsx'] });
  assert.deepEqual(plan.dirs.map((x) => x.rel).sort(), ['2026-01 Januar', '2026-01 Januar/Urlaub', '2026-02 Februar', 'Leer']);
  assert.equal(plan.files.length, 1);
  assert.equal(plan.skippedFiles, 2);
  const r = await applyStructure(dest, plan);
  assert.equal(r.created, 5); // Ziel + 4
  assert.equal(r.copied, 1);
  assert.deepEqual(ls(dest), ['2026-01 Januar', '2026-02 Februar', 'Leer']);
  assert.deepEqual(ls(path.join(dest, '2026-01 Januar')), ['Urlaub']);
  assert.ok(fs.existsSync(path.join(dest, '2026-02 Februar', 'liste.xlsx')));
  // Nochmal: nichts Neues, vorhandene bleiben (Ergänzen)
  fs.mkdirSync(path.join(src, '2025-03 März'));
  const r2 = await applyStructure(dest, await planStructure(src, dest, { map: { 2025: '2026' } }));
  assert.equal(r2.created, 1);
  // Rückgängig über den Verlauf
  const h = new History(path.join(d, 'h.json'));
  const item = h.add({ tool: 'structure', title: 't', ops: r.ops });
  await h.undo(item.id);
  // Ordner mit nachträglich erzeugtem März bleibt (nicht leer durch fremden Ordner? März kam aus r2)
  assert.ok(!fs.existsSync(path.join(dest, '2026-02 Februar')), 'Februar entfernt');
  assert.ok(fs.existsSync(path.join(dest, '2026-03 März')), 'Ordner aus späterer Aktion bleibt');
});

test('Ziel im Quellordner wird nicht mitkopiert', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'A', 'B'), { recursive: true });
  const plan = await planStructure(d, path.join(d, 'Kopie'), {});
  await applyStructure(path.join(d, 'Kopie'), plan);
  const plan2 = await planStructure(d, path.join(d, 'Kopie'), {});
  assert.ok(!plan2.dirs.some((x) => x.rel.startsWith('Kopie')));
  await assert.rejects(planStructure(d, d, {}));
});

test('Vorlagen speichern und anlegen', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'Projekt', 'Angebote'), { recursive: true });
  fs.mkdirSync(path.join(d, 'Projekt', 'Rechnungen', '2025'), { recursive: true });
  const dirs = await captureTemplate(path.join(d, 'Projekt'));
  assert.deepEqual(dirs.sort(), ['Angebote', 'Rechnungen', 'Rechnungen/2025']);
  const plan = planFromTemplate(dirs, path.join(d, 'Neu'), { 2025: '2026' });
  await applyStructure(path.join(d, 'Neu'), plan);
  assert.ok(fs.existsSync(path.join(d, 'Neu', 'Rechnungen', '2026')));
});

test('neuesten Jahres-Ordner finden', async () => {
  const d = tmp();
  for (const n of ['Fotos 2023', 'Fotos 2025', 'Fotos 2024', 'Sonstiges']) fs.mkdirSync(path.join(d, n));
  assert.equal((await latestYearFolder(d, 2026)).name, 'Fotos 2025');
  assert.equal((await latestYearFolder(d, 2025)).name, 'Fotos 2024');
});

// ------------------------------------------------------------------ Umbenennen
test('Umbenennen: Nummerieren, Platzhalter, Ersetzen, Konflikte', () => {
  const files = ['b.JPG', 'a.jpg', 'c.jpg'].map((n) => ({ path: path.join('/x', n), date: new Date(2025, 2, 12, 14, 5, 9).getTime() }));
  let r = computeRenames(files, { template: 'Urlaub {n}', extCase: 'lower' });
  assert.deepEqual(r.map((x) => x.name), ['Urlaub 01.jpg', 'Urlaub 02.jpg', 'Urlaub 03.jpg']);
  r = computeRenames(files, { template: '{date}_{name}' });
  assert.equal(r[0].name, '2025-03-12_a.jpg');
  r = computeRenames([{ path: '/x/IMG 1.jpg' }], { find: 'img', replace: 'Foto', spaces: 'underscore' });
  assert.equal(r[0].name, 'Foto_1.jpg');
  r = computeRenames([{ path: '/x/a.jpg' }, { path: '/x/b.jpg' }], { template: 'gleich' });
  assert.deepEqual(r.map((x) => x.name), ['gleich.jpg', 'gleich (2).jpg']);
  r = computeRenames([{ path: '/x/a(1).jpg' }], { find: '(', regex: true });
  assert.equal(r[0].error, 'regex');
  r = computeRenames([{ path: '/x/hallo welt.txt' }], { case: 'title' });
  assert.equal(r[0].name, 'Hallo Welt.txt');
});

test('Umbenennen: Tauschen und Groß/klein klappen, Rückgängig', async () => {
  const d = tmp();
  touch(path.join(d, 'a.txt'), 'A');
  touch(path.join(d, 'b.txt'), 'B');
  const plan = [
    { from: path.join(d, 'a.txt'), to: path.join(d, 'b.txt'), changed: true },
    { from: path.join(d, 'b.txt'), to: path.join(d, 'a.txt'), changed: true },
  ];
  const r = await applyRenames(plan);
  assert.equal(r.done, 2);
  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'B');
  const plan2 = computeRenames([{ path: path.join(d, 'a.txt') }], { case: 'upper', extCase: 'keep' });
  const r2 = await applyRenames(plan2);
  assert.equal(r2.done, 1);
  assert.ok(ls(d).includes('A.txt'));
  const h = new History(path.join(d, '..', path.basename(d) + '-h.json'));
  const it = h.add({ tool: 'rename', title: 'x', ops: r2.ops });
  await h.undo(it.id);
  assert.ok(ls(d).includes('a.txt'));
});

// ------------------------------------------------------------------ Datum
function jpegWithExif(dateStr) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + 20);
  tiff.write('II*\0', 0, 'latin1');
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18); // Exif-IFD
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.writeUInt32LE(0, 40);
  tiff.write(dateStr + '\0', 44, 'latin1');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
}
function mp4WithDate(d) {
  const mvhd = Buffer.alloc(8 + 100);
  mvhd.writeUInt32BE(mvhd.length, 0);
  mvhd.write('mvhd', 4, 'latin1');
  mvhd.writeUInt32BE(Math.floor(d.getTime() / 1000) + 2082844800, 12);
  const moov = Buffer.concat([Buffer.from([0, 0, 0, 8 + mvhd.length]), Buffer.from('moov'), mvhd]);
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4)]);
  const mdat = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('mdat'), Buffer.alloc(4)]);
  return Buffer.concat([ftyp, mdat, moov]);
}

test('EXIF- und Video-Datum lesen', async () => {
  const d = exifDate(jpegWithExif('2024:07:15 13:45:10'));
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getHours(), 13);
  assert.equal(exifDate(Buffer.from('kein bild')), null);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.jpg'), jpegWithExif('2023:01:02 03:04:05'));
  assert.equal((await takenDate(path.join(dir, 'a.jpg'))).getFullYear(), 2023);
  const when = new Date(Date.UTC(2022, 4, 6, 7, 8, 9));
  fs.writeFileSync(path.join(dir, 'v.mp4'), mp4WithDate(when));
  assert.equal((await takenDate(path.join(dir, 'v.mp4'))).getTime(), when.getTime());
});

test('Datum aus Dateinamen', () => {
  const cases = {
    'IMG_20250312_141522.jpg': [2025, 2, 12, 14, 15, 22],
    'PXL_20250312_141522123.jpg': [2025, 2, 12, 14, 15, 22],
    'IMG-20250312-WA0001.jpg': [2025, 2, 12, 0, 0, 0],
    'Screenshot 2025-03-12 at 14.15.22.png': [2025, 2, 12, 14, 15, 22],
    'Bildschirmfoto 2025-03-12 um 14.15.22.png': [2025, 2, 12, 14, 15, 22],
    'Rechnung 12.03.2025.pdf': [2025, 2, 12, 0, 0, 0],
    '2025-03-12.txt': [2025, 2, 12, 0, 0, 0],
  };
  for (const [n, [y, mo, da, h, mi, s]] of Object.entries(cases)) {
    const d = dateFromName(n);
    assert.ok(d, n);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [y, mo, da, h, mi, s], n);
  }
  assert.equal(dateFromName('Rechnung 12345678.pdf'), null);
  assert.equal(dateFromName('2025-13-45.txt'), null);
  assert.equal(dateFromName('1710252922000.jpg').getFullYear(), 2024);
});

test('Datum setzen und rückgängig machen', async () => {
  const d = tmp();
  const f = touch(path.join(d, 'IMG_20200101_120000.jpg'));
  const before = fs.statSync(f).mtimeMs;
  const plan = await planDates([f], { mode: 'name' });
  const r = await applyDates(plan, process.platform === 'linux' ? 'modified' : 'both');
  assert.equal(r.done, 1);
  assert.equal(new Date(fs.statSync(f).mtimeMs).getFullYear(), 2020);
  if (process.platform === 'darwin') assert.equal(new Date(fs.statSync(f).birthtimeMs).getFullYear(), 2020, 'Erstelldatum (Mac)');
  const h = new History(path.join(d, 'h.json'));
  const it = h.add({ tool: 'dates', title: 'x', ops: r.ops });
  await h.undo(it.id);
  assert.ok(Math.abs(fs.statSync(f).mtimeMs - before) < 1000);
  const shift = await planDates([f], { mode: 'shift', minutes: 60 });
  assert.ok(Math.abs(shift[0].next.getTime() - fs.statSync(f).mtimeMs - 3600000) < 5);
});

// ------------------------------------------------------------------ Aufräumen
test('Nach Monat und Typ sortieren', async () => {
  const d = tmp();
  touch(path.join(d, 'a.jpg'), 'a', new Date(2024, 4, 3));
  touch(path.join(d, 'b.pdf'), 'b', new Date(2025, 0, 9));
  fs.writeFileSync(path.join(d, 'c.jpg'), jpegWithExif('2021:12:24 18:00:00'));
  let moves = await planSort([d], { by: 'month' });
  assert.deepEqual(moves.map((m) => m.folder.split(path.sep).join('/')).sort(), ['2021/2021-12', '2024/2024-05', '2025/2025-01']);
  moves = await planSort([d], { by: 'type', kindNames: { image: 'Bilder', doc: 'Dokumente' } });
  assert.deepEqual(moves.map((m) => m.folder).sort(), ['Bilder', 'Bilder', 'Dokumente']);
  const r = await applyMoves(moves);
  assert.equal(r.done, 3);
  assert.deepEqual(ls(d), ['Bilder', 'Dokumente']);
});

test('Ordner auflösen, leere Ordner finden', async () => {
  const d = tmp();
  touch(path.join(d, 'x', 'a.txt'));
  touch(path.join(d, 'y', 'z', 'a.txt'));
  touch(path.join(d, 'y', '.DS_Store'));
  fs.mkdirSync(path.join(d, 'leer', 'auch leer'), { recursive: true });
  const moves = await planFlatten(d);
  assert.deepEqual(moves.map((m) => path.basename(m.to)).sort(), ['a (2).txt', 'a.txt']);
  await applyMoves(moves);
  const empty = await findEmptyDirs(d);
  assert.deepEqual(empty.map((p) => path.basename(p)).sort(), ['leer', 'x', 'y']);
  assert.ok(await isEffectivelyEmpty(path.join(d, 'y')));
});

test('Duplikate, Größe, Dateiliste, Prüfsumme', async () => {
  const d = tmp();
  touch(path.join(d, 'a.txt'), 'gleich');
  touch(path.join(d, 'sub', 'b.txt'), 'gleich');
  touch(path.join(d, 'c.txt'), 'anders');
  touch(path.join(d, 'd.txt'), 'xx');
  const groups = await findDuplicates([d]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  const s = await sizeReport(d);
  assert.equal(s.files, 4);
  assert.equal(s.total, 6 + 6 + 6 + 2);
  assert.equal(s.children.find((c) => c.name === 'sub').size, 6);
  const csv = await fileList(d, { labels: { name: 'Name' } });
  assert.ok(csv.startsWith('\ufeffName;'));
  assert.ok(csv.includes('b.txt;sub;6;'));
  const txt = await fileList(d, { format: 'txt' });
  assert.ok(txt.includes('  sub/\n    b.txt'));
  assert.equal(await hashFile(path.join(d, 'd.txt')), require('node:crypto').createHash('sha256').update('xx').digest('hex'));
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
});

// ------------------------------------------------------------------ Rechtsklick
test('Start-Argumente auswerten', () => {
  const ex = () => true;
  assert.deepEqual(parseLaunch(['/app/SlimKit', '--action=structure', '/Users/a/Fotos 2025'], { exists: ex }), { action: 'structure', paths: ['/Users/a/Fotos 2025'] });
  assert.deepEqual(parseLaunch(['/Applications/SlimKit.app/Contents/MacOS/SlimKit', '/x/a.jpg', '--allow-file-access', '--action=images', '/x/b.jpg'], { exists: ex }), { action: 'images', paths: ['/x/a.jpg', '/x/b.jpg'] });
  assert.deepEqual(parseLaunch(['/x/electron', '/repo', '--action=hack', '/x/a'], { exists: ex, skip: ['/repo'] }), { action: 'open', paths: ['/x/a'] });
  assert.deepEqual(parseLaunch(['/x/electron'], { exists: ex }), { action: null, paths: [] });
});

test('Windows-Registry-Datei und Mac-Skript', () => {
  const reg = winRegFile({ launcher: ['C:\\Users\\Max\\AppData\\Local\\Programs\\SlimKit\\SlimKit.exe'], icon: 'C:\\x\\SlimKit.exe', actions: ['open', 'structure', 'newfile'], labels: { open: 'SlimKit öffnen …', structure: 'Ordnerstruktur "kopieren"', newfile: 'Neue Textdatei' } });
  assert.ok(reg.startsWith('Windows Registry Editor Version 5.00'));
  assert.ok(reg.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\SlimKit\\shell\\02structure\\command]'));
  assert.ok(reg.includes('@="\\"C:\\\\Users\\\\Max\\\\AppData\\\\Local\\\\Programs\\\\SlimKit\\\\SlimKit.exe\\" --action=structure \\"%1\\""'));
  assert.ok(reg.includes('"MUIVerb"="Ordnerstruktur \\"kopieren\\""'));
  assert.ok(reg.includes('Background\\shell\\SlimKit\\shell\\02newfile\\command]\r\n@="\\"C:\\\\Users\\\\Max\\\\AppData\\\\Local\\\\Programs\\\\SlimKit\\\\SlimKit.exe\\" --action=newfile \\"%V\\""'));
  assert.ok(!reg.includes('*\\shell\\SlimKit\\shell\\02structure'), 'Ordnerstruktur nicht bei Dateien');
  const sh = macScript(['/Applications/SlimKit.app/Contents/MacOS/SlimKit'], '/Applications/SlimKit.app', 'send');
  assert.ok(sh.includes("pgrep -xq 'SlimKit'"));
  assert.ok(sh.includes("open -a '/Applications/SlimKit.app' --args --action=send \"$@\""));
});

// ------------------------------------------------------------------ Automatik
test('Automatik: Neues Jahr', async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'Fotos 2025', '2025-01'), { recursive: true });
  touch(path.join(d, 'Fotos 2025', '2025-01', 'bild.jpg'));
  const a = { id: 'y', type: 'year', enabled: true, parent: d, month: 1, day: 1 };
  assert.equal(isDue(a, new Date(2025, 11, 31)), true); // 2025 noch nicht gelaufen, Stichtag 1.1. vorbei
  assert.equal(isDue({ ...a, lastYear: 2025 }, new Date(2025, 11, 31)), false);
  assert.equal(isDue({ ...a, lastYear: 2025, month: 2 }, new Date(2026, 0, 15)), false);
  assert.equal(isDue({ ...a, lastYear: 2025 }, new Date(2026, 0, 1, 0, 5)), true);
  const p = await planYear(a, new Date(2026, 0, 1));
  assert.equal(path.basename(p.dest), 'Fotos 2026');
  let list = [a];
  const h = new History(path.join(d, 'h.json'));
  const runner = new AutomationRunner({ list: () => list, update: (id, patch) => (list = list.map((x) => (x.id === id ? { ...x, ...patch } : x))), history: h, trash: async () => {} });
  const r = await runner.run('y', new Date(2026, 0, 1));
  assert.ok(fs.existsSync(path.join(d, 'Fotos 2026', '2026-01')));
  assert.ok(!fs.existsSync(path.join(d, 'Fotos 2026', '2026-01', 'bild.jpg')));
  assert.equal(r.done, 2);
  assert.equal(list[0].lastYear, 2026);
  assert.equal(h.list()[0].auto, true);
});

test('Automatik: Aufräumen und alte Dateien', async () => {
  const d = tmp();
  const old = new Date(Date.now() - 40 * 86400000);
  touch(path.join(d, 'alt.pdf'), 'x', old);
  touch(path.join(d, 'neu.jpg'), 'x', old);
  touch(path.join(d, 'laden.crdownload'), 'x', old);
  const trashed = [];
  let list = [
    { id: 't', type: 'tidy', enabled: true, folder: d, by: 'type', minAgeSec: 0 },
    { id: 'c', type: 'cleanup', enabled: true, folder: d, days: 30 },
  ];
  const runner = new AutomationRunner({
    list: () => list,
    update: (id, patch) => (list = list.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    history: new History(path.join(d, '..', path.basename(d) + '.json')),
    trash: async (p) => trashed.push(p),
    kindNames: () => ({ image: 'Bilder', doc: 'Dokumente' }),
  });
  const prev = await runner.preview(list[0]);
  assert.equal(prev.count, 2);
  await runner.run('t');
  assert.deepEqual(ls(d), ['Bilder', 'Dokumente', 'laden.crdownload']);
  const c = await cleanupCandidates({ folder: d, days: 30 });
  // Dateien wurden gerade erst verschoben → nicht älter als 30 Tage? birthtime bleibt alt; mtime alt → kandidat
  assert.ok(c.some((x) => x.path.endsWith('laden.crdownload')));
});
