import { create } from 'zustand';
import type { AppInfo, HistoryItem, Launch, MenuStatus, Prefs, Settings, Lang } from './types';
import { setLang } from './i18n';
import type { ToolId } from './tools';

export type View = { kind: 'home' } | { kind: 'tool'; tool: ToolId; paths: string[]; key: number } | { kind: 'auto' } | { kind: 'history' };
type Dialog = { kind: 'settings'; tab?: string } | null;
export type Toast = { id: number; text: string; kind?: 'ok' | 'error'; undo?: string };

interface State {
  ready: boolean;
  settings: Settings;
  app: AppInfo;
  view: View;
  selection: string[];
  dialog: Dialog;
  showIntro: boolean;
  history: HistoryItem[];
  menu: MenuStatus | null;
  toasts: Toast[];
}

export const useStore = create<State>(() => ({
  ready: false,
  settings: null as unknown as Settings,
  app: null as unknown as AppInfo,
  view: { kind: 'home' },
  selection: [],
  dialog: null,
  showIntro: false,
  history: [],
  menu: null,
  toasts: [],
}));
const set = useStore.setState;
const get = useStore.getState;

/** Kurzform für Aufrufe in den Hauptprozess */
export const call = <T = any>(ch: string, ...args: unknown[]) => window.api.call<T>(ch, ...args);

function guessLang(locale: string): Lang {
  return (locale || navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function applyTheme(theme: Prefs['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  call('win:theme', theme);
}

let viewKey = 0;
export async function init() {
  const [settings, app, history, menu] = await Promise.all([call<Settings>('settings:get'), call<AppInfo>('app:info'), call<HistoryItem[]>('history:list'), call<MenuStatus>('menu:status')]);
  if (!settings.prefs.lang) settings.prefs.lang = guessLang(app.locale);
  setLang(settings.prefs.lang as Lang);
  applyTheme(settings.prefs.theme);
  document.documentElement.classList.add('platform-' + window.api.platform);
  set({ ready: true, settings, app, history, menu });
  window.api.on('launch', () => takeLaunch());
  window.api.on('settings', (s: Settings) => {
    const before = get().settings.prefs;
    if (s.prefs.lang && s.prefs.lang !== before.lang) setLang(s.prefs.lang as Lang);
    set({ settings: s });
    if (s.prefs.theme !== before.theme) applyTheme(s.prefs.theme);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(get().settings.prefs.theme));
  await takeLaunch();
}

/** Start über Rechtsklick: Werkzeug direkt öffnen (bzw. Auswahl auf der Startseite zeigen) */
export async function takeLaunch() {
  const list = await call<Launch[]>('launch:take');
  const l = list[list.length - 1];
  if (!l) return;
  if (!get().settings.onboarded) await updateSettings({ onboarded: true });
  set({ showIntro: false, dialog: null });
  if (l.action === 'open' || !l.action) {
    set({ selection: l.paths, view: { kind: 'home' } });
  } else openTool(l.action as ToolId, l.paths);
}

export function openTool(tool: ToolId, paths: string[] = get().selection) {
  set({ view: { kind: 'tool', tool, paths, key: ++viewKey } });
}
export function goHome() {
  set({ view: { kind: 'home' } });
  refreshHistory();
}
export function setView(view: View) {
  set({ view });
}
export function setSelection(selection: string[]) {
  set({ selection });
}

export async function updateSettings(partial: Record<string, unknown>) {
  const s = await call<Settings>('settings:set', partial);
  set({ settings: s });
  return s;
}
export async function updatePrefs(p: Partial<Prefs>) {
  const s = await updateSettings({ prefs: p });
  if (p.lang) setLang(p.lang as Lang);
  if (p.theme) applyTheme(s.prefs.theme);
  set({ settings: { ...s } });
}
export async function finishOnboarding() {
  await updateSettings({ onboarded: true, prefs: get().settings.prefs });
  set({ showIntro: false });
}
export function openDialog(d: Dialog) {
  set({ dialog: d });
}
export function closeDialog() {
  set({ dialog: null });
}
export function showIntroAgain() {
  set({ showIntro: true, dialog: null });
}
export async function refreshHistory() {
  set({ history: await call<HistoryItem[]>('history:list') });
}
export async function refreshMenu() {
  set({ menu: await call<MenuStatus>('menu:status') });
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'ok', undo?: string) {
  const id = ++toastId;
  set({ toasts: [...get().toasts, { id, text, kind, undo }] });
  setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), undo ? 8000 : 4000);
}
export function dismissToast(id: number) {
  set({ toasts: get().toasts.filter((x) => x.id !== id) });
}
