'use strict';
/**
 * Einstellungen als JSON-Datei im Benutzerordner. Schreibt sicher (erst Temp-Datei, dann umbenennen).
 * API-Schlüssel liegen getrennt in secrets.json und werden – wenn das System es kann – verschlüsselt
 * (Windows: DPAPI, Mac: Schlüsselbund) über Electrons safeStorage.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  version: 1,
  onboarded: false,
  ui: { lang: '', theme: 'system' },
  hotkey: { toggle: 'CommandOrControl+Shift+Space', cancel: '' },
  dictation: {
    /** live = nach jeder Sprechpause einfügen · preview = Live-Vorschau, am Ende in bester Qualität einfügen · batch = erst aufnehmen, dann Text */
    mode: 'preview',
    /** fast | balanced | best – wählt Modelle und Pausenlänge */
    tempo: 'balanced',
    language: 'auto',
    /** 0 = automatisch nach Tempo */
    pauseMs: 0,
    sensitivity: 50,
    /** Rauschunterdrückung, Echo-Unterdrückung, automatische Lautstärke */
    audioProcessing: true,
    micId: '',
    maxMinutes: 15,
    sounds: true,
    overlay: 'bottom',
    /** paste = über die Zwischenablage (schnell, alle Zeichen) · type = Tastendrücke simulieren · copy = nur kopieren */
    insert: 'paste',
    restoreClipboard: true,
    trailingSpace: true,
  },
  ai: {
    /** off | punct | light | strong */
    level: 'light',
    style: 'neutral',
    removeFillers: true,
    voiceCommands: true,
    translateTo: '',
    customInstruction: '',
    vocabulary: [],
    replacements: [],
    profiles: [],
    useContext: true,
  },
  services: {
    stt: { provider: 'openai', model: '', fastModel: '', baseUrl: '' },
    llm: { provider: 'same', model: '', baseUrl: '' },
  },
  history: { keep: true, max: 200 },
  autostart: false,
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
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = merge(DEFAULTS, readJson(file));
  }
  save() {
    try {
      writeJson(this.file, this.data);
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

/**
 * API-Schlüssel je Dienst (openai, groq, gemini, anthropic, custom).
 * crypto = { available(): bool, encrypt(str): Buffer, decrypt(Buffer): str } – im Test einfach Klartext.
 */
class SecretStore {
  constructor(file, crypto) {
    this.file = file;
    this.crypto = crypto;
    this.raw = readJson(file) || {};
  }
  get(name) {
    const e = this.raw[name];
    if (!e) return '';
    try {
      if (e.enc) return this.crypto.decrypt(Buffer.from(e.value, 'base64'));
      return Buffer.from(e.value, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  set(name, value) {
    const v = String(value || '').trim();
    if (!v) delete this.raw[name];
    else if (this.crypto.available()) this.raw[name] = { enc: true, value: this.crypto.encrypt(v).toString('base64') };
    else this.raw[name] = { enc: false, value: Buffer.from(v, 'utf8').toString('base64') };
    try {
      writeJson(this.file, this.raw);
    } catch {
      /* egal */
    }
  }
  /** Nur ob ein Schlüssel da ist und die letzten 4 Zeichen – nie den Schlüssel selbst an die Oberfläche geben */
  summary() {
    const out = {};
    for (const name of Object.keys(this.raw)) {
      const v = this.get(name);
      if (v) out[name] = { set: true, hint: v.length > 8 ? '…' + v.slice(-4) : '' };
    }
    return { keys: out, encrypted: this.crypto.available() };
  }
}

module.exports = { SettingsStore, SecretStore, DEFAULTS, merge };
