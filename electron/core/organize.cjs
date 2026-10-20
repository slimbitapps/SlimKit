'use strict';
/** Ordner aufräumen: sortieren, auflösen, leere Ordner, Duplikate, Größe, Dateiliste, Prüfsumme. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { walk, uniquePath, moveFile, kindOf, extOf, isEffectivelyEmpty, exists } = require('./fsutil.cjs');
const { takenDate } = require('./dates.cjs');

const pad = (n) => String(n).padStart(2, '0');

/** Unterordner-Name je Datei. by: 'month' | 'year' | 'day' | 'type' | 'ext' */
function folderFor(by, date, name, kindNames) {
  if (by === 'type') return (kindNames && kindNames[kindOf(name)]) || kindOf(name);
  if (by === 'ext') return (extOf(name) || 'other').toUpperCase();
  const d = date;
  if (by === 'year') return String(d.getFullYear());
  if (by === 'day') return path.join(String(d.getFullYear()), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  return path.join(String(d.getFullYear()), `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
}

/**
 * Dateien in Unterordner sortieren (nur Dateien direkt in den gewählten Ordnern bzw. die gewählten Dateien).
 * @param {string[]} paths Ordner (deren Dateien) oder einzelne Dateien
 * @param {{by:string, target?:string, useTaken?:boolean, kindNames?:Record<string,string>}} opts
 */
async function planSort(paths, opts) {
  const files = [];
  for (const p of paths) {
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      for (const d of await fsp.readdir(p, { withFileTypes: true })) {
        if (d.isFile() && !d.name.startsWith('.') && !/^(desktop\.ini|Thumbs\.db)$/i.test(d.name)) files.push(path.join(p, d.name));
      }
    } else if (st.isFile()) files.push(p);
  }
  const taken = new Set();
  const moves = [];
  for (const f of files) {
    const st = await fsp.stat(f);
    let date = new Date(st.mtimeMs);
    if (opts.useTaken !== false && (opts.by === 'month' || opts.by === 'year' || opts.by === 'day')) date = (await takenDate(f)) || date;
    const base = opts.target || path.dirname(f);
    const to = uniquePath(path.join(base, folderFor(opts.by, date, path.basename(f), opts.kindNames), path.basename(f)), taken);
    taken.add(to.toLowerCase());
    moves.push({ from: f, to, folder: path.relative(base, path.dirname(to)) });
  }
  return moves;
}

/** Verschiebungen ausführen → ops für den Verlauf */
async function applyMoves(moves, onProgress) {
  const ops = [];
  const failed = [];
  let i = 0;
  for (const m of moves) {
    try {
      const to = exists(m.to) ? uniquePath(m.to) : m.to;
      await moveFile(m.from, to);
      ops.push({ t: 'move', from: m.from, to });
    } catch (e) {
      failed.push({ from: m.from, error: e.code || String(e) });
    }
    if (onProgress && ++i % 25 === 0) onProgress(i, moves.length);
  }
  return { done: ops.length, failed, ops };
}

/** Ordner auflösen: alle Dateien aus Unterordnern in den Ordner selbst holen. */
async function planFlatten(root) {
  const taken = new Set();
  const moves = [];
  for await (const e of walk(root, { hidden: false })) {
    if (e.isDir || e.depth === 0) continue;
    const to = uniquePath(path.join(root, e.name), taken);
    taken.add(to.toLowerCase());
    moves.push({ from: e.path, to, folder: path.dirname(e.rel) });
  }
  return moves;
}

/** Leere Ordner finden (auch solche, die nur leere Ordner/Systemdateien enthalten) – oberste zuerst. */
async function findEmptyDirs(root) {
  const out = [];
  async function visit(dir) {
    let list;
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue;
      const p = path.join(dir, d.name);
      if (await isEffectivelyEmpty(p)) out.push(p);
      else await visit(p);
    }
  }
  await visit(root);
  return out;
}

/** Duplikate: gleiche Größe → gleicher Anfang → gleicher Inhalt (SHA-256). */
async function findDuplicates(paths, { minSize = 1, onProgress, signal } = {}) {
  const bySize = new Map();
  let scanned = 0;
  for (const p of paths) {
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    const add = (file, size, mtimeMs) => {
      if (size < minSize) return;
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size).push({ path: file, size, mtimeMs });
    };
    if (st.isDirectory()) {
      for await (const e of walk(p, { signal })) {
        if (!e.isDir) add(e.path, e.size, e.mtimeMs);
        if (onProgress && ++scanned % 200 === 0) onProgress({ phase: 'scan', n: scanned });
      }
    } else add(p, st.size, st.mtimeMs);
  }
  const groups = [];
  let checked = 0;
  for (const list of bySize.values()) {
    if (list.length < 2) continue;
    const uniq = [...new Map(list.map((f) => [f.path, f])).values()];
    if (uniq.length < 2) continue;
    const byHead = groupBy(await Promise.all(uniq.map(async (f) => ({ ...f, k: await hashFile(f.path, 65536) }))), 'k');
    for (const g of byHead) {
      if (g.length < 2) continue;
      const full = g[0].size <= 65536 ? g : await Promise.all(g.map(async (f) => ({ ...f, k: await hashFile(f.path) })));
      for (const same of groupBy(full, 'k')) if (same.length > 1) groups.push(same.map(({ k, ...f }) => (void k, f)).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.length - b.path.length));
      if (signal && signal.aborted) break;
    }
    if (onProgress) onProgress({ phase: 'compare', n: ++checked });
  }
  return groups.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
}
function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    if (!m.has(x[key])) m.set(x[key], []);
    m.get(x[key]).push(x);
  }
  return [...m.values()];
}

/** Prüfsumme einer Datei (limit = nur die ersten Bytes) */
function hashFile(file, limit, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const s = fs.createReadStream(file, limit ? { start: 0, end: limit - 1 } : {});
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** Ordnergröße: Summe, Anzahl, Größe je Unterordner, größte Dateien */
async function sizeReport(root, { top = 40, signal } = {}) {
  let total = 0;
  let files = 0;
  let dirs = 0;
  const children = new Map();
  const biggest = [];
  const byKind = {};
  for await (const e of walk(root, { hidden: true, signal })) {
    const first = e.rel.split('/')[0];
    if (e.isDir) {
      dirs++;
      if (e.depth === 0) children.set(first, children.get(first) || { name: first, path: e.path, size: 0, isDir: true });
      continue;
    }
    files++;
    total += e.size;
    const k = kindOf(e.name);
    byKind[k] = (byKind[k] || 0) + e.size;
    if (e.depth === 0) children.set(first, { name: first, path: e.path, size: e.size, isDir: false });
    else children.get(first).size += e.size;
    if (biggest.length < top || e.size > biggest[biggest.length - 1].size) {
      biggest.push({ path: e.path, rel: e.rel, size: e.size });
      biggest.sort((a, b) => b.size - a.size);
      if (biggest.length > top) biggest.pop();
    }
  }
  return { total, files, dirs, children: [...children.values()].sort((a, b) => b.size - a.size), biggest, byKind };
}

/** Dateiliste als CSV (Excel-freundlich: Semikolon, UTF-8 mit BOM) oder als eingerückter Text */
async function fileList(root, { format = 'csv', labels = {} } = {}) {
  const L = { name: 'Name', folder: 'Folder', size: 'Size (bytes)', modified: 'Modified', type: 'Type', ...labels };
  const rows = [];
  for await (const e of walk(root)) rows.push(e);
  if (format === 'txt') {
    const lines = [path.basename(root) + '/'];
    for (const e of rows) lines.push('  '.repeat(e.depth + 1) + e.name + (e.isDir ? '/' : ''));
    return lines.join('\n') + '\n';
  }
  const q = (s) => (/[;"\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
  const out = [[L.name, L.folder, L.size, L.modified, L.type].join(';')];
  for (const e of rows) {
    if (e.isDir) continue;
    const d = new Date(e.mtimeMs);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    out.push([q(e.name), q(path.dirname(e.rel) === '.' ? '' : path.dirname(e.rel)), e.size, date, q(extOf(e.name).toUpperCase())].join(';'));
  }
  return '﻿' + out.join('\r\n') + '\r\n';
}

module.exports = { planSort, applyMoves, planFlatten, findEmptyDirs, findDuplicates, hashFile, sizeReport, fileList, folderFor };
