import { useEffect, useState, type ReactNode } from 'react';
import { t, fmtSize, type TKey } from '../i18n';
import { call, goHome, toast, refreshHistory, useStore } from '../store';
import { tool, toolName, toolDesc, type ToolId } from '../tools';
import type { FileInfo } from '../types';
import {
  IconArrowLeft, IconFolderTree, IconRename, IconImage, IconCalendar, IconSend, IconReceive, IconSort, IconPdf, IconCopies, IconFlatten, IconBroom, IconPie,
  IconList, IconHash, IconFilePlus, IconFolderPlus, IconLink, IconFolder, IconFile, IconVideo, IconMusic, IconArchive, IconClose, IconPlus, IconCheck, IconUndo,
} from '../icons';

const TOOL_ICONS: Record<ToolId, typeof IconFolder> = {
  structure: IconFolderTree,
  rename: IconRename,
  images: IconImage,
  dates: IconCalendar,
  send: IconSend,
  receive: IconReceive,
  sort: IconSort,
  pdf: IconPdf,
  dupes: IconCopies,
  flatten: IconFlatten,
  empty: IconBroom,
  size: IconPie,
  list: IconList,
  hash: IconHash,
  newfile: IconFilePlus,
  newfolder: IconFolderPlus,
  copypath: IconLink,
};

export function ToolIcon({ id, size = 40 }: { id: ToolId; size?: number }) {
  const Icon = TOOL_ICONS[id];
  const c = tool(id).color;
  return (
    <span className="tool-ic" style={{ width: size, height: size, borderRadius: size * 0.28, background: `linear-gradient(140deg, ${c}, color-mix(in srgb, ${c} 70%, #1e3a8a))` }}>
      <Icon size={size * 0.52} strokeWidth={2} />
    </span>
  );
}

export function KindIcon({ kind, size = 16 }: { kind: FileInfo['kind']; size?: number }) {
  const I = { folder: IconFolder, image: IconImage, video: IconVideo, audio: IconMusic, doc: IconFile, archive: IconArchive, app: IconFile, other: IconFile }[kind] || IconFile;
  return <I size={size} className={`kind-ic k-${kind}`} />;
}

/** Pfade von hineingezogenen Dateien */
export function droppedPaths(e: React.DragEvent): string[] {
  return [...e.dataTransfer.files].map((f) => window.api.pathFor(f)).filter(Boolean);
}

/** Dateiinfos zu Pfaden laden (Ordner optional in Dateien auflösen) */
export function useFiles(paths: string[], expand?: { kinds?: string[]; recursive?: boolean } | false) {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const key = JSON.stringify([paths, expand]);
  useEffect(() => {
    let alive = true;
    setFiles(null);
    (expand ? call<FileInfo[]>('fs:expand', paths, expand) : call<FileInfo[]>('fs:info', paths)).then((f) => alive && setFiles(f));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return files;
}

/**
 * Auswahl der Eingaben: zeigt die gewählten Dateien/Ordner, Hinzufügen per Knopf oder Hineinziehen.
 * mode 'dir' = ein Ordner, 'dirs' = Ordner, 'files' = Dateien und Ordner
 */
export function Picker({ paths, onChange, mode, label, testId }: { paths: string[]; onChange: (p: string[]) => void; mode: 'dir' | 'dirs' | 'files'; label?: string; testId?: string }) {
  const infos = useFiles(paths, false);
  const [over, setOver] = useState(false);
  const single = mode === 'dir';
  const pick = async () => {
    const r = await call<string[]>('fs:pick', { dirs: mode !== 'files', multi: !single });
    if (r.length) onChange(single ? r.slice(0, 1) : [...new Set([...paths, ...r])]);
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const p = droppedPaths(e);
    if (p.length) onChange(single ? p.slice(0, 1) : [...new Set([...paths, ...p])]);
  };
  return (
    <div
      className={`picker ${over ? 'over' : ''} ${paths.length ? '' : 'empty'}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      data-testid={testId}
    >
      {label && <div className="section-label">{label}</div>}
      {!paths.length ? (
        <button className="pick-empty" onClick={pick}>
          <IconPlus size={18} />
          <span>{t(mode === 'files' ? 'pick.files' : single ? 'pick.folder' : 'pick.folders')}</span>
          <span className="faint small">{t('pick.drop')}</span>
        </button>
      ) : (
        <div className="pick-list">
          {(infos || []).slice(0, single ? 1 : 6).map((f) => (
            <div className="pick-item" key={f.path} title={f.path}>
              <KindIcon kind={f.kind} />
              <span className="grow ellipsis">{f.name}</span>
              {!f.isDir && <span className="faint small">{fmtSize(f.size)}</span>}
              <button className="btn icon ghost xs" onClick={() => onChange(paths.filter((p) => p !== f.path))} aria-label={t('common.remove')}>
                <IconClose size={13} />
              </button>
            </div>
          ))}
          {paths.length > 6 && !single && <div className="faint small" style={{ padding: '4px 10px' }}>{t('pick.more', { n: paths.length - 6 })}</div>}
          <div className="row" style={{ gap: 6, padding: '6px 4px 2px' }}>
            <button className="btn sm ghost" onClick={pick}>
              {single ? t('pick.change') : t('pick.add')}
            </button>
            {!single && paths.length > 1 && (
              <button className="btn sm ghost" onClick={() => onChange([])}>
                {t('pick.clear')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Rahmen eines Werkzeugs: Kopf mit Zurück, links Einstellungen, rechts Vorschau, unten Aktion */
export function ToolFrame({ id, side, main, foot, wide }: { id: ToolId; side: ReactNode; main: ReactNode; foot?: ReactNode; wide?: boolean }) {
  return (
    <div className="tool" data-testid={`tool-${id}`}>
      <div className="tool-head">
        <button className="btn icon ghost" onClick={goHome} aria-label={t('common.back')} data-testid="back">
          <IconArrowLeft size={18} />
        </button>
        <ToolIcon id={id} size={34} />
        <div className="grow">
          <h2>{t(toolName(id))}</h2>
          <div className="small muted">{t(toolDesc(id))}</div>
        </div>
      </div>
      <div className={`tool-body ${wide ? 'wide' : ''}`}>
        <div className="tool-side">{side}</div>
        <div className="tool-main">{main}</div>
      </div>
      {foot && <div className="tool-foot">{foot}</div>}
    </div>
  );
}

/** Ergebnis nach einer Aktion mit "Zeigen" und "Rückgängig" */
export function Done({ text, reveal, historyId, onUndone, children }: { text: ReactNode; reveal?: string; historyId?: string; onUndone?: () => void; children?: ReactNode }) {
  const [undone, setUndone] = useState(false);
  return (
    <div className="done-card" data-testid="done">
      <div className="big-ic ok">
        <IconCheck size={30} strokeWidth={2.6} />
      </div>
      <h3>{text}</h3>
      {children}
      <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        {reveal && (
          <button className="btn" onClick={() => call('fs:reveal', reveal)} data-testid="reveal">
            {t(window.api.platform === 'darwin' ? 'common.showFinder' : 'common.showExplorer')}
          </button>
        )}
        {historyId && !undone && (
          <button
            className="btn ghost"
            data-testid="undo"
            onClick={async () => {
              const r = await call<{ ok: number; failed: number }>('history:undo', historyId);
              setUndone(true);
              refreshHistory();
              toast(r.failed ? t('history.undoPartial', { ok: r.ok, failed: r.failed }) : t('history.undone'), r.failed ? 'error' : 'ok');
              onUndone?.();
            }}
          >
            <IconUndo size={15} />
            {t('common.undo')}
          </button>
        )}
        <button className="btn primary" onClick={goHome} data-testid="finish">
          {t('common.finish')}
        </button>
      </div>
    </div>
  );
}

export function Empty({ text, icon }: { text: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <p>{text}</p>
    </div>
  );
}

export function Busy({ text }: { text?: ReactNode }) {
  const p = useStore((s) => s.ready) && text;
  return (
    <div className="empty-state">
      <div className="spinner" />
      {p && <p>{text}</p>}
    </div>
  );
}

/** Zahl + Einheit für Zusammenfassungen */
export function Stat({ n, label }: { n: ReactNode; label: TKey | string }) {
  return (
    <div className="mini-stat">
      <b>{n}</b>
      <span>{label.includes('.') ? t(label as TKey) : label}</span>
    </div>
  );
}

/** Kurze Fehlermeldung als Text */
export function errText(e: unknown) {
  const m = String((e as Error)?.message || e);
  if (/EACCES|EPERM/.test(m)) return t('err.permission');
  if (/ENOSPC/.test(m)) return t('err.space');
  if (/ENOENT/.test(m)) return t('err.missing');
  if (/same-folder/.test(m)) return t('err.sameFolder');
  return t('err.generic');
}
