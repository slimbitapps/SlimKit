'use strict';
/**
 * „Taste halten zum Sprechen“ – braucht echte Taste-gedrückt/losgelassen-Ereignisse, die Electrons
 * Tastenkürzel nicht liefern. Dafür: uiohook-napi (systemweiter Tastatur-Hook).
 *
 *  Halten  → Diktat läuft, solange die Taste gedrückt ist (Push-to-talk)
 *  Tippen  → freihändig: Diktat läuft weiter, bis die Taste nochmal getippt wird
 *  Wird die Taste zusammen mit einer anderen Taste gedrückt (z. B. rechte Strg + C), passiert nichts.
 *
 * Die Logik (KeyHoldMachine) ist vom Hook getrennt, damit sie sich ohne Tastatur testen lässt.
 */

/** Tasten, die sich gut zum Halten eignen (Namen → uiohook-Keycodes) */
const HOLD_KEYS = {
  CtrlRight: 3613,
  AltRight: 3640,
  ShiftRight: 54,
  MetaRight: 3676,
  CapsLock: 58,
  F13: 91,
  F14: 92,
  F15: 93,
  F16: 99,
  F17: 100,
  F18: 101,
  F19: 102,
  F8: 66,
  F9: 67,
  F10: 68,
};

class KeyHoldMachine {
  /**
   * @param {{ onStart: (how: 'hold'|'tap') => void, onStop: () => void, onAbort: () => void, isRecording: () => boolean, holdMs?: number, now?: () => number, setTimer?: Function, clearTimer?: Function }} o
   */
  constructor(o) {
    this.o = o;
    this.holdMs = o.holdMs ?? 280;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? setTimeout;
    this.clearTimer = o.clearTimer ?? clearTimeout;
    this.key = 0;
    this.down = false;
    this.downAt = 0;
    this.started = false; // durch dieses Drücken gestartet
    this.handsFree = false;
    this.timer = null;
    this.other = false;
  }
  setKey(code) {
    this.key = code || 0;
    this.reset();
  }
  reset() {
    this.down = false;
    this.started = false;
    this.other = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
  keydown(code) {
    if (!this.key) return;
    if (code !== this.key) {
      if (this.down) this.other = true; // Tastenkombination, kein Diktat
      if (this.down && this.started && !this.handsFree && this.now() - this.downAt < this.holdMs + 150) {
        // gerade erst gestartet, war aber offenbar ein Tastenkürzel → abbrechen
        this.started = false;
        this.o.onAbort();
      }
      return;
    }
    if (this.down) return; // Tastenwiederholung
    this.down = true;
    this.other = false;
    this.downAt = this.now();
    if (this.o.isRecording()) {
      // läuft schon (freihändig) → dieses Drücken beendet beim Loslassen
      this.handsFreeStop = true;
      return;
    }
    this.handsFreeStop = false;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (!this.down || this.other) return;
      this.started = true;
      this.handsFree = false;
      this.o.onStart('hold');
    }, this.holdMs);
  }
  keyup(code) {
    if (!this.key || code !== this.key || !this.down) return;
    this.down = false;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.other) {
      this.other = false;
      return;
    }
    if (this.handsFreeStop) {
      this.handsFreeStop = false;
      this.handsFree = false;
      this.o.onStop();
      return;
    }
    if (this.started) {
      this.started = false;
      this.o.onStop(); // Push-to-talk: losgelassen
      return;
    }
    // kurz getippt → freihändig starten
    this.handsFree = true;
    this.o.onStart('tap');
  }
}

/** Startet den echten Hook; gibt null zurück, wenn er nicht verfügbar ist */
function startHook(machine, log) {
  try {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('keydown', (e) => machine.keydown(e.keycode));
    uIOhook.on('keyup', (e) => machine.keyup(e.keycode));
    uIOhook.start();
    return { stop: () => uIOhook.stop() };
  } catch (e) {
    log?.('keyhook', e);
    return null;
  }
}

module.exports = { KeyHoldMachine, HOLD_KEYS, startHook };
