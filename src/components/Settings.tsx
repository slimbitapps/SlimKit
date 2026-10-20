import { useEffect, useState, type ReactNode } from 'react';
import { t, LANGS, type TKey } from '../i18n';
import { useStore, updateSettings, updatePrefs, closeDialog, showIntroAgain, call, refreshMenu, toast } from '../store';
import type { Lang, Prefs } from '../types';
import { Group, Logo, Row, Seg } from './ui';
import { IconClose, IconSettings, IconMouse, IconSend, IconHelp, IconInfo, IconLock, IconCheck } from '../icons';
import slimbitMark from '../assets/slimbit-mark.png';

const WEBSITE_URL = 'https://slimbitapps.github.io/';
const APP_URL = 'https://slimbitapps.github.io/SlimKit/';
const EMAIL = 'SlimBitApps@gmail.com';
type Tab = 'general' | 'menu' | 'transfer' | 'help' | 'about';

export function SettingsDialog({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((initial as Tab) || 'general');
  const nav: [Tab, string, ReactNode][] = [
    ['general', t('settings.general'), <IconSettings size={17} key="g" />],
    ['menu', t('settings.menu'), <IconMouse size={17} key="m" />],
    ['transfer', t('settings.transfer'), <IconSend size={17} key="t" />],
    ['help', t('settings.help'), <IconHelp size={17} key="h" />],
    ['about', t('settings.about'), <IconInfo size={17} key="a" />],
  ];
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeDialog();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="dialog xwide" role="dialog" aria-label={t('common.settings')} data-testid="settings">
        <div className="settings">
          <nav className="settings-nav">
            <h2>{t('common.settings')}</h2>
            {nav.map(([id, label, icon]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`settings-${id}`}>
                {icon}
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-main">
            <button className="btn icon ghost sm close-x" onClick={closeDialog} aria-label={t('common.close')}>
              <IconClose size={16} />
            </button>
            {tab === 'general' && <GeneralTab />}
            {tab === 'menu' && <MenuTab />}
            {tab === 'transfer' && <TransferTab />}
            {tab === 'help' && <HelpTab />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Head({ title, sub }: { title: TKey; sub: TKey }) {
  return (
    <>
      <h3>{t(title)}</h3>
      <p className="muted" style={{ marginTop: -4 }}>
        {t(sub)}
      </p>
    </>
  );
}

function GeneralTab() {
  const p = useStore((s) => s.settings.prefs);
  return (
    <>
      <Head title="settings.general" sub="settings.general.sub" />
      <Group>
        <Row label={t('settings.lang')}>
          <select className="select" value={p.lang} onChange={(e) => updatePrefs({ lang: e.target.value as Lang })} data-testid="settings-lang">
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.theme')}>
          <Seg value={p.theme} onChange={(v: Prefs['theme']) => updatePrefs({ theme: v })} options={[['light', t('theme.light')], ['dark', t('theme.dark')], ['system', t('theme.system')]]} />
        </Row>
        <Row label={t('settings.mode')} desc={t(p.mode === 'simple' ? 'mode.simple.desc' : 'mode.expert.desc')}>
          <Seg value={p.mode} onChange={(v: Prefs['mode']) => updatePrefs({ mode: v })} options={[['simple', t('mode.simple')], ['expert', t('mode.expert')]]} />
        </Row>
      </Group>
      <button className="btn ghost sm" onClick={showIntroAgain}>
        {t('settings.intro')}
      </button>
    </>
  );
}

const MENU_IDS = ['open', 'structure', 'rename', 'images', 'send', 'receive', 'dates', 'sort', 'pdf', 'copypath', 'newfile'];
function MenuTab() {
  const menu = useStore((s) => s.menu);
  const actions = useStore((s) => s.settings.menu.actions);
  const [busy, setBusy] = useState(false);
  const isMac = window.api.platform === 'darwin';
  useEffect(() => {
    refreshMenu();
  }, []);
  const install = async () => {
    setBusy(true);
    const r = await call<{ ok: boolean }>('menu:install');
    await refreshMenu();
    await updateSettings({});
    setBusy(false);
    toast(r.ok ? t('menu.installed') : t('menu.failed'), r.ok ? 'ok' : 'error');
  };
  return (
    <>
      <Head title="settings.menu" sub={isMac ? 'menu.sub.mac' : 'menu.sub.win'} />
      <div className={`banner ${menu?.installed ? 'success' : 'info'}`}>
        {menu?.installed ? <IconCheck size={18} /> : <IconMouse size={18} />}
        <div className="grow">{menu?.unsupported ? t('menu.unsupported') : menu?.installed ? t('menu.status.on') : t('menu.status.off')}</div>
        {!menu?.unsupported &&
          (menu?.installed ? (
            <button
              className="btn sm ghost"
              onClick={async () => {
                await call('menu:uninstall');
                await refreshMenu();
                await updateSettings({});
              }}
            >
              {t('menu.uninstall')}
            </button>
          ) : (
            <button className="btn sm primary" disabled={busy} onClick={install} data-testid="settings-menu-install">
              {t('menu.install')}
            </button>
          ))}
      </div>
      <div className="section-label">{t('menu.entries')}</div>
      <div className="card">
        {MENU_IDS.map((id) => (
          <label className="list-row" key={id}>
            <input
              type="checkbox"
              checked={actions.includes(id)}
              disabled={id === 'open'}
              onChange={async (e) => {
                const next = e.target.checked ? [...actions, id] : actions.filter((x) => x !== id);
                await updateSettings({ menu: { actions: MENU_IDS.filter((x) => next.includes(x)) } });
                if (menu?.installed) install();
              }}
            />
            <span className="grow">{t(`menu.e.${id}` as TKey)}</span>
          </label>
        ))}
      </div>
      <div className="section-label">{t('menu.how')}</div>
      <div className="card pad small">
        {(isMac ? ['menu.how.mac.1', 'menu.how.mac.2', 'menu.how.mac.3'] : ['menu.how.win.1', 'menu.how.win.2', 'menu.how.win.3']).map((k, i) => (
          <p key={k} style={{ margin: i ? '8px 0 0' : 0 }}>
            <span className="num-inline">{i + 1}</span> {t(k as TKey)}
          </p>
        ))}
        {isMac && (
          <button className="btn xs ghost" style={{ marginTop: 10 }} onClick={() => call('menu:openSettings')}>
            {t('menu.openSettings')}
          </button>
        )}
      </div>
    </>
  );
}

function TransferTab() {
  const tr = useStore((s) => s.settings.transfer);
  const app = useStore((s) => s.app);
  return (
    <>
      <Head title="settings.transfer" sub="settings.transfer.sub" />
      <Group>
        <Row label={t('settings.transfer.inbox')} desc={tr.inbox || app.downloads}>
          <button className="btn sm" onClick={async () => (await call<string[]>('fs:pick', { dirs: true, multi: false })).forEach((d) => updateSettings({ transfer: { inbox: d } }))}>
            {t('pick.change')}
          </button>
        </Row>
        <Row label={t('settings.transfer.port')} desc={t('settings.transfer.port.desc')}>
          <input className="input" type="number" min={1024} max={65535} value={tr.port} onChange={(e) => updateSettings({ transfer: { port: Number(e.target.value) || 8643 } })} style={{ width: 100 }} />
        </Row>
      </Group>
      <div className="safe-note">
        <IconLock size={17} />
        {t('settings.transfer.safe')}
      </div>
    </>
  );
}

function HelpTab() {
  const [open, setOpen] = useState<number | null>(1);
  return (
    <>
      <Head title="settings.help" sub="help.sub" />
      <div className="faq">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <div key={n} className={`faq-item ${open === n ? 'open' : ''}`}>
            <button onClick={() => setOpen(open === n ? null : n)}>{t(`faq.${n}.q` as TKey)}</button>
            {open === n && <p>{t(`faq.${n}.a` as TKey)}</p>}
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>
        {t('help.more')}{' '}
        <button className="link" onClick={() => call('shell:openExternal', APP_URL)}>
          {APP_URL.replace('https://', '')}
        </button>
      </p>
    </>
  );
}

function AboutTab() {
  const info = useStore((s) => s.app);
  return (
    <>
      <div className="row" style={{ gap: 16, marginBottom: 20 }}>
        <Logo size={64} />
        <div>
          <h3 style={{ marginBottom: 0 }}>SlimKit</h3>
          <div className="muted">{t('about.version', { v: info?.version || '…' })}</div>
          <div className="faint small">{t('app.tagline')}</div>
        </div>
      </div>
      <Group>
        <Row label={t('about.privacy.title')} desc={t('about.privacy')}>
          <IconLock size={18} className="faint" />
        </Row>
      </Group>
      <div className="section-label">{t('about.more')}</div>
      <button className="app-card link" style={{ marginBottom: 14 }} onClick={() => call('shell:openExternal', WEBSITE_URL)} data-testid="website-link">
        <div className="row" style={{ gap: 12 }}>
          <img src={slimbitMark} alt="" width={36} height={36} />
          <div className="grow">
            <div style={{ fontWeight: 620 }}>{t('about.website')}</div>
            <div className="small faint">{t('about.website.desc')}</div>
          </div>
          <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {WEBSITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '')} ↗
          </span>
        </div>
      </button>
      <p className="small muted">
        {t('about.contact')}{' '}
        <button className="link" onClick={() => call('shell:openExternal', 'mailto:' + EMAIL)}>
          {EMAIL}
        </button>
      </p>
      <div className="row small faint" style={{ justifyContent: 'space-between' }}>
        <span>{t('about.copyright', { year: new Date().getFullYear() })}</span>
        <span>
          Electron {info?.electron} · {info?.platform}
        </span>
      </div>
    </>
  );
}
