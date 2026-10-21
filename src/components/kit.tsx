import { useEffect, useState, type ReactNode } from 'react';
import { t, fmtSize, fmtNum, type TKey } from '../i18n';
import { call, goHome, toast, refreshHistory, useStore } from '../store';
import { tool, toolName, toolDesc, type ToolId } from '../tools';
import type { FileInfo } from '../types';
import { TASK_ART } from './art';
import { Dialog } from './ui';
import {
  IconArrowLeft, IconFolderTree, IconRename, IconImage, IconCalendar, IconSend, IconReceive, IconSort, IconPdf, IconCopies, IconFlatten, IconBroom, IconPie,
  IconList, IconFolder, IconFile, IconVideo, IconMusic, IconArchive, IconClose, IconPlus, IconCheck, IconUndo,
  IconHelp, IconDown, IconUpload,
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
};

export function ToolIcon({ id, size = 40 }: { id: ToolId; size?: number }) {
  const Icon = TOOL_ICONS[id];
  const c = tool(id).color;
  return (
    <span className="tool-ic" style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(140deg, color-mix(in srgb, ${c} 80%, #fff), ${c} 55%, color-mix(in srgb, ${c} 75%, #1e3a8a))` }}>
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

// ------------------------------------------------------------------ Vorschaubilder
const thumbCache = new Map<string, Promise<string | null>>();
export function useThumb(path: string | undefined, size = 160) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    const k = `${path}@${size}`;
    if (!thumbCache.has(k)) {
      // Speicher klein halten: nur die letzten 400 Vorschaubilder merken
      if (thumbCache.size > 400) thumbCache.delete(thumbCache.keys().next().value!);
      thumbCache.set(k, call<string | null>('fs:thumb', path, size).catch(() => null));
    }
    let alive = true;
    thumbCache.get(k)!.then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [path, size]);
  return src;
}
export function Thumb({ file, size = 44 }: { file: Pick<FileInfo, 'path' | 'kind' | 'ext' | 'isDir'>; size?: number }) {
  const visual = !file.isDir && (file.kind === 'image' || file.kind === 'video' || file.ext === 'pdf');
  const src = useThumb(visual ? file.path : undefined, Math.round(size * 2.2));
  return (
    <span className={`thumb k-${file.isDir ? 'folder' : file.kind}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" draggable={false} /> : <KindIcon kind={file.isDir ? 'folder' : file.kind} size={size * 0.48} />}
    </span>
  );
}

/** Kurze Zusammenfassung einer Auswahl: "12 Fotos · 34 MB" */
export function summarize(files: FileInfo[]) {
  const dirs = files.filter((f) => f.isDir).length;
  const imgs = files.filter((f) => f.kind === 'image').length;
  const other = files.length - dirs - imgs;
  const parts: string[] = [];
  if (dirs) parts.push(t(dirs === 1 ? 'sum.dir1' : 'sum.dirs', { n: fmtNum(dirs) }));
  if (imgs) parts.push(t(imgs === 1 ? 'sum.img1' : 'sum.imgs', { n: fmtNum(imgs) }));
  if (other) parts.push(t(other === 1 ? 'sum.file1' : 'sum.files', { n: fmtNum(other) }));
  const size = files.reduce((a, f) => a + f.size, 0);
  return parts.join(', ') + (size ? ` · ${fmtSize(size)}` : '');
}

// ------------------------------------------------------------------ Auswahl
/**
 * Auswahl der Eingaben: große Ablagefläche, danach Vorschau der Auswahl.
 * mode 'dir' = ein Ordner, 'dirs' = Ordner, 'files' = Dateien und Ordner
 */
export function Picker({ paths, onChange, mode, empty, hint, testId }: { paths: string[]; onChange: (p: string[]) => void; mode: 'dir' | 'dirs' | 'files'; empty?: string; hint?: string; testId?: string; label?: string }) {
  const infos = useFiles(paths, false);
  const [over, setOver] = useState(false);
  const single = mode === 'dir';
  const pick = async () => {
    const r = await call<string[]>('fs:pick', { dirs: mode !== 'files', multi: !single });
    if (r.length) onChange(single ? r.slice(0, 1) : [...new Set([...paths, ...r])]);
  };
  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const p = droppedPaths(e);
      if (p.length) onChange(single ? p.slice(0, 1) : [...new Set([...paths, ...p])]);
    },
  };
  if (!paths.length) {
    return (
      <button className={`dropzone ${over ? 'over' : ''}`} onClick={pick} {...dragProps} data-testid={testId}>
        <span className="dz-ic">
          <IconUpload size={26} />
        </span>
        <b>{empty || t(mode === 'files' ? 'pick.files' : 'pick.folder')}</b>
        <span className="muted">{t('pick.drop')}</span>
        {hint && <span className="faint small">{hint}</span>}
      </button>
    );
  }
  const list = infos || [];
  return (
    <div className={`picked ${over ? 'over' : ''}`} {...dragProps} data-testid={testId}>
      {single || list.length === 1 ? (
        list.slice(0, 1).map((f) => (
          <div className="picked-one" key={f.path}>
            <Thumb file={f} size={48} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="picked-name ellipsis" title={f.path}>
                {f.name}
              </div>
              <div className="small muted ellipsis">{f.isDir ? t('pick.inFolder', { dir: f.dir.split(/[\\/]/).pop() || f.dir }) : fmtSize(f.size)}</div>
            </div>
            <button className="btn sm" onClick={pick}>
              {single ? t('pick.change') : t('pick.add')}
            </button>
            {!single && (
              <button className="btn icon ghost sm" onClick={() => onChange([])} aria-label={t('common.remove')}>
                <IconClose size={14} />
              </button>
            )}
          </div>
        ))
      ) : (
        <>
          <div className="picked-head">
            <b>{summarize(list)}</b>
            <div className="spacer" />
            <button className="btn sm" onClick={pick}>
              <IconPlus size={14} /> {t('pick.add')}
            </button>
            <button className="btn sm ghost" onClick={() => onChange([])}>
              {t('pick.clear')}
            </button>
          </div>
          <div className="picked-grid">
            {list.slice(0, 11).map((f) => (
              <div className="picked-cell" key={f.path} title={f.name}>
                <Thumb file={f} size={64} />
                <span className="ellipsis">{f.name}</span>
                <button className="x" onClick={() => onChange(paths.filter((p) => p !== f.path))} aria-label={t('common.remove')}>
                  <IconClose size={11} />
                </button>
              </div>
            ))}
            {list.length > 11 && <div className="picked-more">+{fmtNum(list.length - 11)}</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Seitenaufbau
/** Kopf eines Werkzeugs: Titel, Erklärung in 3 Schritten, Bild – und Hilfe */
function ToolHead({ id, compact }: { id: ToolId; compact?: boolean }) {
  const [help, setHelp] = useState(false);
  const Art = TASK_ART[id];
  const hasSteps = !!Art;
  return (
    <div className={`tool-hero ${compact ? 'compact' : ''}`}>
      <button className="btn icon ghost back" onClick={goHome} aria-label={t('common.back')} data-testid="back">
        <IconArrowLeft size={18} />
      </button>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <ToolIcon id={id} size={30} />
          <h1>{t(toolName(id))}</h1>
          <button className="btn ghost sm howto-btn" onClick={() => setHelp(true)}>
            <IconHelp size={15} /> {t('common.howto')}
          </button>
        </div>
        <p className="muted hero-desc">{t(toolDesc(id))}</p>
        {hasSteps && !compact && (
          <ol className="howto-steps">
            {[1, 2, 3].map((n) => (
              <li key={n}>
                <span className="n">{n}</span>
                {t(`how.${id}.${n}` as TKey)}
              </li>
            ))}
          </ol>
        )}
      </div>
      {Art && !compact && (
        <div className="hero-art">
          <Art />
        </div>
      )}
      {help && (
        <Dialog title={t(toolName(id))} onClose={() => setHelp(false)}>
          {Art && (
            <div className="help-art">
              <Art />
            </div>
          )}
          <p style={{ marginTop: 0 }}>{t(`help.${id}` as TKey)}</p>
          {hasSteps && (
            <ol className="howto-steps vertical">
              {[1, 2, 3].map((n) => (
                <li key={n}>
                  <span className="n">{n}</span>
                  {t(`how.${id}.${n}` as TKey)}
                </li>
              ))}
            </ol>
          )}
          <div className="safe-note" style={{ marginTop: 14 }}>
            <IconUndo size={16} />
            {t('help.undo')}
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Werkzeug-Seite: Kopf, Schritte untereinander, Aktionsleiste unten */
export function ToolPage({ id, children, foot, compact }: { id: ToolId; children: ReactNode; foot?: ReactNode; compact?: boolean }) {
  return (
    <div className="tool" data-testid={`tool-${id}`}>
      <div className="tool-col">
        <ToolHead id={id} compact={compact} />
        {children}
      </div>
      {foot && (
        <div className="tool-foot">
          <div className="tool-foot-in">{foot}</div>
        </div>
      )}
    </div>
  );
}

/** Ein Schritt: Nummer, Frage, Inhalt */
export function Step({ n, title, hint, children, disabled, right, testId }: { n: number; title: ReactNode; hint?: ReactNode; children?: ReactNode; disabled?: boolean; right?: ReactNode; testId?: string }) {
  return (
    <section className={`step ${disabled ? 'disabled' : ''}`} data-testid={testId}>
      <div className="step-head">
        <span className="step-n">{n}</span>
        <div className="grow">
          <h2>{title}</h2>
          {hint && <p className="muted small">{hint}</p>}
        </div>
        {right}
      </div>
      {!disabled && children && <div className="step-body">{children}</div>}
    </section>
  );
}

/** Weitere Optionen (aufklappbar). Im Expertenmodus offen. */
export function More({ children, label }: { children: ReactNode; label?: string }) {
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const [open, setOpen] = useState(expert);
  return (
    <div className={`more ${open ? 'open' : ''}`}>
      <button className="more-btn" onClick={() => setOpen(!open)}>
        <IconDown size={15} className="chev" /> {label || t('common.more')}
      </button>
      {open && <div className="more-body">{children}</div>}
    </div>
  );
}

/** Große Auswahlkarten (wie Radioknöpfe) */
export function Choices<T extends string>({ value, onChange, options, cols = 2, testPrefix }: { value: T; onChange: (v: T) => void; options: { id: T; title: ReactNode; desc?: ReactNode; icon?: ReactNode; badge?: ReactNode }[]; cols?: number; testPrefix?: string }) {
  return (
    <div className={`choices cols-${cols}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={`choice-card ${value === o.id ? 'on' : ''}`} onClick={() => onChange(o.id)} data-testid={testPrefix ? `${testPrefix}-${o.id}` : undefined}>
          {o.icon && <span className="cc-ic">{o.icon}</span>}
          <span className="cc-text">
            <b>
              {o.title}
              {o.badge && <span className="badge accent">{o.badge}</span>}
            </b>
            {o.desc && <span>{o.desc}</span>}
          </span>
          <span className="cc-radio">{value === o.id && <IconCheck size={12} strokeWidth={3.2} />}</span>
        </button>
      ))}
    </div>
  );
}

/** Für die einfacheren Werkzeuge: Einstellungen und Ergebnis untereinander */
export function ToolFrame({ id, side, main, foot }: { id: ToolId; side: ReactNode; main: ReactNode; foot?: ReactNode; wide?: boolean }) {
  return (
    <ToolPage id={id} foot={foot} compact={!side}>
      {side ? (
        <>
          <Step n={1} title={t('step.choose')}>
            <div className="plain-side">{side}</div>
          </Step>
          <Step n={2} title={t('step.result')}>
            {main}
          </Step>
        </>
      ) : (
        main
      )}
    </ToolPage>
  );
}

/** Ergebnis nach einer Aktion mit "Zeigen" und "Rückgängig" */
export function Done({ text, reveal, historyId, onUndone, children }: { text: ReactNode; reveal?: string; historyId?: string; onUndone?: () => void; children?: ReactNode }) {
  const [undone, setUndone] = useState(false);
  return (
    <div className="done-card" data-testid="done">
      <div className="done-burst">
        <div className="big-ic ok">
          <IconCheck size={34} strokeWidth={2.8} />
        </div>
      </div>
      <h3>{undone ? t('history.undone') : text}</h3>
      {!undone && children}
      <div className="row done-actions">
        {reveal && !undone && (
          <button className="btn lg" onClick={() => call('fs:reveal', reveal)} data-testid="reveal">
            <IconFolder size={16} /> {t(window.api.platform === 'darwin' ? 'common.showFinder' : 'common.showExplorer')}
          </button>
        )}
        <button className="btn primary lg" onClick={goHome} data-testid="finish">
          {t('common.finish')}
        </button>
      </div>
      {historyId && !undone && (
        <button
          className="btn ghost sm undo-link"
          data-testid="undo"
          onClick={async () => {
            const r = await call<{ ok: number; failed: number }>('history:undo', historyId);
            setUndone(true);
            refreshHistory();
            toast(r.failed ? t('history.undoPartial', { ok: r.ok, failed: r.failed }) : t('history.undone'), r.failed ? 'error' : 'ok');
            onUndone?.();
          }}
        >
          <IconUndo size={14} />
          {t('done.undo')}
        </button>
      )}
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
  return (
    <div className="empty-state busy">
      <div className="spinner" />
      {text && <p>{text}</p>}
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

export { Dialog };

/** Streifen mit Vorschaubildern: "6 Fotos gefunden" */
export function FoundStrip({ files, label }: { files: FileInfo[]; label?: string }) {
  if (!files.length) return null;
  return (
    <div className="found-strip" data-testid="found-strip">
      <div className="found-thumbs">
        {files.slice(0, 8).map((f) => (
          <Thumb key={f.path} file={f} size={40} />
        ))}
        {files.length > 8 && <span className="found-more">+{fmtNum(files.length - 8)}</span>}
      </div>
      <span className="small">
        <IconCheck size={13} strokeWidth={3} className="ok-ic" /> {label || t('found', { sum: summarize(files) })}
      </span>
    </div>
  );
}
