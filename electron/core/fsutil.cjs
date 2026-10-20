'use strict';
/** Kleine Helfer rund um Dateien und Ordner – ohne Electron, damit sie testbar sind. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/** Systemdateien, die beim Kopieren/Zählen ignoriert werden */
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', 'Icon\r', '.Spotlight-V100', '.Trashes', '.fseventsd']);
const isJunk = (name) => JUNK.has(name) || name.startsWith('._');

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif', 'svg', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2'],
  video: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'wmv', '3gp', 'mts', 'm2ts'],
  audio: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'wma', 'aiff', 'opus'],
  doc: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages', 'xls', 'xlsx', 'ods', 'csv', 'numbers', 'ppt', 'pptx', 'odp', 'key', 'epub'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  app: ['exe', 'msi', 'dmg', 'pkg', 'appx', 'msix', 'apk', 'iso'],
};
const EXT_KIND = new Map();
for (const [k, list] of Object.entries(KINDS)) for (const e of list) EXT_KIND.set(e, k);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
function kindOf(name) {
  return EXT_KIND.get(extOf(name)) || 'other';
}
/** Name ohne Endung und Endung (mit Punkt) */
function splitName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

/** Verbotene Zeichen für Windows UND Mac entfernen – Dateinamen sollen überall funktionieren. */
function safeName(name, fallback = 'file') {
  let s = String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;
  if (!s || s === '.' || s === '..') s = fallback;
  return s.slice(0, 240);
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Freien Namen finden: "Foto.jpg" → "Foto (2).jpg" */
function uniquePath(p, taken) {
  const has = (x) => exists(x) || (taken && taken.has(x.toLowerCase()));
  if (!has(p)) return p;
  const dir = path.dirname(p);
  const [base, ext] = splitName(path.basename(p));
  for (let i = 2; ; i++) {
    const c = path.join(dir, `${base} (${i})${ext}`);
    if (!has(c)) return c;
  }
}

/** Verschieben – auch über Laufwerksgrenzen (dann kopieren + löschen). */
async function moveFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

/**
 * Alle Einträge eines Ordners durchlaufen (Tiefe zuerst).
 * @returns {AsyncGenerator<{path:string, rel:string, name:string, isDir:boolean, size:number, mtimeMs:number, depth:number}>}
 */
async function* walk(root, { maxDepth = Infinity, hidden = false, signal } = {}) {
  async function* inner(dir, rel, depth) {
    if (signal && signal.aborted) return;
    let list;
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const d of list) {
      if (isJunk(d.name)) continue;
      if (!hidden && d.name.startsWith('.')) continue;
      if (d.isSymbolicLink()) continue;
      const p = path.join(dir, d.name);
      const r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) {
        // Mac-Pakete (z. B. .app, .photoslibrary) sind für Nutzer eine Datei
        const pkg = /\.(app|photoslibrary|bundle|framework|pages|numbers|key|rtfd|fcpbundle|imovielibrary)$/i.test(d.name);
        if (pkg) {
          yield { path: p, rel: r, name: d.name, isDir: false, size: await dirSize(p), mtimeMs: (await statSafe(p))?.mtimeMs || 0, depth };
          continue;
        }
        yield { path: p, rel: r, name: d.name, isDir: true, size: 0, mtimeMs: 0, depth };
        if (depth + 1 < maxDepth) yield* inner(p, r, depth + 1);
      } else if (d.isFile()) {
        const st = await statSafe(p);
        yield { path: p, rel: r, name: d.name, isDir: false, size: st ? st.size : 0, mtimeMs: st ? st.mtimeMs : 0, depth };
      }
    }
  }
  yield* inner(root, '', 0);
}

async function statSafe(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

async function dirSize(dir) {
  let total = 0;
  for await (const e of walk(dir, { hidden: true })) if (!e.isDir) total += e.size;
  return total;
}

/** Ordner als leer zählen, wenn nur Systemdateien drin liegen (rekursiv). */
async function isEffectivelyEmpty(dir) {
  let list;
  try {
    list = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const d of list) {
    if (isJunk(d.name)) continue;
    if (d.isDirectory() && !d.isSymbolicLink()) {
      if (!(await isEffectivelyEmpty(path.join(dir, d.name)))) return false;
    } else return false;
  }
  return true;
}

/** Ist b gleich a oder liegt b innerhalb von a? */
function isInside(a, b) {
  const r = path.relative(path.resolve(a), path.resolve(b));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

module.exports = { walk, uniquePath, moveFile, safeName, splitName, extOf, kindOf, KINDS, isJunk, exists, statSafe, dirSize, isEffectivelyEmpty, isInside };
