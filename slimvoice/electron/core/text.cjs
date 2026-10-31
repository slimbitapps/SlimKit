'use strict';
/**
 * Textverarbeitung ohne KI: Sprachbefehle, Füllwörter, eigene Ersetzungen, typische
 * Erkennungs-„Halluzinationen“ bei Stille und das saubere Aneinanderhängen von Abschnitten.
 */

const COMMANDS = [
  // Reihenfolge: längere zuerst
  { re: /\s*[,.]?\s*\b(neuer absatz|neuen absatz|new paragraph)\b[.,!]?\s*/giu, out: '\n\n' },
  { re: /\s*[,.]?\s*\b(neue zeile|nächste zeile|new line|next line)\b[.,!]?\s*/giu, out: '\n' },
];

/** „neuer Absatz“, „neue Zeile“ → Zeilenumbrüche */
function applyVoiceCommands(text) {
  let out = text;
  for (const c of COMMANDS) out = out.replace(c.re, c.out);
  // nach einem Umbruch groß weiter
  return out.replace(/\n(\s*)(\p{Ll})/gu, (_m, s, ch) => '\n' + s.replace(/[ \t]/g, '') + ch.toUpperCase());
}

const FILLERS = {
  de: ['äh', 'ähm', 'öh', 'öhm', 'hm', 'hmm', 'ähh', 'ehm'],
  en: ['uh', 'um', 'uhm', 'umm', 'erm', 'hmm', 'uh-huh'],
};
/** lang: de | en | auto (bei auto bleibt „um“ stehen – im Deutschen ein normales Wort) */
function removeFillers(text, lang = 'auto') {
  const list = lang === 'de' ? FILLERS.de : lang === 'en' ? FILLERS.en : [...FILLERS.de, ...FILLERS.en.filter((w) => !w.startsWith('um'))];
  const words = list.join('|');
  const re = new RegExp(`(^|[\\s,])(?:${words})(?=[\\s,.!?…]|$)[,]?`, 'giu');
  let out = text;
  for (let i = 0; i < 3; i++) out = out.replace(re, '$1');
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,]+/, '')
    .replace(/,\s*([.!?])/g, '$1')
    .trimEnd();
}

/** Eigene Ersetzungen: [{ from: 'mfg', to: 'Mit freundlichen Grüßen' }] – ganze Wörter, ohne Groß/klein */
function applyReplacements(text, rules) {
  let out = text;
  for (const r of rules || []) {
    const from = String(r?.from || '').trim();
    if (!from) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), () => String(r.to ?? ''));
  }
  return out;
}

/**
 * Sätze, die Whisper & Co. gern bei Stille oder Rauschen „hören“ (aus Untertitel-Trainingsdaten).
 * Werden nur entfernt, wenn sie den ganzen Abschnitt ausmachen.
 */
const HALLUCINATIONS = [
  /^untertitel(ung)? (im auftrag )?(des|der|von) .*$/i,
  /^untertitel von .*$/i,
  /^(vielen )?dank (fürs|für's|für das) zu(schauen|sehen|hören)[.!]*$/i,
  /^bis zum nächsten mal[.!]*$/i,
  /^thanks? (you )?for watching[.!]*$/i,
  /^(please )?(like and )?subscribe[.!]*$/i,
  /^subtitles by .*$/i,
  /^amara\.org.*$/i,
  /^\.+$/,
  /^…+$/,
];
function isHallucination(text) {
  const t = text.trim();
  if (!t) return true;
  return HALLUCINATIONS.some((re) => re.test(t));
}

function tidy(text) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Alle lokalen Schritte in der richtigen Reihenfolge */
function localCleanup(text, opts = {}) {
  let out = tidy(text);
  if (isHallucination(out)) return '';
  if (opts.removeFillers) out = removeFillers(out, opts.lang);
  if (opts.voiceCommands) out = applyVoiceCommands(out);
  out = applyReplacements(out, opts.replacements);
  return tidy(out);
}

/**
 * Hängt einen neuen Abschnitt an bereits geschriebenen Text an:
 * Leerzeichen dazwischen, nach Satzende groß weiter.
 */
function joinSegment(prev, next) {
  let n = next;
  if (!n) return '';
  const p = prev || '';
  const atStart = p.trim() === '' || /[.!?…:]\s*$/.test(p) || /\n\s*$/.test(p);
  if (atStart) n = n.replace(/^(\s*)(\p{Ll})/u, (_m, s, ch) => s + ch.toUpperCase());
  const needsSpace = p !== '' && !/\s$/.test(p) && !/^[\s,.!?;:…)\]]/.test(n);
  return (needsSpace ? ' ' : '') + n;
}

module.exports = { applyVoiceCommands, removeFillers, applyReplacements, isHallucination, tidy, localCleanup, joinSegment };
