'use strict';
/** Einstellungen als JSON-Datei im Benutzerordner. Schreibt sicher (erst Temp-Datei, dann umbenennen). */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  version: 1,
  onboarded: false,
  prefs: { lang: '', theme: 'system', mode: 'simple' },
  menu: { installed: false, actions: ['open', 'structure', 'rename', 'images', 'send', 'receive', 'dates', 'sort', 'pdf', 'copypath', 'newfile'] },
  background: { tray: true, autostart: false },
  images: { size: 'fhd', maxSide: 1920, percent: 50, format: 'same', quality: 82, targetKB: 0, output: 'folder' },
  structure: { includeExt: [], step: 1 },
  transfer: { port: 8643, inbox: '', address: 'auto' },
  templates: [],
  automations: [],
  window: {},
};

function isObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}
/** Gespeicherte Werte über die Standardwerte legen (fehlende Felder bleiben Standard). */
function merge(base, over) {
  if (!isObj(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (isObj(base[k]) && isObj(v)) out[k] = merge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = merge(DEFAULTS, readJson(file));
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch {
      /* nächster Versuch beim nächsten Speichern */
    }
  }
  update(partial) {
    this.data = merge(this.data, partial || {});
    this.save();
    return this.data;
  }
  public() {
    return structuredClone(this.data);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { SettingsStore, DEFAULTS, merge };
