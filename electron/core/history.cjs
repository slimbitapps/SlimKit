'use strict';
/**
 * Verlauf mit Rückgängig. Jede Aktion speichert, was sie geändert hat:
 *   { t: 'move', from, to }          Datei/Ordner verschoben oder umbenannt
 *   { t: 'mkdir', path }             Ordner angelegt
 *   { t: 'create', path }            Datei neu erzeugt
 *   { t: 'times', path, atimeMs, mtimeMs, birthtimeMs }   Datum geändert (alte Werte)
 * Rückgängig läuft rückwärts durch die Liste.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { exists, moveFile, isJunk } = require('./fsutil.cjs');

const MAX = 60;

class History {
  /**
   * @param {string} file JSON-Datei
   * @param {{ trash?: (p:string)=>Promise<void>, setCreated?: (p:string, d:Date)=>Promise<void> }} [io]
   */
  constructor(file, io = {}) {
    this.file = file;
    this.io = io;
    this.items = [];
    try {
      this.items = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(this.items)) this.items = [];
    } catch {
      this.items = [];
    }
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.items));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch {
      /* egal */
    }
  }
  /** Neuer Eintrag. tool = Werkzeug-ID, title = kurze Beschreibung, count = Anzahl Dateien */
  add({ tool, title, count, ops, auto = false }) {
    if (!ops || (!ops.length && !count)) return null;
    const item = { id: crypto.randomUUID(), at: Date.now(), tool, title, count: count ?? ops.length, ops, auto, undone: false };
    this.items.unshift(item);
    this.items = this.items.slice(0, MAX);
    this.save();
    return item;
  }
  list() {
    return this.items.map(({ ops, ...rest }) => ({ ...rest, undoable: !rest.undone && ops.length > 0 }));
  }
  clear() {
    this.items = [];
    this.save();
  }

  /** Eine Aktion rückgängig machen. Gibt zurück, wie viele Schritte geklappt haben. */
  async undo(id) {
    const item = this.items.find((x) => x.id === id);
    if (!item || item.undone) return { ok: 0, failed: 0 };
    let ok = 0;
    let failed = 0;
    for (const op of [...item.ops].reverse()) {
      try {
        if (await undoOp(op, this.io)) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
    item.undone = true;
    this.save();
    return { ok, failed };
  }
}

async function undoOp(op, io) {
  if (op.t === 'move') {
    if (!exists(op.to)) return false;
    // Nur Groß-/Kleinschreibung geändert → über einen Zwischennamen
    if (op.from.toLowerCase() === op.to.toLowerCase()) {
      const tmp = op.to + '.slimkit-undo';
      await fsp.rename(op.to, tmp);
      await fsp.rename(tmp, op.from);
      return true;
    }
    if (exists(op.from)) return false;
    await moveFile(op.to, op.from);
    return true;
  }
  if (op.t === 'mkdir') {
    if (!exists(op.path)) return true;
    // Nur entfernen, wenn wirklich nichts drin ist (Systemdateien wie .DS_Store zählen nicht)
    const rest = (await fsp.readdir(op.path)).filter((n) => !isJunk(n));
    if (rest.length) return false;
    await fsp.rm(op.path, { recursive: true, force: true });
    return true;
  }
  if (op.t === 'create') {
    if (!exists(op.path)) return true;
    if (io.trash) await io.trash(op.path);
    else await fsp.rm(op.path, { force: true });
    return true;
  }
  if (op.t === 'times') {
    if (!exists(op.path)) return false;
    if (op.birthtimeMs && io.setCreated) await io.setCreated(op.path, new Date(op.birthtimeMs));
    await fsp.utimes(op.path, new Date(op.atimeMs), new Date(op.mtimeMs));
    return true;
  }
  return false;
}

module.exports = { History };
