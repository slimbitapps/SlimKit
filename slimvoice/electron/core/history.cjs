'use strict';
/** Verlauf der letzten Diktate (bleibt lokal). So geht nichts verloren, falls das Einfügen mal nicht klappt. */
const fs = require('node:fs');
const path = require('node:path');

class History {
  constructor(file) {
    this.file = file;
    try {
      this.items = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(this.items)) this.items = [];
    } catch {
      this.items = [];
    }
  }
  add(entry, max = 200) {
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...entry };
    this.items.unshift(item);
    this.items = this.items.slice(0, Math.max(1, max));
    this.save();
    return item;
  }
  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  }
  clear() {
    this.items = [];
    this.save();
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
}

module.exports = { History };
