/**
 * Anleitungen: So bekommt man den API-Schlüssel beim jeweiligen Anbieter.
 * Stand Herbst 2026 – die Seiten der Anbieter ändern sich gelegentlich, die Schritte bleiben aber ähnlich.
 */
import type { Lang } from './i18n';

export interface Guide {
  name: string;
  /** kurze Einordnung für die Auswahlkarte */
  pitch: string;
  badges: string[];
  cost: string;
  url: string;
  steps: string[];
  privacy?: string;
  keyHint: string;
  /** bietet Spracherkennung / KI-Korrektur an */
  stt: boolean;
  llm: boolean;
}

const de: Record<string, Guide> = {
  groq: {
    name: 'Groq',
    pitch: 'Kostenlos starten, ohne Kreditkarte. Extrem schnell.',
    badges: ['Kostenlos testen', 'Sehr schnell'],
    cost: 'Kostenloser Tarif mit Tageslimit – für normales Diktieren reicht das meist. Danach ca. 0,04 $ pro Stunde Audio.',
    url: 'https://console.groq.com/keys',
    steps: [
      'Klicke auf „Seite öffnen“ – die Groq-Konsole öffnet sich im Browser.',
      'Melde dich an: mit Google, GitHub oder deiner E-Mail-Adresse (du bekommst einen Anmeldelink). Eine Kreditkarte ist nicht nötig.',
      'Du landest bei „API Keys“. Klicke auf „Create API Key“.',
      'Gib als Namen „SlimVoice“ ein und bestätige mit „Submit“.',
      'Der Schlüssel (beginnt mit „gsk_“) wird angezeigt. Klicke auf „Copy“ – er wird nur dieses eine Mal angezeigt.',
      'Füge ihn unten ein (Strg+V bzw. ⌘V). SlimVoice prüft ihn sofort.',
    ],
    keyHint: 'gsk_…',
    stt: true,
    llm: true,
  },
  openai: {
    name: 'OpenAI',
    pitch: 'Sehr genaue Erkennung, auch bei Dialekt und Fachbegriffen.',
    badges: ['Beste Genauigkeit'],
    cost: 'Guthaben vorab aufladen (mindestens 5 $). Etwa 0,18–0,36 $ pro Stunde Diktat – 5 $ reichen für viele Wochen.',
    url: 'https://platform.openai.com/api-keys',
    steps: [
      'Klicke auf „Seite öffnen“ und melde dich an oder erstelle ein Konto (auch mit Google, Microsoft oder Apple möglich).',
      'Wichtig: Ohne Guthaben funktioniert der Schlüssel nicht. Öffne links „Billing“ (bzw. „Abrechnung“) → „Add payment details“ und lade mindestens 5 $ auf.',
      'Gehe zu „API keys“ und klicke auf „Create new secret key“.',
      'Name: „SlimVoice“. Projekt und Berechtigungen kannst du so lassen. Klicke auf „Create secret key“.',
      'Klicke auf „Copy“ – der Schlüssel (beginnt mit „sk-“) wird nur dieses eine Mal angezeigt.',
      'Füge ihn unten ein. SlimVoice prüft ihn sofort.',
    ],
    keyHint: 'sk-…',
    stt: true,
    llm: true,
  },
  gemini: {
    name: 'Google Gemini',
    pitch: 'Mit deinem Google-Konto, kostenloses Kontingent.',
    badges: ['Kostenlos testen', 'Google-Konto'],
    cost: 'Kostenloser Tarif mit Limits. Im bezahlten Tarif sehr günstig.',
    url: 'https://aistudio.google.com/apikey',
    steps: [
      'Klicke auf „Seite öffnen“ – Google AI Studio öffnet sich.',
      'Melde dich mit deinem Google-Konto an und bestätige beim ersten Mal die Nutzungsbedingungen.',
      'Klicke auf „API-Schlüssel erstellen“ (bzw. „Create API key“). Wenn gefragt, wähle ein Projekt oder lass eines neu anlegen.',
      'Kopiere den Schlüssel (beginnt mit „AIza“).',
      'Füge ihn unten ein. SlimVoice prüft ihn sofort.',
    ],
    privacy: 'Hinweis: Im kostenlosen Tarif darf Google Eingaben zur Verbesserung seiner Produkte verwenden. Für vertrauliche Diktate lieber den bezahlten Tarif oder die lokale Erkennung nutzen.',
    keyHint: 'AIza…',
    stt: true,
    llm: true,
  },
  anthropic: {
    name: 'Anthropic Claude',
    pitch: 'Sehr gute Textkorrektur und Umformulierung (keine Spracherkennung).',
    badges: ['Nur KI-Korrektur'],
    cost: 'Guthaben vorab aufladen (mindestens 5 $). Pro Diktat meist deutlich unter einem Cent.',
    url: 'https://platform.claude.com/settings/keys',
    steps: [
      'Klicke auf „Seite öffnen“ und melde dich an oder erstelle ein Konto.',
      'Lade unter „Billing“ Guthaben auf (mindestens 5 $) – ohne Guthaben funktioniert der Schlüssel nicht.',
      'Öffne „API Keys“ und klicke auf „Create Key“. Name: „SlimVoice“.',
      'Kopiere den Schlüssel (beginnt mit „sk-ant-“) – er wird nur einmal angezeigt.',
      'Füge ihn unten ein. SlimVoice prüft ihn sofort.',
    ],
    keyHint: 'sk-ant-…',
    stt: false,
    llm: true,
  },
};

const en: Record<string, Guide> = {
  groq: {
    ...de.groq,
    pitch: 'Start for free, no credit card. Extremely fast.',
    badges: ['Free to try', 'Very fast'],
    cost: 'Free tier with a daily limit – usually enough for normal dictation. After that about $0.04 per hour of audio.',
    steps: [
      'Click “Open page” – the Groq console opens in your browser.',
      'Sign in with Google, GitHub or your email address (you get a sign-in link). No credit card needed.',
      'You land on “API Keys”. Click “Create API Key”.',
      'Enter “SlimVoice” as the name and confirm with “Submit”.',
      'The key (starts with “gsk_”) is shown. Click “Copy” – it is only shown this once.',
      'Paste it below (Ctrl+V or ⌘V). SlimVoice checks it right away.',
    ],
  },
  openai: {
    ...de.openai,
    pitch: 'Very accurate, even with accents and technical terms.',
    badges: ['Best accuracy'],
    cost: 'Prepaid credit (at least $5). About $0.18–0.36 per hour of dictation – $5 lasts for many weeks.',
    steps: [
      'Click “Open page” and sign in or create an account (Google, Microsoft or Apple work too).',
      'Important: the key does not work without credit. Open “Billing” → “Add payment details” and add at least $5.',
      'Go to “API keys” and click “Create new secret key”.',
      'Name: “SlimVoice”. Leave project and permissions as they are. Click “Create secret key”.',
      'Click “Copy” – the key (starts with “sk-”) is only shown this once.',
      'Paste it below. SlimVoice checks it right away.',
    ],
  },
  gemini: {
    ...de.gemini,
    pitch: 'With your Google account, free quota.',
    badges: ['Free to try', 'Google account'],
    cost: 'Free tier with limits. Very cheap on the paid tier.',
    steps: [
      'Click “Open page” – Google AI Studio opens.',
      'Sign in with your Google account and accept the terms the first time.',
      'Click “Create API key”. If asked, pick a project or let it create a new one.',
      'Copy the key (starts with “AIza”).',
      'Paste it below. SlimVoice checks it right away.',
    ],
    privacy: 'Note: on the free tier Google may use inputs to improve its products. For confidential dictation use the paid tier or local recognition.',
  },
  anthropic: {
    ...de.anthropic,
    pitch: 'Excellent text correction and rewriting (no speech recognition).',
    badges: ['AI correction only'],
    cost: 'Prepaid credit (at least $5). Usually well under a cent per dictation.',
    steps: [
      'Click “Open page” and sign in or create an account.',
      'Add credit under “Billing” (at least $5) – the key does not work without credit.',
      'Open “API Keys” and click “Create Key”. Name: “SlimVoice”.',
      'Copy the key (starts with “sk-ant-”) – it is only shown once.',
      'Paste it below. SlimVoice checks it right away.',
    ],
  },
};

export const GUIDES: Record<Lang, Record<string, Guide>> = { de, en };
export const STT_PROVIDERS = ['groq', 'openai', 'gemini'];
export const LLM_PROVIDERS = ['groq', 'openai', 'gemini', 'anthropic'];

/** Lokale Modelle: Texte für die Auswahl */
export const LOCAL_TEXT: Record<Lang, Record<string, { name: string; desc: string }>> = {
  de: {
    base: { name: 'Klein', desc: 'Schnell, auch auf älteren Rechnern. Für kurze, deutliche Diktate.' },
    small: { name: 'Mittel', desc: 'Guter Kompromiss aus Genauigkeit und Tempo. Für die meisten Rechner.' },
    turbo: { name: 'Groß', desc: 'Höchste Genauigkeit, aber deutlich langsamer und braucht viel Arbeitsspeicher. Nur für starke Rechner.' },
  },
  en: {
    base: { name: 'Small', desc: 'Fast, even on older computers. For short, clear dictation.' },
    small: { name: 'Medium', desc: 'Good balance of accuracy and speed. For most computers.' },
    turbo: { name: 'Large', desc: 'Highest accuracy, but much slower and needs a lot of memory. Only for powerful computers.' },
  },
};

/** „Mittel“ ist für fast alle Rechner der beste Kompromiss; nur sehr schwache Rechner bekommen „Klein“. */
export function recommendLocal(cores: number, appleSilicon: boolean) {
  if (appleSilicon || cores >= 4) return 'small';
  return 'base';
}
