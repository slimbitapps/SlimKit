'use strict';
/**
 * Automatik – läuft, solange SlimKit (auch nur in der Menüleiste/Taskleiste) läuft.
 *  - year:    Zum Stichtag die Ordnerstruktur des Vorjahres fortführen (2025 → 2026)
 *  - tidy:    Neue Dateien in einem Ordner automatisch nach Typ oder Monat einsortieren
 *  - cleanup: Dateien, die älter als X Tage sind, in den Papierkorb legen
 * Alles wird im Verlauf gespeichert und lässt sich rückgängig machen (außer Papierkorb – der ist selbst das Rückgängig).
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { latestYearFolder, planStructure, applyStructure, findYears, applyMap } = require('./structure.cjs');
const { planSort, applyMoves } = require('./organize.cjs');
const { exists } = require('./fsutil.cjs');

const PARTIAL = /\.(crdownload|part|partial|download|tmp|opdownload|!ut|slimkit-part)$/i;
const DAY = 86400000;

/** Wann ist eine Automatik dran? */
function isDue(a, now = new Date()) {
  if (!a.enabled) return false;
  if (a.type === 'year') {
    const y = now.getFullYear();
    if ((a.lastYear || 0) >= y) return false;
    return now >= new Date(y, (a.month || 1) - 1, a.day || 1);
  }
  if (a.type === 'cleanup') return now.getTime() - (a.lastRun || 0) > 6 * 3600000;
  if (a.type === 'tidy') return now.getTime() - (a.lastRun || 0) > 10 * 60000;
  return false;
}

/** Plan für "Neues Jahr": welcher Ordner wird wohin fortgeführt? */
async function planYear(a, now = new Date()) {
  const year = now.getFullYear();
  let src = null;
  if (a.source && exists(a.source)) {
    const ys = findYears(path.basename(a.source));
    src = { path: a.source, name: path.basename(a.source), year: ys.length ? Math.max(...ys) : year - 1 };
  } else src = await latestYearFolder(a.parent, year);
  if (!src) return null;
  const delta = year - src.year;
  const map = {};
  for (const y of new Set(findYears(src.name))) map[String(y)] = String(y + delta);
  const parent = a.parent || path.dirname(src.path);
  const destName = applyMap(src.name, map);
  if (destName === src.name) return null;
  const dest = path.join(parent, destName);
  const plan = await planStructure(src.path, dest, { map, includeExt: a.includeExt || [] });
  return { src: src.path, dest, year, plan };
}

/** Dateien, die "tidy" wegsortieren würde */
async function tidyCandidates(a, now = Date.now()) {
  const out = [];
  let list = [];
  try {
    list = await fsp.readdir(a.folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of list) {
    if (!d.isFile() || d.name.startsWith('.') || PARTIAL.test(d.name) || /^(desktop\.ini|Thumbs\.db)$/i.test(d.name)) continue;
    const p = path.join(a.folder, d.name);
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    if (now - Math.max(st.mtimeMs, st.birthtimeMs || 0) < (a.minAgeSec ?? 60) * 1000) continue;
    out.push(p);
  }
  return out;
}

/** Dateien, die "cleanup" in den Papierkorb legen würde */
async function cleanupCandidates(a, now = Date.now()) {
  const out = [];
  let list = [];
  try {
    list = await fsp.readdir(a.folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of list) {
    if (d.name.startsWith('.') || /^(desktop\.ini|Thumbs\.db)$/i.test(d.name)) continue;
    if (d.isDirectory() && !a.folders) continue;
    const p = path.join(a.folder, d.name);
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    // Zuletzt "angefasst": Änderung, Hinzufügen (birthtime) oder Öffnen
    const touched = Math.max(st.mtimeMs, st.birthtimeMs || 0, a.useAccess ? st.atimeMs : 0);
    if (now - touched > (a.days || 30) * DAY) out.push({ path: p, size: st.size, touched });
  }
  return out;
}

class AutomationRunner {
  /**
   * @param {{ list: () => any[], update: (id:string, patch:object) => void,
   *   history: import('./history.cjs').History, trash: (p:string)=>Promise<void>,
   *   notify?: (title:string, body:string)=>void, kindNames?: () => Record<string,string>, t?: (k:string, p?:object)=>string, log?: Function }} io
   */
  constructor(io) {
    this.io = io;
    this.watchers = new Map();
    this.timers = new Map();
    this.busy = new Set();
    this.interval = null;
  }

  start() {
    this.stop();
    this.interval = setInterval(() => this.tick(), 60_000);
    this.rewatch();
    setTimeout(() => this.tick(), 3000);
  }
  stop() {
    clearInterval(this.interval);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
  /** Ordner beobachten (tidy) – nach Änderungen kurz warten, dann einsortieren */
  rewatch() {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const a of this.io.list()) {
      if (a.type !== 'tidy' || !a.enabled || !exists(a.folder)) continue;
      try {
        const w = fs.watch(a.folder, () => {
          clearTimeout(this.timers.get(a.id));
          this.timers.set(a.id, setTimeout(() => this.run(a.id).catch((e) => this.io.log?.(e)), ((a.minAgeSec ?? 60) + 5) * 1000));
        });
        w.on('error', () => {});
        this.watchers.set(a.id, w);
      } catch {
        /* Ordner nicht beobachtbar → nur der Minuten-Takt */
      }
    }
  }
  async tick(now = new Date()) {
    for (const a of this.io.list()) {
      if (isDue(a, now)) await this.run(a.id, now).catch((e) => this.io.log?.('automation', e));
    }
  }

  /** Vorschau ohne etwas zu ändern */
  async preview(a, now = new Date()) {
    if (a.type === 'year') {
      const p = await planYear(a, now);
      return p ? { kind: 'year', src: p.src, dest: p.dest, dirs: p.plan.dirs.filter((d) => !d.exists).length, exists: exists(p.dest) } : { kind: 'year', none: true };
    }
    if (a.type === 'tidy') {
      const files = await tidyCandidates(a, now.getTime());
      const moves = await planSort(files, { by: a.by || 'type', target: a.target || a.folder, kindNames: this.io.kindNames?.() });
      return { kind: 'tidy', moves: moves.slice(0, 200).map((m) => ({ name: path.basename(m.from), folder: m.folder })), count: moves.length };
    }
    if (a.type === 'cleanup') {
      const c = await cleanupCandidates(a, now.getTime());
      return { kind: 'cleanup', files: c.slice(0, 200).map((x) => ({ name: path.basename(x.path), size: x.size, touched: x.touched })), count: c.length, size: c.reduce((s, x) => s + x.size, 0) };
    }
    return null;
  }

  /** Eine Automatik jetzt ausführen */
  async run(id, now = new Date()) {
    const a = this.io.list().find((x) => x.id === id);
    if (!a || this.busy.has(id)) return null;
    this.busy.add(id);
    const t = this.io.t || ((k) => k);
    try {
      if (a.type === 'year') {
        const p = await planYear(a, now);
        this.io.update(id, { lastYear: now.getFullYear(), lastRun: now.getTime() });
        if (!p) return { done: 0 };
        const r = await applyStructure(p.dest, p.plan);
        if (r.ops.length) {
          this.io.history.add({ tool: 'structure', title: t('auto.log.year', { name: path.basename(p.dest) }), count: r.created, ops: r.ops, auto: true });
          this.io.notify?.(t('auto.notify.year.title', { year: p.year }), t('auto.notify.year.body', { name: path.basename(p.dest), n: r.created }));
        }
        return { done: r.created, dest: p.dest };
      }
      if (a.type === 'tidy') {
        const files = await tidyCandidates(a, now.getTime());
        this.io.update(id, { lastRun: now.getTime() });
        if (!files.length) return { done: 0 };
        const moves = await planSort(files, { by: a.by || 'type', target: a.target || a.folder, kindNames: this.io.kindNames?.() });
        const r = await applyMoves(moves);
        if (r.ops.length) this.io.history.add({ tool: 'sort', title: t('auto.log.tidy', { name: path.basename(a.folder), n: r.done }), count: r.done, ops: r.ops, auto: true });
        return { done: r.done };
      }
      if (a.type === 'cleanup') {
        const c = await cleanupCandidates(a, now.getTime());
        this.io.update(id, { lastRun: now.getTime() });
        let done = 0;
        for (const x of c) {
          try {
            await this.io.trash(x.path);
            done++;
          } catch {
            /* nächste Datei */
          }
        }
        if (done) this.io.history.add({ tool: 'cleanup', title: t('auto.log.cleanup', { name: path.basename(a.folder), n: done }), count: done, ops: [], auto: true });
        return { done };
      }
      return null;
    } finally {
      this.busy.delete(id);
    }
  }
}

module.exports = { AutomationRunner, isDue, planYear, tidyCandidates, cleanupCandidates };
