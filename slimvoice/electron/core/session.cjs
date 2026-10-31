'use strict';
/**
 * Ein Diktat von Start bis Ende. Bekommt Sprachabschnitte (zwischen zwei Sprechpausen) und entscheidet je nach Modus:
 *  live    – jeden Abschnitt sofort umwandeln, (optional) von der KI glätten und einfügen
 *  preview – Abschnitte schnell für die Vorschau umwandeln; am Ende alles in bester Qualität umwandeln und einmal einfügen
 *  batch   – nur aufnehmen; am Ende umwandeln und einfügen
 * Ohne Electron – alle Dienste kommen als Funktionen herein (so lässt es sich testen).
 */
const { encodeWav, concatPcm, groupChunks } = require('./wav.cjs');
const { localCleanup, joinSegment } = require('./text.cjs');
const { buildCorrection, sttPrompt, cleanModelOutput, plausible } = require('./prompts.cjs');

/** Passt ein App-Profil zur App im Vordergrund? */
function profileFor(profiles, appName) {
  const a = String(appName || '').toLowerCase();
  if (!a) return null;
  return (profiles || []).find((p) => p?.match && a.includes(String(p.match).toLowerCase().trim())) || null;
}

class DictationSession {
  /**
   * @param {object} o
   * @param {object} o.cfg       Einstellungen (dictation, ai)
   * @param {object} o.models    resolveModels(...)
   * @param {string} o.appName   App im Vordergrund beim Start
   * @param {{ transcribe(opts):Promise<string>, complete(opts):Promise<string>, insert(text):Promise<void>, emit(ev):void }} o.deps
   */
  constructor({ id, cfg, models, appName = '', deps }) {
    this.id = id;
    this.cfg = cfg;
    this.models = models;
    this.appName = appName;
    this.deps = deps;
    this.mode = cfg.dictation.mode;
    const profile = profileFor(cfg.ai.profiles, appName);
    this.ai = { ...cfg.ai, ...(profile ? pick(profile, ['level', 'style', 'translateTo', 'customInstruction']) : {}) };
    this.profile = profile;
    this.chunks = [];
    this.previews = new Map();
    this.pending = new Set();
    this.inserted = '';
    this.liveResults = new Map();
    this.nextInsert = 0;
    this.cancelled = false;
    this.failedPreview = false;
    this.warnings = new Set();
    this.startedAt = Date.now();
  }

  get language() {
    return this.cfg.dictation.language;
  }

  addSegment(idx, pcm) {
    if (this.cancelled) return;
    this.chunks[idx] = pcm;
    // „Erst aufnehmen“: nichts verschicken – außer lokal, da rechnen wir still schon mit (spart Wartezeit am Ende)
    if (this.mode === 'batch' && !this.models.pipeline) return;
    const job = this.mode === 'live' ? this.#live(idx, pcm) : this.#preview(idx, pcm);
    this.pending.add(job);
    job.finally(() => this.pending.delete(job));
  }

  cancel() {
    this.cancelled = true;
  }

  #warn(code) {
    if (this.warnings.has(code)) return;
    this.warnings.add(code);
    this.deps.emit({ type: 'warning', code });
  }

  async #stt(pcm, model, context) {
    return this.deps.transcribe({
      model,
      language: this.language,
      prompt: sttPrompt({ vocabulary: this.ai.vocabulary, context: this.ai.useContext ? context : '' }),
      wav: encodeWav(pcm),
    });
  }

  #clean(text) {
    return localCleanup(text, { lang: this.language, removeFillers: this.ai.removeFillers, voiceCommands: this.ai.voiceCommands, replacements: this.ai.replacements });
  }

  /** KI-Korrektur; bei Fehler oder unplausibler Antwort bleibt der Originaltext */
  async #correct(text, context) {
    if (!text || this.ai.level === 'off' || !this.models.llmModel) return text;
    const { system, user } = buildCorrection({
      text,
      level: this.ai.level,
      style: this.ai.style,
      vocabulary: this.ai.vocabulary,
      context: this.ai.useContext ? context : '',
      translateTo: this.ai.translateTo,
      customInstruction: this.ai.customInstruction,
    });
    try {
      const out = cleanModelOutput(await this.deps.complete({ system, user }));
      if (!plausible(text, out, this.ai.level, !!this.ai.translateTo)) {
        this.#warn('ai_implausible');
        return text;
      }
      // Sprachbefehle/Ersetzungen auch nach der KI noch einmal anwenden (falls sie „neue Zeile“ als Text stehen ließ)
      return this.#clean(out) || text;
    } catch (e) {
      this.#warn('ai_failed:' + (e.code || 'error'));
      return text;
    }
  }

  // ---------------------------------------------------------------- live
  async #live(idx, pcm) {
    let text = '';
    try {
      const raw = await this.#stt(pcm, this.models.sttMain, this.inserted);
      text = this.#clean(raw);
      text = await this.#correct(text, this.inserted);
    } catch (e) {
      this.deps.emit({ type: 'error', code: e.code || 'error', message: e.message });
    }
    this.liveResults.set(idx, text);
    await this.#flushLive();
  }

  async #flushLive() {
    while (this.liveResults.has(this.nextInsert)) {
      const text = this.liveResults.get(this.nextInsert);
      this.liveResults.delete(this.nextInsert);
      this.nextInsert++;
      if (!text || this.cancelled) continue;
      let piece = joinSegment(this.inserted, text);
      if (this.cfg.dictation.trailingSpace && !/\s$/.test(piece)) piece += ' ';
      this.inserted += piece;
      this.deps.emit({ type: 'preview', text: this.inserted.trim() });
      await this.deps.insert(piece);
    }
  }

  // ---------------------------------------------------------------- preview
  async #preview(idx, pcm) {
    try {
      const raw = await this.#stt(pcm, this.models.sttPreview, this.#previewText(idx));
      this.previews.set(idx, this.#clean(raw));
    } catch (e) {
      this.failedPreview = true;
      this.previews.set(idx, '');
      if (e.code === 'no_key' || e.code === 'auth') this.deps.emit({ type: 'error', code: e.code, message: e.message });
    }
    this.deps.emit({ type: 'preview', text: this.#previewText() });
  }

  #previewText(until = Infinity) {
    let out = '';
    for (let i = 0; i < Math.min(this.chunks.length, until); i++) {
      const t = this.previews.get(i);
      if (t) out += joinSegment(out, t);
    }
    return out;
  }

  // ---------------------------------------------------------------- Ende
  /** Aufnahme ist beendet: Rest erledigen. Gibt den eingefügten Text zurück. */
  async finish() {
    if (this.mode === 'live') {
      await Promise.allSettled([...this.pending]);
      return { text: this.inserted.trim(), raw: this.inserted.trim() };
    }
    const chunks = this.chunks.filter(Boolean);
    if (!chunks.length || this.cancelled) return { text: '', raw: '' };

    let raw = '';
    const canReuse = (this.mode === 'preview' || this.models.pipeline) && this.models.sttPreview === this.models.sttMain;
    if (canReuse) {
      await Promise.allSettled([...this.pending]);
      if (!this.failedPreview) raw = this.#previewText();
    }
    if (!raw) {
      try {
        for (const group of groupChunks(chunks, this.models.sttMaxSeconds || 600)) {
          if (this.cancelled) return { text: '', raw: '' };
          const part = await this.#stt(concatPcm(group), this.models.sttMain, raw);
          raw += joinSegment(raw, this.#clean(part));
        }
      } catch (e) {
        // Beste Qualität ging schief → Vorschau-Text nehmen, wenn es einen gibt
        await Promise.allSettled([...this.pending]);
        raw = this.#previewText();
        if (!raw) throw e;
        this.#warn('used_preview');
      }
    }
    if (this.cancelled) return { text: '', raw };
    let text = await this.#correct(raw, '');
    if (this.cancelled) return { text: '', raw };
    if (text && this.cfg.dictation.trailingSpace && !/\s$/.test(text)) text += ' ';
    if (text) await this.deps.insert(text);
    return { text: text.trim(), raw };
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== '' && obj[k] !== 'inherit') out[k] = obj[k];
  return out;
}

module.exports = { DictationSession, profileFor };
