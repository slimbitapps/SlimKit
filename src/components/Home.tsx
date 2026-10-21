import { useMemo, useState } from 'react';
import { t, type TKey } from '../i18n';
import { useStore, openDialog, openTool, setView, setSelection, call, refreshMenu, toast, updateSettings } from '../store';
import { TOOLS, toolName, toolDesc, type ToolId } from '../tools';
import { Logo } from './ui';
import { ToolIcon, useFiles, droppedPaths, Thumb, summarize } from './kit';
import { TASK_ART, ArtDrop, ArtRightClick, ArtAuto } from './art';
import { IconSettings, IconHelp, IconHistory, IconBolt, IconClose, IconCheck, IconArrowRight, IconDown, IconFolder, IconFile } from '../icons';

const TASKS: ToolId[] = ['structure', 'images', 'send', 'receive', 'rename', 'sort', 'pdf', 'dates'];

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
      <button className="btn icon ghost" onClick={() => openDialog({ kind: 'settings', tab: 'help' })} aria-label={t('common.help')} title={t('common.help')}>
        <IconHelp size={18} />
      </button>
      <button className="btn icon ghost" onClick={() => openDialog({ kind: 'settings' })} aria-label={t('common.settings')} title={t('common.settings')} data-testid="open-settings">
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
  const [over, setOver] = useState(false);
  const [showPro, setShowPro] = useState(false);
  const pro = TOOLS.filter((x) => !TASKS.includes(x.id));

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
        {selection.length > 0 ? <SelectionPanel paths={selection} /> : <HeroDrop />}

        {!menuInstalled && menu && !menu.unsupported && <MenuBanner />}

        <h2 className="h-section">{t('home.tasks')}</h2>
        <div className="task-grid">
          {TASKS.map((id) => (
            <TaskCard key={id} id={id} onClick={() => openTool(id, selection)} />
          ))}
        </div>

        <div className="home-extras">
          <button className="extra-card" onClick={() => setView({ kind: 'auto' })} data-testid="home-auto">
            <div className="extra-art">
              <ArtAuto />
            </div>
            <div className="grow">
              <b>{t('auto.tile')}</b>
              <p>{t('auto.tile.desc')}</p>
              <span className="link-ish">
                {t('home.auto.cta')} <IconArrowRight size={14} />
              </span>
            </div>
          </button>
        </div>

        <h2 className="h-section">
          {t('home.pro')}
          {!expert && (
            <button className="btn ghost sm" onClick={() => setShowPro(!showPro)} data-testid="show-pro" style={{ marginLeft: 8 }}>
              <IconDown size={14} style={{ transform: showPro ? 'rotate(180deg)' : undefined }} />
              {showPro ? t('home.pro.hide') : t('home.pro.show', { n: pro.length })}
            </button>
          )}
        </h2>
        {(expert || showPro) && (
          <div className="pro-grid">
            {pro.map((x) => (
              <button key={x.id} className="pro-row" onClick={() => openTool(x.id, selection)} data-testid={`tile-${x.id}`}>
                <ToolIcon id={x.id} size={34} />
                <span className="grow">
                  <b>{t(toolName(x.id))}</b>
                  <span>{t(toolDesc(x.id))}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!expert && !showPro && <p className="muted small" style={{ marginTop: -4 }}>{t('home.pro.text')}</p>}
      </div>
    </div>
  );
}

function TaskCard({ id, onClick, badge }: { id: ToolId; onClick: () => void; badge?: string }) {
  const Art = TASK_ART[id];
  return (
    <button className="task-card" onClick={onClick} data-testid={`tile-${id}`}>
      <div className="task-art">{Art && <Art />}</div>
      <div className="task-text">
        <b>
          {t(toolName(id))}
          {badge && <span className="badge accent">{badge}</span>}
        </b>
        <span>{t(toolDesc(id))}</span>
      </div>
    </button>
  );
}

/** Große Ablagefläche oben auf der Startseite */
function HeroDrop() {
  const pick = async (dirs: boolean) => {
    const r = await call<string[]>('fs:pick', { dirs, multi: true });
    if (r.length) setSelection(r);
  };
  return (
    <section className="hero-drop" data-testid="hero-drop">
      <div className="grow">
        <h1>{t('home.title')}</h1>
        <p>{t('home.sub')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn primary lg" onClick={() => pick(false)}>
            <IconFile size={17} /> {t('home.pickFiles')}
          </button>
          <button className="btn lg" onClick={() => pick(true)}>
            <IconFolder size={17} /> {t('home.pickFolder')}
          </button>
        </div>
      </div>
      <div className="hero-drop-art">
        <ArtDrop />
        <span className="small muted">{t('home.dropHere')}</span>
      </div>
    </section>
  );
}

/** Nach dem Hineinziehen oder Rechtsklick: Was möchtest du damit machen? */
function SelectionPanel({ paths }: { paths: string[] }) {
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const files = useFiles(paths, false);
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
      TOOLS.map((x) => ({ x, score: x.fits(stats) }))
        .filter((r) => r.score > 0 && (expert || TASKS.includes(r.x.id) || r.score >= 4))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((r) => r.x),
    [stats, expert],
  );
  return (
    <section className="selection-card" data-testid="selection">
      <div className="sel-head">
        <div className="sel-thumbs">
          {(files || []).slice(0, 4).map((f) => (
            <Thumb key={f.path} file={f} size={46} />
          ))}
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="sel-title ellipsis">{files?.length === 1 ? files[0].name : files ? summarize(files) : '…'}</div>
          <div className="muted">{t('home.sel.what')}</div>
        </div>
        <button className="btn ghost sm" onClick={() => setSelection([])} data-testid="clear-selection">
          <IconClose size={15} /> {t('home.sel.clear')}
        </button>
      </div>
      <div className="sel-tools">
        {suggested.map((x, i) => (
          <button key={x.id} className={`sel-tool ${i === 0 ? 'first' : ''}`} onClick={() => openTool(x.id, paths)} data-testid={`suggest-${x.id}`}>
            <ToolIcon id={x.id} size={38} />
            <span className="grow">
              <b>
                {t(toolName(x.id))}
                {i === 0 && <span className="badge accent">{t('home.sel.best')}</span>}
              </b>
              <span>{t(toolDesc(x.id))}</span>
            </span>
            <IconArrowRight size={16} className="faint" />
          </button>
        ))}
      </div>
    </section>
  );
}

/** Karte: Rechtsklick-Menü mit einem Klick einrichten */
export function MenuBanner() {
  const [busy, setBusy] = useState(false);
  const isMac = window.api.platform === 'darwin';
  return (
    <section className="menu-card" data-testid="menu-banner">
      <div className="menu-art">
        <ArtRightClick mac={isMac} />
      </div>
      <div className="grow">
        <span className="badge accent">{t('menu.banner.badge')}</span>
        <h3>{t('menu.banner.title')}</h3>
        <p className="muted">{t(isMac ? 'menu.banner.mac' : 'menu.banner.win')}</p>
        <button
          className="btn primary"
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
    </section>
  );
}

export const TASK_IDS = TASKS;
export type { TKey };
