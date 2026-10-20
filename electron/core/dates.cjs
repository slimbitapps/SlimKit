'use strict';
/**
 * Datum von Dateien: Aufnahmedatum lesen (Foto-EXIF, Video), Datum aus dem Dateinamen erkennen,
 * Änderungs- und Erstelldatum setzen.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { kindOf } = require('./fsutil.cjs');

function validDate(y, mo, d, h = 0, mi = 0, s = 0) {
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(y, mo - 1, d, h, mi, s);
  return dt.getMonth() === mo - 1 ? dt : null; // 31.02. ausschließen
}

// ------------------------------------------------------------------ EXIF (JPEG, HEIC, TIFF/RAW)
/** Anfang der TIFF-Daten im Puffer finden (dort stehen die EXIF-Werte). */
function findTiff(buf) {
  if (buf.length < 12) return -1;
  const isTiff = (o) => (buf[o] === 0x49 && buf[o + 1] === 0x49 && buf[o + 2] === 0x2a && buf[o + 3] === 0) || (buf[o] === 0x4d && buf[o + 1] === 0x4d && buf[o + 2] === 0 && buf[o + 3] === 0x2a);
  if (isTiff(0)) return 0;
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 4 < buf.length && buf[o] === 0xff) {
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      if (marker === 0xe1 && buf.toString('latin1', o + 4, o + 10) === 'Exif\0\0' && isTiff(o + 10)) return o + 10;
      if (marker === 0xda) break; // Bilddaten beginnen
      o += 2 + len;
    }
  }
  // HEIC & Co.: nach "Exif\0\0" suchen
  let i = buf.indexOf('Exif\0\0', 0, 'latin1');
  while (i >= 0 && i + 10 < buf.length) {
    if (isTiff(i + 6)) return i + 6;
    i = buf.indexOf('Exif\0\0', i + 1, 'latin1');
  }
  return -1;
}

/** EXIF-Datum ("YYYY:MM:DD HH:MM:SS") aus einem Dateianfang lesen. */
function exifDate(buf) {
  const t = findTiff(buf);
  if (t < 0) return null;
  const le = buf[t] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const readIfd = (off) => {
    const tags = new Map();
    const o = t + off;
    if (o + 2 > buf.length) return tags;
    const n = u16(o);
    for (let i = 0; i < n && i < 500; i++) {
      const e = o + 2 + i * 12;
      if (e + 12 > buf.length) break;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8), at: e + 8 });
    }
    return tags;
  };
  const ascii = (tag) => {
    if (!tag || tag.type !== 2) return null;
    const start = tag.count <= 4 ? tag.at : t + tag.value;
    if (start + tag.count > buf.length) return null;
    return buf.toString('latin1', start, start + tag.count).replace(/\0.*$/, '');
  };
  const parse = (s) => {
    const m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(s || '');
    return m ? validDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : null;
  };
  try {
    const ifd0 = readIfd(u32(t + 4));
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr) {
      const exif = readIfd(exifPtr.value);
      const d = parse(ascii(exif.get(0x9003))) || parse(ascii(exif.get(0x9004)));
      if (d) return d;
    }
    return parse(ascii(ifd0.get(0x0132)));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Video (MP4/MOV: "mvhd"-Box)
async function videoDate(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const head = Buffer.alloc(16);
    const findBox = async (start, end, type) => {
      let o = start;
      while (o + 8 <= end) {
        await fh.read(head, 0, 16, o);
        let len = head.readUInt32BE(0);
        const t = head.toString('latin1', 4, 8);
        let hdr = 8;
        if (len === 1) {
          len = Number(head.readBigUInt64BE(8));
          hdr = 16;
        } else if (len === 0) len = end - o;
        if (len < hdr) return null;
        if (t === type) return { start: o + hdr, end: o + len };
        o += len;
      }
      return null;
    };
    const moov = await findBox(0, size, 'moov');
    if (!moov) return null;
    const mvhd = await findBox(moov.start, moov.end, 'mvhd');
    if (!mvhd) return null;
    const b = Buffer.alloc(12);
    await fh.read(b, 0, 12, mvhd.start);
    const secs = b[0] === 1 ? Number(b.readBigUInt64BE(4)) : b.readUInt32BE(4);
    if (!secs) return null;
    const d = new Date((secs - 2082844800) * 1000); // Sekunden seit 1904 → seit 1970
    return d.getFullYear() >= 1990 && d.getFullYear() <= 2100 ? d : null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/** Aufnahmedatum eines Fotos oder Videos (null, wenn keins drinsteht) */
async function takenDate(file) {
  const kind = kindOf(path.basename(file));
  if (kind === 'video') return videoDate(file);
  if (kind !== 'image') return null;
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(512 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return exifDate(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

// ------------------------------------------------------------------ Datum im Dateinamen
/**
 * Erkennt u. a.: IMG_20250312_141522, PXL_20250312_141522123, IMG-20250312-WA0001,
 * Screenshot 2025-03-12 at 14.15.22, 2025-03-12, 12.03.2025, 1710252922000 (Millisekunden)
 */
function dateFromName(name) {
  const s = String(name);
  let m = /(?<!\d)(19[7-9]\d|20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)(?:[ _T-]+(?:at |um )?(\d\d)[-_.:h]?(\d\d)[-_.:m]?(\d\d)|(?!\d))/.exec(s);
  if (m) {
    const d = m[4] ? validDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : validDate(+m[1], +m[2], +m[3]);
    if (d) return d;
    const d2 = validDate(+m[1], +m[2], +m[3]);
    if (d2) return d2;
  }
  m = /(?<!\d)(\d\d)\.(\d\d)\.(19[7-9]\d|20\d\d)(?!\d)/.exec(s);
  if (m) {
    const d = validDate(+m[3], +m[2], +m[1]);
    if (d) return d;
  }
  m = /(?<!\d)(1[0-9]{12})(?!\d)/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]));
    if (d.getFullYear() >= 2001 && d.getFullYear() <= 2100) return d;
  }
  return null;
}

// ------------------------------------------------------------------ Datum setzen
const run = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr })));

/**
 * Erstelldatum setzen.
 * Mac: Liegt das neue Datum VOR dem jetzigen, setzt macOS es beim Ändern des Änderungsdatums mit.
 *      Sonst über SetFile (nur wenn die Xcode-Werkzeuge installiert sind).
 * Windows: über PowerShell (in einem Rutsch für alle Dateien).
 * @param {{path:string, created:Date}[]} items
 * @returns {Promise<Set<string>>} Pfade, bei denen es geklappt hat
 */
async function setCreatedBatch(items, platform = process.platform) {
  const ok = new Set();
  if (!items.length) return ok;
  if (platform === 'darwin') {
    for (const it of items) {
      const st = await fsp.stat(it.path);
      const want = it.created.getTime();
      if (Math.abs(st.birthtimeMs - want) < 1000) {
        ok.add(it.path);
        continue;
      }
      if (want < st.birthtimeMs) {
        await fsp.utimes(it.path, st.atime, it.created);
        await fsp.utimes(it.path, st.atime, st.mtime);
      } else {
        const d = it.created;
        const p2 = (n) => String(n).padStart(2, '0');
        await run('/usr/bin/SetFile', ['-d', `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`, it.path]);
      }
      const after = await fsp.stat(it.path);
      if (Math.abs(after.birthtimeMs - want) < 2000) ok.add(it.path);
    }
    return ok;
  }
  if (platform === 'win32') {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'slimkit-'));
    const json = path.join(dir, 'items.json');
    const ps1 = path.join(dir, 'set.ps1');
    fs.writeFileSync(json, JSON.stringify(items.map((i) => ({ p: i.path, t: i.created.getTime() }))), 'utf8');
    fs.writeFileSync(
      ps1,
      [
        '$ErrorActionPreference = "Continue"',
        `$items = Get-Content -Raw -Encoding UTF8 -LiteralPath '${json.replace(/'/g, "''")}' | ConvertFrom-Json`,
        'foreach ($i in $items) {',
        '  try { (Get-Item -LiteralPath $i.p -Force).CreationTime = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$i.t).LocalDateTime; Write-Output ("OK " + $i.p) } catch { }',
        '}',
      ].join('\r\n'),
      'utf8',
    );
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1]);
    for (const line of String(r.stdout || '').split(/\r?\n/)) if (line.startsWith('OK ')) ok.add(line.slice(3));
    fs.rmSync(dir, { recursive: true, force: true });
    return ok;
  }
  return ok;
}

/**
 * Neues Datum je Datei berechnen.
 * mode: 'fixed' (date), 'taken' (Aufnahmedatum), 'name' (aus Dateiname), 'shift' (minutes verschieben), 'modified' (Änderungsdatum → Erstelldatum)
 * @returns {Promise<{path:string, old:{mtimeMs:number, birthtimeMs:number}, next:Date|null}[]>}
 */
async function planDates(paths, { mode, date, minutes = 0, fallback = 'skip' }) {
  const out = [];
  for (const p of paths) {
    const st = await fsp.stat(p);
    let next = null;
    if (mode === 'fixed') next = date ? new Date(date) : null;
    else if (mode === 'taken') next = await takenDate(p);
    else if (mode === 'name') next = dateFromName(path.basename(p));
    else if (mode === 'shift') next = new Date(st.mtimeMs + minutes * 60000);
    else if (mode === 'modified') next = new Date(st.mtimeMs);
    if (!next && fallback === 'name') next = dateFromName(path.basename(p));
    if (!next && fallback === 'taken') next = await takenDate(p);
    out.push({ path: p, old: { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs }, next });
  }
  return out;
}

/**
 * Datum setzen. which: 'modified' | 'created' | 'both'
 * @returns {Promise<{done:number, failed:string[], createdFailed:number, ops:object[]}>}
 */
async function applyDates(plan, which, platform = process.platform) {
  const ops = [];
  const failed = [];
  const items = plan.filter((p) => p.next && !isNaN(p.next.getTime()));
  // Erst Erstelldatum (auf dem Mac verändert das kurz das Änderungsdatum), dann Änderungsdatum
  let createdOk = new Set();
  if (which !== 'modified') createdOk = await setCreatedBatch(items.map((i) => ({ path: i.path, created: i.next })), platform);
  let done = 0;
  for (const it of items) {
    try {
      if (which !== 'created') await fsp.utimes(it.path, new Date(it.old.atimeMs), it.next);
      else await fsp.utimes(it.path, new Date(it.old.atimeMs), new Date(it.old.mtimeMs));
      ops.push({ t: 'times', path: it.path, atimeMs: it.old.atimeMs, mtimeMs: it.old.mtimeMs, birthtimeMs: which !== 'modified' ? it.old.birthtimeMs : 0 });
      done++;
    } catch {
      failed.push(it.path);
    }
  }
  const createdFailed = which === 'modified' ? 0 : items.filter((i) => !createdOk.has(i.path)).length;
  return { done, failed, createdFailed, ops };
}

module.exports = { exifDate, videoDate, takenDate, dateFromName, setCreatedBatch, planDates, applyDates, validDate };
