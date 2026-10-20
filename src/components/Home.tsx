import { useMemo, useState } from 'react';
import { t, fmtNum, type TKey } from '../i18n';
import { useStore, openDialog, openTool, setView, setSelection, call, refreshMenu, toast, updateSettings } from '../store';
import { TOOLS, GROUPS, toolName, toolDesc, type ToolId } from '../tools';
import { Logo } from './ui';
import { ToolIcon, useFiles, droppedPaths, KindIcon } from './kit';
import { IconSettings, IconHelp, IconHistory, IconBolt, IconMouse, IconClose, IconCheck, IconArrowRight } from '../icons';

export function Header() {
  const view = useStore((s) => s.view);
  return (
    <header className="header">
      <button className="brand" onClick={() => setView({ kind: 'home' })}>
        <Logo size={24} />
        SlimKit
      </button>
      <div className="spacer" />
      <button className={`btn ghost sm ${view.kind === 'auto' ? 'on' : ''}`} onClick={() => setView({ kind: 'auto' })} data-testid="open-auto">
        <IconBolt size={16} />
        {t('nav.auto')}
      </button>
      <button className={`btn ghost sm ${view.kind === 'history' ? 'on' : ''}`} onClick={() => setView({ kind: 'history' })} data-testid="open-history">
        <IconHistory size={16} />
        {t('nav.history')}
      </button>
      <button className="btn icon ghost" onClick={() => openDialog({ kind: 'settings', tab: 'help' })} aria-label={t('common.help')}>
        <IconHelp size={18} />
      </button>
      <button className="btn icon ghost" onClick={() => openDialog({ kind: 'settings' })} aria-label={t('common.settings')} data-testid="open-settings">
        <IconSettings size={18} />
      </button>
    </header>
  );
}

export function Home() {
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const selection = useStore((s) => s.selection);
  const menu = useStore((s) => s.menu);
  const menuInstalled = useStore((s) => s.settings.menu.installed);
  const files = useFiles(selection, false);
  const [over, setOver] = useState(false);

  // Passende Werkzeuge zur Auswahl (z. B. nach Rechtsklick)
  const stats = useMemo(() => {
    const f = files || [];
    return {
      dirs: f.filter((x) => x.isDir).length,
      files: f.filter((x) => !x.isDir).length,
      images: f.filter((x) => x.kind === 'image').length,
      pdfs: f.filter((x) => x.ext === 'pdf').length,
    };
  }, [files]);
  const suggested = useMemo(
    () =>
      selection.length
        ? TOOLS.map((x) => ({ x, score: x.fits(stats) }))
            .filter((r) => r.score > 0 && (expert || r.x.simple || r.score >= 4))
            .sort((a, b) => b.score - a.score)
            .map((r) => r.x)
        : [],
    [stats, selection.length, expert],
  );

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const p = droppedPaths(e);
    if (p.length) setSelection(p);
  };

  return (
    <div
      className={`screen ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={drop}
    >
      <div className="home">
        {!menuInstalled && menu && !menu.unsupported && <MenuBanner />}

        {selection.length > 0 ? (
          <section className="selection-card" data-testid="selection">
            <div className="row" style={{ gap: 10 }}>
              <div className="sel-icons">
                {(files || []).slice(0, 3).map((f) => (
                  <span key={f.path}>
                    <KindIcon kind={f.kind} size={18} />
                  </span>
                ))}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="sel-title ellipsis">{selection.length === 1 ? files?.[0]?.name : t('home.sel.many', { n: fmtNum(selection.length) })}</div>
                <div className="small muted">{t('home.sel.what')}</div>
              </div>
              <button className="btn icon ghost sm" onClick={() => setSelection([])} aria-label={t('common.close')} data-testid="clear-selection">
                <IconClose size={16} />
              </button>
            </div>
            <div className="tiles compact">
              {suggested.map((x) => (
                <Tile key={x.id} id={x.id} onClick={() => openTool(x.id, selection)} />
              ))}
            </div>
          </section>
        ) : (
          <div className="home-hello">
            <h1>{t('home.title')}</h1>
            <p className="muted">{t('home.sub')}</p>
          </div>
        )}

        <div className="groups">
        {GROUPS.map((g) => {
          const list = TOOLS.filter((x) => x.group === g && (expert || x.simple));
          if (!list.length) return null;
          return (
            <section key={g} className="tool-group">
              <div className="section-label">{t(`group.${g}` as TKey)}</div>
              <div className="tiles">
                {list.map((x) => (
                  <Tile key={x.id} id={x.id} onClick={() => openTool(x.id, selection)} />
                ))}
              </div>
            </section>
          );
        })}
        </div>
        <section className="tool-group">
          <div className="section-label">{t('group.auto')}</div>
          <button className="tile auto-tile" onClick={() => setView({ kind: 'auto' })}>
            <span className="tool-ic" style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(140deg,#f59e0b,#ef4444)' }}>
              <IconBolt size={21} strokeWidth={2} />
            </span>
            <span className="tile-text">
              <b>{t('auto.tile')}</b>
              <span>{t('auto.tile.desc')}</span>
            </span>
            <IconArrowRight size={16} className="faint" />
          </button>
        </section>
        <p className="faint small center-text" style={{ marginTop: 18 }}>
          {t('home.dropHint')}
        </p>
      </div>
    </div>
  );
}

function Tile({ id, onClick }: { id: ToolId; onClick: () => void }) {
  return (
    <button className="tile" onClick={onClick} data-testid={`tile-${id}`}>
      <ToolIcon id={id} />
      <span className="tile-text">
        <b>{t(toolName(id))}</b>
        <span>{t(toolDesc(id))}</span>
      </span>
    </button>
  );
}

/** Hinweis oben: Rechtsklick-Menü mit einem Klick einrichten */
export function MenuBanner() {
  const [busy, setBusy] = useState(false);
  const isMac = window.api.platform === 'darwin';
  return (
    <div className="banner accent menu-banner" data-testid="menu-banner">
      <IconMouse size={20} />
      <div className="grow">
        <b>{t('menu.banner.title')}</b> {t(isMac ? 'menu.banner.mac' : 'menu.banner.win')}
      </div>
      <button
        className="btn primary sm"
        disabled={busy}
        data-testid="menu-install"
        onClick={async () => {
          setBusy(true);
          const r = await call<{ ok: boolean }>('menu:install');
          await refreshMenu();
          await updateSettings({});
          setBusy(false);
          toast(r.ok ? t('menu.installed') : t('menu.failed'), r.ok ? 'ok' : 'error');
        }}
      >
        {busy ? <span className="spinner sm" /> : <IconCheck size={15} />}
        {t('menu.install')}
      </button>
    </div>
  );
}
