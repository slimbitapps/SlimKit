'use strict';
/**
 * Mehrere Dateien auf einmal umbenennen.
 * Vorlage mit Platzhaltern: {name} {n} {date} {time} {year} {month} {day} {folder} {ext}
 * Danach: Suchen/Ersetzen, Groß-/Kleinschreibung, Leerzeichen.
 */
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { splitName, safeName, exists } = require('./fsutil.cjs');

const DEFAULTS = {
  template: '{name}',
  find: '',
  replace: '',
  regex: false,
  matchCase: false,
  case: 'keep',
  extCase: 'keep',
  start: 1,
  step: 1,
  digits: 0,
  spaces: 'keep',
  sortBy: 'name',
};

const pad = (n, d) => String(n).padStart(d, '0');

function titleCase(s) {
  return s.toLocaleLowerCase().replace(/(^|[\s_\-(])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
}

/**
 * Neue Namen berechnen (ohne etwas zu ändern).
 * @param {{path:string, name?:string, date?:number}[]} files
 * @param {Partial<typeof DEFAULTS>} options
 * @returns {{from:string, to:string, name:string, changed:boolean, conflict:boolean, error?:string}[]}
 */
function computeRenames(files, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const list = files.map((f) => ({ ...f, name: f.name || path.basename(f.path) }));
  if (o.sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  else if (o.sortBy === 'date') list.sort((a, b) => (a.date || 0) - (b.date || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const digits = o.digits > 0 ? o.digits : Math.max(2, String(o.start + o.step * (list.length - 1)).length);

  let findRe = null;
  let error;
  if (o.find) {
    try {
      findRe = new RegExp(o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.matchCase ? 'g' : 'gi');
    } catch {
      error = 'regex';
    }
  }

  const out = list.map((f, i) => {
    const [base, ext] = splitName(f.name);
    const d = f.date ? new Date(f.date) : null;
    const tokens = {
      name: base,
      n: pad(o.start + i * o.step, digits),
      date: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}` : '',
      time: d ? `${pad(d.getHours(), 2)}-${pad(d.getMinutes(), 2)}-${pad(d.getSeconds(), 2)}` : '',
      year: d ? String(d.getFullYear()) : '',
      month: d ? pad(d.getMonth() + 1, 2) : '',
      day: d ? pad(d.getDate(), 2) : '',
      folder: path.basename(path.dirname(f.path)),
      ext: ext.slice(1),
    };
    let nb = (o.template || '{name}').replace(/\{(\w+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
    if (findRe) nb = nb.replace(findRe, o.replace ?? '');
    if (o.case === 'lower') nb = nb.toLocaleLowerCase();
    else if (o.case === 'upper') nb = nb.toLocaleUpperCase();
    else if (o.case === 'title') nb = titleCase(nb);
    if (o.spaces === 'underscore') nb = nb.replace(/\s+/g, '_');
    else if (o.spaces === 'dash') nb = nb.replace(/\s+/g, '-');
    else if (o.spaces === 'remove') nb = nb.replace(/\s+/g, '');
    nb = nb.replace(/\s{2,}/g, ' ').trim();
    let ne = ext;
    if (o.extCase === 'lower') ne = ext.toLowerCase();
    else if (o.extCase === 'upper') ne = ext.toUpperCase();
    const name = safeName(nb + ne, f.name);
    return { from: f.path, to: path.join(path.dirname(f.path), name), name, changed: name !== f.name, conflict: false, error };
  });

  // Doppelte Zielnamen und vorhandene fremde Dateien → " (2)" anhängen
  const sources = new Set(out.map((r) => r.from.toLowerCase()));
  const taken = new Set();
  for (const r of out) {
    let to = r.to;
    const busy = (p) => taken.has(p.toLowerCase()) || (exists(p) && !sources.has(p.toLowerCase()));
    if (busy(to)) {
      r.conflict = true;
      const [b, e] = splitName(r.name);
      for (let i = 2; busy(to); i++) to = path.join(path.dirname(r.to), `${b} (${i})${e}`);
      r.to = to;
      r.name = path.basename(to);
      r.changed = r.to !== r.from;
    }
    taken.add(r.to.toLowerCase());
  }
  return out;
}

/**
 * Umbenennen in zwei Schritten (erst Zwischennamen, dann Zielname) –
 * so klappen auch Tauschungen (a→b, b→a) und reine Groß-/Kleinänderungen.
 * @returns {Promise<{done:number, failed:{from:string, error:string}[], ops:object[]}>}
 */
async function applyRenames(plan) {
  const todo = plan.filter((r) => r.changed && !r.error);
  const tag = '.slimkit-' + crypto.randomBytes(3).toString('hex');
  const staged = [];
  const failed = [];
  for (const r of todo) {
    const tmp = r.from + tag;
    try {
      await fsp.rename(r.from, tmp);
      staged.push({ ...r, tmp });
    } catch (e) {
      failed.push({ from: r.from, error: e.code || String(e) });
    }
  }
  const ops = [];
  for (const r of staged) {
    try {
      if (exists(r.to)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      await fsp.rename(r.tmp, r.to);
      ops.push({ t: 'move', from: r.from, to: r.to });
    } catch (e) {
      await fsp.rename(r.tmp, r.from).catch(() => {});
      failed.push({ from: r.from, error: e.code || String(e) });
    }
  }
  return { done: ops.length, failed, ops };
}

module.exports = { computeRenames, applyRenames, RENAME_DEFAULTS: DEFAULTS };
