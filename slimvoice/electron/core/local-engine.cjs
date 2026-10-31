'use strict';
/**
 * Verbindung zum unsichtbaren Fenster mit der lokalen Spracherkennung (src/engine/main.ts).
 * Befehle gehen per webContents.send hin, Antworten kommen über ipc „engine:reply“ zurück.
 */
class LocalEngine {
  /** @param {{ create: () => Electron.BrowserWindow, onEvent: (ev) => void, log?: Function }} o */
  constructor(o) {
    this.o = o;
    this.win = null;
    this.seq = 0;
    this.pending = new Map();
    this.ready = null;
    this.onHello = null;
    this.status = { downloading: '', progress: 0, loaded: 0, total: 0, device: '', loadedModel: '' };
  }
  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.ready;
    this.ready = new Promise((resolve) => (this.onHello = resolve));
    this.win = this.o.create();
    this.win.on('closed', () => {
      this.win = null;
      for (const p of this.pending.values()) p.reject(new Error('engine closed'));
      this.pending.clear();
    });
    return this.ready;
  }
  /** vom Hauptprozess aufrufen, wenn „engine:event“ ankommt */
  event(ev) {
    if (ev.type === 'hello') this.onHello?.();
    if (ev.type === 'loading') Object.assign(this.status, { downloading: ev.model, progress: 0, loaded: 0, total: 0 });
    if (ev.type === 'progress') Object.assign(this.status, { downloading: ev.model, progress: ev.progress, loaded: ev.loaded, total: ev.total });
    if (ev.type === 'ready') Object.assign(this.status, { downloading: '', progress: 100, device: ev.device, loadedModel: ev.model });
    if (ev.type === 'error') this.status.downloading = '';
    this.o.onEvent(ev);
  }
  reply(id, result) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(result);
  }
  async send(cmd, args = {}, transfer) {
    await this.ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.win.webContents.send('engine:cmd', { id, cmd, ...args, ...(transfer || {}) });
    });
  }
  dispose() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
module.exports = { LocalEngine };
