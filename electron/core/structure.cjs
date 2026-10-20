'use strict';
/**
 * Ordnerstruktur kopieren – nur die Ordner, ohne Dateien (wahlweise bestimmte Dateitypen mit).
 * Jahreszahlen in Ordnernamen können dabei automatisch ersetzt werden (2025 → 2026).
 */
const fsp = require('node:fs/promises');
const path = require('node:path');
const { walk, exists, extOf, isInside, safeName } = require('./fsutil.cjs');

const YEAR_RE = /(?<!\d)(19[5-9]\d|20\d\d|21\d\d)(?!\d)/g;

/** Alle Jahreszahlen in einem Namen */
function findYears(name) {
  return [...String(name).matchAll(YEAR_RE)].map((m) => Number(m[1]));
}

/**
 * Vorschlag für Ersetzungen aus dem Namen des Quellordners:
 * "Fotos 2025" → {2025: 2026}; "Schuljahr 2025-2026" → {2025: 2026, 2026: 2027}.
 * Ohne Jahreszahl im Namen: die häufigste Jahreszahl der Unterordner.
 */
function suggestYearMap(rootName, subNames = [], step = 1) {
  let years = [...new Set(findYears(rootName))];
  if (!years.length) {
    const count = new Map();
    for (const n of subNames) for (const y of new Set(findYears(n))) count.set(y, (count.get(y) || 0) + 1);
    const best = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (best) years = [best[0]];
  }
  const map = {};
  for (const y of years) map[String(y)] = String(y + step);
  return map;
}

/** Ersetzungen gleichzeitig anwenden (nicht nacheinander – sonst würde 2025→2026→2027). */
function applyMap(name, map, extra = []) {
  let out = String(name);
  const keys = Object.keys(map || {}).filter((k) => k !== '');
  if (keys.length) {
    const re = new RegExp(keys.map((k) => (/^\d{4}$/.test(k) ? `(?<!\\d)${k}(?!\\d)` : escapeRe(k))).join('|'), 'g');
    out = out.replace(re, (m) => map[m] ?? m);
  }
  for (const r of extra) if (r && r.from) out = out.split(r.from).join(r.to ?? '');
  return out;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Plan erstellen.
 * @param {string} src Quellordner
 * @param {string} destRoot Zielordner (wird angelegt bzw. ergänzt)
 * @param {{ map?: Record<string,string>, replace?: {from:string,to:string}[], includeExt?: string[], maxDepth?: number, limit?: number }} opts
 * @returns {Promise<{ dirs: {rel:string, path:string, exists:boolean}[], files: {from:string, to:string, exists:boolean}[], skippedFiles: number, truncated: boolean }>}
 */
async function planStructure(src, destRoot, opts = {}) {
  const map = opts.map || {};
  const include = new Set((opts.includeExt || []).map((e) => String(e).toLowerCase().replace(/^\./, '')).filter(Boolean));
  const limit = opts.limit ?? 50000;
  if (path.resolve(src) === path.resolve(destRoot)) throw new Error('same-folder');
  const dirs = [];
  const files = [];
  let skippedFiles = 0;
  let truncated = false;
  const mapRel = (rel) =>
    rel
      .split('/')
      .map((part) => safeName(applyMap(part, map, opts.replace), part))
      .join('/');
  for await (const e of walk(src, { maxDepth: opts.maxDepth ?? Infinity })) {
    // Liegt das Ziel im Quellordner, das Ziel selbst nicht mitkopieren
    if (isInside(destRoot, e.path)) continue;
    if (dirs.length + files.length >= limit) {
      truncated = true;
      break;
    }
    const to = path.join(destRoot, ...mapRel(e.rel).split('/'));
    if (e.isDir) dirs.push({ rel: mapRel(e.rel), path: to, exists: exists(to) });
    else if (include.has(extOf(e.name))) files.push({ from: e.path, to, exists: exists(to) });
    else skippedFiles++;
  }
  return { dirs, files, skippedFiles, truncated };
}

/**
 * Plan ausführen: Ordner anlegen (vorhandene bleiben), ausgewählte Dateien kopieren (nie überschreiben).
 * @returns {Promise<{ created:number, existed:number, copied:number, ops: object[] }>}
 */
async function applyStructure(destRoot, plan, onProgress) {
  const ops = [];
  let created = 0;
  let existed = 0;
  let copied = 0;
  const mk = async (p) => {
    if (exists(p)) {
      existed++;
      return;
    }
    // fehlende Elternordner zuerst (für sauberes Rückgängig)
    const parent = path.dirname(p);
    if (parent !== p && !exists(parent)) await mk(parent);
    await fsp.mkdir(p);
    ops.push({ t: 'mkdir', path: p });
    created++;
  };
  await mk(destRoot);
  let i = 0;
  const total = plan.dirs.length + plan.files.length;
  for (const d of plan.dirs) {
    await mk(d.path);
    if (onProgress && ++i % 50 === 0) onProgress(i, total);
  }
  for (const f of plan.files) {
    if (exists(f.to)) continue;
    await mk(path.dirname(f.to));
    await fsp.copyFile(f.from, f.to, 1 /* COPYFILE_EXCL */);
    ops.push({ t: 'create', path: f.to });
    copied++;
    if (onProgress && ++i % 20 === 0) onProgress(i, total);
  }
  return { created, existed, copied, ops };
}

/** Struktur als Vorlage (nur relative Ordnerpfade) */
async function captureTemplate(src, maxDepth = 12) {
  const dirs = [];
  for await (const e of walk(src, { maxDepth })) if (e.isDir) dirs.push(e.rel);
  return dirs;
}

/** Vorlage anlegen: dirs = relative Pfade */
function planFromTemplate(dirs, destRoot, map = {}) {
  return {
    dirs: dirs.map((rel) => {
      const mapped = rel
        .split('/')
        .map((p) => safeName(applyMap(p, map), p))
        .join('/');
      const p = path.join(destRoot, ...mapped.split('/'));
      return { rel: mapped, path: p, exists: exists(p) };
    }),
    files: [],
    skippedFiles: 0,
    truncated: false,
  };
}

/**
 * Für die Automatik "Neues Jahr": im Ordner parent den neuesten Jahres-Ordner vor `year` finden.
 * Beispiel: parent enthält "Fotos 2024", "Fotos 2025" → für 2026 wird "Fotos 2025" genommen.
 */
async function latestYearFolder(parent, year) {
  let best = null;
  let list = [];
  try {
    list = await fsp.readdir(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of list) {
    if (!d.isDirectory()) continue;
    const ys = findYears(d.name).filter((y) => y < year);
    if (!ys.length) continue;
    const y = Math.max(...ys);
    if (!best || y > best.year) best = { name: d.name, path: path.join(parent, d.name), year: y };
  }
  return best;
}

module.exports = { findYears, suggestYearMap, applyMap, planStructure, applyStructure, captureTemplate, planFromTemplate, latestYearFolder };
