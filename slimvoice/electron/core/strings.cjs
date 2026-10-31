'use strict';
/** Texte des Hauptprozesses (Menü im Infobereich / in der Menüleiste) */
const STRINGS = {
  de: {
    start: 'Diktat starten',
    stop: 'Diktat beenden',
    cancel: 'Diktat abbrechen',
    mode: 'Modus',
    'mode.live': 'Sofort einfügen (nach jeder Pause)',
    'mode.preview': 'Live-Vorschau, am Ende einfügen',
    'mode.batch': 'Erst aufnehmen, dann Text',
    tempo: 'Tempo',
    'tempo.fast': 'Schnell',
    'tempo.balanced': 'Ausgewogen',
    'tempo.best': 'Beste Qualität',
    ai: 'KI-Korrektur',
    'ai.off': 'Aus',
    'ai.punct': 'Nur Satzzeichen',
    'ai.light': 'Leicht (Fehler & falsche Wörter)',
    'ai.strong': 'Stark (sauber umformulieren)',
    lastCopy: 'Letztes Diktat kopieren',
    settings: 'Einstellungen …',
    history: 'Verlauf …',
    quit: 'SlimVoice beenden',
    tooltip: 'SlimVoice – Diktieren mit {key}',
  },
  en: {
    start: 'Start dictation',
    stop: 'Stop dictation',
    cancel: 'Cancel dictation',
    mode: 'Mode',
    'mode.live': 'Insert right away (after each pause)',
    'mode.preview': 'Live preview, insert at the end',
    'mode.batch': 'Record first, then text',
    tempo: 'Speed',
    'tempo.fast': 'Fast',
    'tempo.balanced': 'Balanced',
    'tempo.best': 'Best quality',
    ai: 'AI correction',
    'ai.off': 'Off',
    'ai.punct': 'Punctuation only',
    'ai.light': 'Light (errors & wrong words)',
    'ai.strong': 'Strong (rewrite cleanly)',
    lastCopy: 'Copy last dictation',
    settings: 'Settings …',
    history: 'History …',
    quit: 'Quit SlimVoice',
    tooltip: 'SlimVoice – dictate with {key}',
  },
};

function makeT(getLang) {
  return (key, vars = {}) => {
    const lang = getLang() === 'de' ? 'de' : 'en';
    let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
}

/** Tastenkürzel lesbar machen: CommandOrControl+Shift+Space → ⌘⇧Space / Strg+Umschalt+Leertaste */
function prettyAccel(accel, platform, lang) {
  if (!accel) return '';
  const de = lang === 'de';
  const mac = platform === 'darwin';
  const map = {
    CommandOrControl: mac ? '⌘' : de ? 'Strg' : 'Ctrl',
    CmdOrCtrl: mac ? '⌘' : de ? 'Strg' : 'Ctrl',
    Command: '⌘',
    Cmd: '⌘',
    Control: mac ? '⌃' : de ? 'Strg' : 'Ctrl',
    Ctrl: mac ? '⌃' : de ? 'Strg' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Option: '⌥',
    Shift: mac ? '⇧' : de ? 'Umschalt' : 'Shift',
    Super: mac ? '⌘' : 'Win',
    Space: de ? 'Leertaste' : 'Space',
  };
  const parts = accel.split('+').map((p) => map[p] || p);
  return mac ? parts.join('') : parts.join('+');
}

module.exports = { makeT, prettyAccel };
