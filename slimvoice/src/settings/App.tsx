import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppCtx, type Ctx } from './ui';
import { makeT, type Key } from './i18n';
import type { DeepPartial, Settings, Snapshot } from './types';
import { Ai, Dictation, General, History, Services, Welcome, Words } from './pages';
import logo from '../assets/logo.png';

const PAGES: { id: string; icon: string; C: () => React.JSX.Element }[] = [
  { id: 'welcome', icon: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z', C: Welcome },
  { id: 'dictation', icon: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z', C: Dictation },
  { id: 'words', icon: 'M4 5h16v2H4zm0 6h10v2H4zm0 6h16v2H4zm14-7l3 3-3 3z', C: Words },
  { id: 'ai', icon: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z', C: Ai },
  { id: 'services', icon: 'M7 14a3 3 0 1 1 2.8-4H21v3h-2v2h-3v-2H9.8A3 3 0 0 1 7 14z', C: Services },
  { id: 'history', icon: 'M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-2.05-4.95L15 10h7V3l-2.64 2.64A8.96 8.96 0 0 0 13 3zm-1 5v5l4 2.5.9-1.5-3.4-2V8z', C: History },
  { id: 'general', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.7 5.2l1.8 1.4-2 3.4-2.1-.8a7.6 7.6 0 0 1-2 1.2L16 21h-4l-.4-2.2a7.6 7.6 0 0 1-2-1.2l-2.1.8-2-3.4 1.8-1.4a7.8 7.8 0 0 1 0-2.4L5.5 9.8l2-3.4 2.1.8a7.6 7.6 0 0 1 2-1.2L12 3h4l.4 2.2a7.6 7.6 0 0 1 2 1.2l2.1-.8 2 3.4-1.8 1.4a7.8 7.8 0 0 1 0 2.4z', C: General },
];

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [page, setPage] = useState(() => new URLSearchParams(location.search).get('page') || 'welcome');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const [systemDark, setSystemDark] = useState(media.matches);

  const refresh = useCallback(async () => {
    const s = await window.api.call<Snapshot>('app:snapshot');
    setSnap(s);
  }, []);

  useEffect(() => {
    refresh();
    const offs = [
      window.api.on('nav', (p: string) => setPage(p)),
      window.api.on('settings:changed', () => refresh()),
      // Mac-Freigabe wird jede Sekunde geprüft – Änderung sofort anzeigen
      window.api.on('perm:changed', () => refresh()),
    ];
    const onTheme = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onTheme);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      offs.forEach((o) => o());
      window.removeEventListener('focus', onFocus);
      media.removeEventListener('change', onTheme);
    };
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback(async (p: DeepPartial<Settings>) => {
    // sofort anzeigen, dann speichern
    setSnap((prev) => (prev ? { ...prev, settings: mergeDeep(prev.settings, p) } : prev));
    const s = await window.api.call<Snapshot>('settings:set', p);
    setSnap(s);
  }, []);

  const theme = snap?.settings.ui.theme === 'system' || !snap ? (systemDark ? 'dark' : 'light') : snap.settings.ui.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const lang = snap ? (snap.settings.ui.lang || snap.lang) : 'en';
  const ctx = useMemo<Ctx | null>(() => {
    if (!snap) return null;
    const l = lang === 'de' ? 'de' : 'en';
    document.documentElement.lang = l;
    return { snap, s: snap.settings, set, t: makeT(l), lang: l, refresh, nav: setPage };
  }, [snap, lang, set, refresh]);

  if (!ctx) return <div className="loading" />;
  const { t } = ctx;
  const Current = (PAGES.find((p) => p.id === page) || PAGES[0]).C;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="layout">
        <nav className="sidebar" aria-label="SlimVoice">
          <div className="brand">
            <img className="logo-img" src={logo} alt="" width={30} height={30} />
            SlimVoice
          </div>
          {PAGES.map((p) => (
            <button key={p.id} className={'nav-item' + (page === p.id ? ' on' : '')} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={p.icon} />
              </svg>
              {t(`nav.${p.id}` as Key)}
            </button>
          ))}
          <div className="sidebar-foot">
            <div className="segmented mode-switch" role="radiogroup" aria-label={lang === 'de' ? 'Ansicht' : 'View'}>
              {(['simple', 'expert'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={ctx.s.ui.mode === m} className={ctx.s.ui.mode === m ? 'on' : ''} onClick={() => set({ ui: { mode: m } })}>
                  {m === 'simple' ? (lang === 'de' ? 'Einfach' : 'Simple') : lang === 'de' ? 'Experte' : 'Expert'}
                </button>
              ))}
            </div>
            <button className="slimbit" onClick={() => window.api.call('shell:openExternal', snap!.website)}>
              SlimBit Apps
            </button>
          </div>
        </nav>
        <main className="content">
          <h1 className="page-title">{t(`nav.${page}` as Key)}</h1>
          <Current />
        </main>
      </div>
    </AppCtx.Provider>
  );
}

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
function mergeDeep<T>(base: T, over: unknown): T {
  if (!isObj(over) || !isObj(base)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k], v) : v;
  return out as T;
}
