import type { Lang } from './types';
import { de } from './locales/de';
import { en } from './locales/en';

/** Alle Texte liegen in src/locales. Deutsch ist die Quelle aller Schlüssel. */
export type TKey = keyof typeof de;
export type Dict = Record<TKey, string>;

const dicts: Record<Lang, Dict> = { de, en };

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
];

const locales: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };

let current: Lang = 'de';
export function setLang(l: Lang) {
  current = dicts[l] ? l : 'en';
  document.documentElement.lang = current;
}
export function getLang() {
  return current;
}
export function getLocale() {
  return locales[current];
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  let s: string = dicts[current][key] ?? de[key] ?? key;
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

/** Größe lesbar: 1,4 MB */
export function fmtSize(n: number) {
  if (!Number.isFinite(n)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString(getLocale(), { maximumFractionDigits: i === 0 ? 0 : n < 10 ? 1 : 0 })} ${u[i]}`;
}
export function fmtDate(ms: number, time = true) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString(getLocale(), time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}
export function fmtNum(n: number) {
  return n.toLocaleString(getLocale());
}
