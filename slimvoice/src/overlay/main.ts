import '../api';
import './overlay.css';
import { beep } from './beep';

type Lang = 'de' | 'en';
const TEXT: Record<Lang, Record<string, string>> = {
  de: {
    listening: 'Hört zu …',
    speaking: 'Hört zu …',
    processing: 'Wird umgewandelt …',
    done: 'Eingefügt',
    copied: 'Kopiert',
    empty: 'Nichts verstanden',
    stop: 'Fertig',
    cancel: 'Abbrechen',
    settings: 'Einstellungen',
    hint: '{key} zum Beenden · du kannst weitertippen',
    'hint.hold': 'Halten und sprechen – loslassen = fertig · kurz tippen = freihändig',
    'hint.tap': '{hold} nochmal tippen zum Beenden · du kannst weitertippen',
    'cmd.selection': 'Befehl für die Markierung',
    'cmd.write': 'Befehl: neuen Text schreiben',
    'cmd.hint': 'z. B. „mach das förmlicher“ · {key} zum Beenden',
    'cmd.pending': 'Befehl …',
    'handsfree': 'Freihändig – {key} nochmal drücken zum Beenden · du kannst weitertippen',
    'hint.button': 'Fertig klicken oder {key} drücken · du kannst weitertippen',
    'err.mic': 'Kein Zugriff aufs Mikrofon. Mac: Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon → SlimVoice einschalten.',
    'err.no_llm': 'Der Befehlsmodus braucht einen KI-Dienst.',
    'err.no_key': 'Kein API-Schlüssel für {provider} eingetragen.',
    'err.local_missing': 'Das Sprachmodell ist noch nicht heruntergeladen.',
    'err.local': 'Die lokale Spracherkennung hatte ein Problem.',
    'err.local_slow': 'Das dauert auf diesem Rechner zu lange – bitte unter „Spracherkennung“ ein kleineres Modell wählen.',
    'err.apple_permission': 'Bitte erlaube SlimVoice die Spracherkennung (Einstellungen → Spracherkennung).',
    'err.apple_offline_missing': 'Für diese Sprache fehlt Apples Erkennung auf dem Mac. Einstellungen → Spracherkennung → „Sprache laden“.',
    'err.apple_timeout': 'Apples Spracherkennung hat nicht geantwortet. Bitte nochmal versuchen.',
    'setup': 'Einrichten',
    'warn.ai_no_key': 'KI-Korrektur übersprungen – kein Dienst eingerichtet.',
    'err.auth': 'Der Dienst lehnt den API-Schlüssel ab.',
    'err.quota': 'Limit oder Guthaben beim Dienst erreicht.',
    'err.network': 'Keine Verbindung zum Dienst.',
    'err.timeout': 'Der Dienst antwortet nicht.',
    'err.bad_request': 'Anfrage abgelehnt – stimmt der Modellname?',
    'err.server': 'Fehler beim Dienst – bitte gleich nochmal.',
    'err.error': 'Etwas ist schiefgelaufen.',
    'warn.used_preview': 'Beste Qualität ging nicht – Vorschau-Text eingefügt.',
    'warn.ai_failed': 'KI-Korrektur nicht erreichbar – Originaltext eingefügt.',
    'warn.ai_implausible': 'KI-Ergebnis verworfen – Originaltext eingefügt.',
    'warn.insert_failed': 'Einfügen ging nicht – der Text liegt in der Zwischenablage.',
    'warn.mac_accessibility': 'Bedienungshilfen nicht freigegeben – Text wird nur kopiert.',
  },
  en: {
    listening: 'Listening …',
    speaking: 'Listening …',
    processing: 'Transcribing …',
    done: 'Inserted',
    copied: 'Copied',
    empty: 'Nothing recognised',
    stop: 'Done',
    cancel: 'Cancel',
    settings: 'Settings',
    hint: '{key} to finish · you can keep typing',
    'hint.hold': 'Hold and speak – release = done · quick tap = hands-free',
    'hint.tap': 'tap {hold} again to finish · you can keep typing',
    'cmd.selection': 'Command for the selection',
    'cmd.write': 'Command: write new text',
    'cmd.hint': 'e.g. “make this more formal” · {key} to finish',
    'cmd.pending': 'Command …',
    'handsfree': 'Hands-free – press {key} again to finish · you can keep typing',
    'hint.button': 'Click Done or press {key} · you can keep typing',
    'err.mic': 'No microphone access. Mac: System Settings → Privacy & Security → Microphone → turn on SlimVoice.',
    'err.no_llm': 'Command mode needs an AI service.',
    'err.no_key': 'No API key set for {provider}.',
    'err.local_missing': 'The speech model has not been downloaded yet.',
    'err.local': 'Local speech recognition ran into a problem.',
    'err.local_slow': 'This takes too long on this computer – please choose a smaller model under “Speech recognition”.',
    'err.apple_permission': 'Please allow SlimVoice to use speech recognition (Settings → Speech recognition).',
    'err.apple_offline_missing': 'Apple’s on-device recognition is missing for this language. Settings → Speech recognition → “Download language”.',
    'err.apple_timeout': 'Apple speech recognition did not respond. Please try again.',
    'setup': 'Set up',
    'warn.ai_no_key': 'AI correction skipped – no service set up.',
    'err.auth': 'The service rejected the API key.',
    'err.quota': 'Rate limit or credit used up at the service.',
    'err.network': 'Cannot reach the service.',
    'err.timeout': 'The service does not respond.',
    'err.bad_request': 'Request rejected – is the model name right?',
    'err.server': 'Service error – please try again.',
    'err.error': 'Something went wrong.',
    'warn.used_preview': 'Best quality failed – inserted the preview text.',
    'warn.ai_failed': 'AI correction unavailable – inserted the original text.',
    'warn.ai_implausible': 'AI result discarded – inserted the original text.',
    'warn.insert_failed': 'Could not insert – the text is on the clipboard.',
    'warn.mac_accessibility': 'Accessibility not allowed – text is only copied.',
  },
};
const PROVIDERS: Record<string, string> = { openai: 'OpenAI', groq: 'Groq', gemini: 'Gemini', anthropic: 'Claude', custom: 'Custom' };

let lang: Lang = navigator.language.startsWith('de') ? 'de' : 'en';
const t = (k: string, vars: Record<string, string> = {}) => {
  let s = TEXT[lang][k] ?? TEXT.en[k] ?? k;
  for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
  return s;
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const root = $('#pill');
const status = $('#status');
const timer = $('#timer');
const preview = $('#preview');
const note = $('#note');
const bars = [...document.querySelectorAll<HTMLElement>('.bars i')];
const btnStop = $<HTMLButtonElement>('#stop');
const btnCancel = $<HTMLButtonElement>('#cancel');
const btnSettings = $<HTMLButtonElement>('#settings');

let current = 0;
let sounds = true;
let hotkey = '';
let mode = 'preview';
let startedAt = 0;
let tick: number | undefined;

function setState(state: string, text?: string) {
  root.dataset.state = state;
  status.textContent = text ?? t(state);
  btnStop.hidden = state !== 'listening';
  btnCancel.hidden = state === 'done';
  btnSettings.hidden = state !== 'error';
  if (state !== 'listening') clearInterval(tick);
}
/** Sicherer Text normal, noch unsichere Wörter blass dahinter (werden gleich bestätigt oder korrigiert) */
function setPreview(text: string, tentative = '') {
  preview.textContent = text;
  if (tentative) {
    const span = document.createElement('span');
    span.className = 'tentative';
    span.textContent = (text ? ' ' : '') + tentative;
    preview.appendChild(span);
  }
  preview.hidden = !text && !tentative;
  preview.scrollTop = preview.scrollHeight;
}
function setNote(text: string) {
  note.textContent = text;
  note.hidden = !text;
}
function applyLabels() {
  btnStop.textContent = t('stop');
  btnCancel.title = t('cancel');
  btnCancel.setAttribute('aria-label', t('cancel'));
  btnSettings.textContent = t('settings');
}
function pretty(accel: string) {
  const mac = window.api.platform === 'darwin';
  const de = lang === 'de';
  const names: Record<string, string> = { Control: mac ? '⌃' : de ? 'Strg' : 'Ctrl', CommandOrControl: mac ? '⌘' : de ? 'Strg' : 'Ctrl', Command: '⌘', Super: mac ? '⌘' : 'Win', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : de ? 'Umschalt' : 'Shift', Space: de ? 'Leertaste' : 'Space' };
  const parts = accel.split('+').map((p) => names[p] || p);
  return mac ? parts.join('') : parts.join('+');
}

btnStop.onclick = () => window.api.call('overlay:action', 'stop');
btnCancel.onclick = () => window.api.call('overlay:action', root.dataset.state === 'listening' || root.dataset.state === 'processing' ? 'cancel' : 'close');
btnSettings.onclick = () => window.api.call('overlay:action', 'settings');

window.api.on('rec:start', (o: any) => {
  current = o.id;
  lang = o.lang === 'de' ? 'de' : 'en';
  sounds = o.sounds;
  hotkey = pretty(o.hotkey || '');
  mode = o.mode;
  document.body.classList.toggle('top', o.position === 'top');
  applyLabels();
  setPreview('');
  root.classList.toggle('command', !!o.command);
  if (o.command) {
    setNote(t('cmd.hint', { key: hotkey }));
    setState('listening', t('cmd.pending'));
  } else {
    setNote(o.how === 'hold' ? t('hint.hold') : o.how === 'button' ? t('hint.button', { key: hotkey }) : t('hint', { key: hotkey }));
    setState('listening');
  }
  startedAt = Date.now();
  timer.textContent = '0:00';
  clearInterval(tick);
  tick = window.setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  if (sounds) beep('start');
});

window.api.on('rec:level', (o: { level: number; speaking: boolean }) => {
  root.classList.toggle('speaking', o.speaking);
  bars.forEach((b, i) => {
    const shape = [0.55, 0.8, 1, 0.8, 0.55][i];
    b.style.transform = `scaleY(${Math.max(0.12, Math.min(1, o.level * shape * 1.4))})`;
  });
});

window.api.on('rec:stop', (o: any) => {
  if (o.id !== current) return;
  if (sounds) beep('stop');
  setNote('');
});

window.api.on('rec:cancel', () => setPreview(''));

window.api.on('ui:hidden', () => {
  setPreview('');
  setNote('');
});

window.api.on('ui:event', (ev: any) => {
  if (ev.id !== undefined && ev.id < current) return;
  if (ev.id !== undefined) current = ev.id;
  switch (ev.type) {
    case 'preview':
      if (mode !== 'batch') setPreview(ev.text, ev.tentative || '');
      break;
    case 'command':
      setState('listening', t('cmd.' + ev.command));
      break;
    case 'handsfree':
      setNote(t('handsfree', { key: hotkey }));
      break;
    case 'state':
      if (ev.state === 'done') {
        setState('done');
        setPreview(ev.text);
      } else setState(ev.state);
      break;
    case 'warning': {
      const code = String(ev.code).split(':')[0];
      setNote(t('warn.' + code));
      break;
    }
    case 'error': {
      if (sounds) beep('error');
      const key = TEXT.en['err.' + ev.code] ? 'err.' + ev.code : 'err.error';
      setState('error', t(key, { provider: PROVIDERS[ev.provider] || ev.provider || '' }));
      btnSettings.textContent = ['no_key', 'local_missing', 'no_llm', 'local_slow', 'apple_permission', 'apple_offline_missing'].includes(ev.code) ? t('setup') : t('settings');
      setNote(ev.message && !['no_key', 'local_missing', 'no_llm', 'mic', 'local_slow', 'apple_permission', 'apple_offline_missing', 'apple_timeout'].includes(ev.code) ? String(ev.message).slice(0, 160) : '');
      break;
    }
  }
});

applyLabels();
setState('listening');
