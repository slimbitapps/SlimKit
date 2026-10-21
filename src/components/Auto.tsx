import { useEffect, useState } from 'react';
import { t, fmtDate, fmtNum, fmtSize, type TKey } from '../i18n';
import { useStore, updateSettings, call, toast, refreshHistory, goHome } from '../store';
import { Dialog, Group, Row, Switch, Seg } from './ui';
import { Empty, Busy, Picker, ToolIcon } from './kit';
import { ArtAuto } from './art';
import { IconBolt, IconPlus, IconTrash, IconPlay, IconFolderTree, IconSort, IconBroom, IconArrowLeft, IconUndo, IconCheck } from '../icons';
import type { Automation, HistoryItem } from '../types';
import { basename } from '../paths';
import type { ToolId } from '../tools';

const TYPE_ICON = { year: IconFolderTree, tidy: IconSort, cleanup: IconBroom };
const TYPE_COLOR = { year: 'linear-gradient(140deg,#14b8a6,#2563eb)', tidy: 'linear-gradient(140deg,#a855f7,#6366f1)', cleanup: 'linear-gradient(140deg,#84cc16,#16a34a)' };
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function describe(a: Automation) {
  if (a.type === 'year') return t('auto.year.sum', { folder: basename(a.parent || '') || '?', date: `${a.day}.${a.month}.` });
  if (a.type === 'tidy') return t('auto.tidy.sum', { folder: basename(a.folder || '') || '?', by: t(`auto.by.${a.by || 'type'}` as TKey) });
  return t('auto.cleanup.sum', { folder: basename(a.folder || '') || '?', days: a.days || 30 });
}

export function AutoScreen() {
  const list = useStore((s) => s.settings.automations);
  const bg = useStore((s) => s.settings.background);
  const [edit, setEdit] = useState<Automation | null>(null);
  const [preview, setPreview] = useState<{ a: Automation; data: any } | null>(null);
  const save = (next: Automation[]) => updateSettings({ automations: next });

  const app = useStore((s) => s.app);
  // Fertige Vorschläge – ein Klick öffnet sie schon ausgefüllt
  const presets: { key: string; type: Automation['type']; a: Partial<Automation> }[] = [
    { key: 'year', type: 'year', a: { parent: '', month: 1, day: 1, includeExt: [], lastYear: new Date().getFullYear() } },
    { key: 'downloads', type: 'tidy', a: { folder: app.downloads, by: 'type', minAgeSec: 120 } },
    { key: 'desktop', type: 'tidy', a: { folder: app.desktop, by: 'type', minAgeSec: 120 } },
    { key: 'cleanup', type: 'cleanup', a: { folder: app.downloads, days: 30 } },
  ];
  const add = (p: (typeof presets)[number]) => setEdit({ id: crypto.randomUUID(), type: p.type, enabled: true, ...p.a });

  return (
    <div className="screen">
      <div className="page" data-testid="auto">
        <div className="tool-hero">
          <button className="btn icon ghost back" onClick={goHome} aria-label={t('common.back')}>
            <IconArrowLeft size={18} />
          </button>
          <div className="grow">
            <div className="row" style={{ gap: 10 }}>
              <span className="tool-ic" style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(140deg,#f59e0b,#ef4444)' }}>
                <IconBolt size={17} />
              </span>
              <h1>{t('auto.title')}</h1>
            </div>
            <p className="muted hero-desc">{t('auto.sub')}</p>
          </div>
          <div className="hero-art">
            <ArtAuto />
          </div>
        </div>

        <h2 className="h-section">{t('auto.ideas')}</h2>
        <div className="auto-add">
          {presets.map((p) => {
            const I = TYPE_ICON[p.type];
            return (
              <button key={p.key} className="pro-row" onClick={() => add(p)} data-testid={`auto-add-${p.key}`}>
                <span className="tool-ic" style={{ width: 38, height: 38, borderRadius: 11, background: TYPE_COLOR[p.type] }}>
                  <I size={20} strokeWidth={2} />
                </span>
                <span className="grow">
                  <b>{t(`auto.preset.${p.key}` as TKey)}</b>
                  <span>{t(`auto.preset.${p.key}.desc` as TKey)}</span>
                </span>
                <IconPlus size={16} className="faint" />
              </button>
            );
          })}
        </div>

        <h2 className="h-section">{t('auto.mine')}</h2>
        {!list.length ? (
          <div className="card pad muted">{t('auto.none')}</div>
        ) : (
          <div className="card">
            {list.map((a) => {
              const I = TYPE_ICON[a.type];
              return (
                <div className="list-row auto-row" key={a.id} data-testid="auto-item">
                  <span className="tool-ic" style={{ width: 32, height: 32, borderRadius: 9, background: TYPE_COLOR[a.type], opacity: a.enabled ? 1 : 0.45 }}>
                    <I size={17} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {t(`auto.${a.type}` as TKey)}
                    </div>
                    <div className="small muted ellipsis">{describe(a)}</div>
                    {a.lastRun ? <div className="small faint">{t('auto.last', { date: fmtDate(a.lastRun) })}</div> : null}
                  </div>
                  <button className="btn xs ghost" onClick={async () => setPreview({ a, data: await call('auto:preview', a) })}>
                    {t('auto.preview')}
                  </button>
                  <button
                    className="btn xs ghost"
                    data-testid="auto-run"
                    onClick={async () => {
                      const r = await call<{ done: number } | null>('auto:run', a.id);
                      refreshHistory();
                      toast(t('auto.ran', { n: r?.done ?? 0 }));
                    }}
                  >
                    <IconPlay size={12} /> {t('auto.runNow')}
                  </button>
                  <button className="btn xs ghost" onClick={() => setEdit(a)}>
                    {t('common.edit')}
                  </button>
                  <Switch on={a.enabled} onChange={(v) => save(list.map((x) => (x.id === a.id ? { ...x, enabled: v } : x)))} />
                </div>
              );
            })}
          </div>
        )}

        <h2 className="h-section">{t('auto.background')}</h2>
        <Group>
          <Row label={t('auto.tray')} desc={t(window.api.platform === 'darwin' ? 'auto.tray.mac' : 'auto.tray.win')}>
            <Switch on={bg.tray} onChange={(v) => updateSettings({ background: { tray: v } })} />
          </Row>
          <Row label={t('auto.autostart')} desc={t('auto.autostart.desc')}>
            <Switch on={bg.autostart} onChange={(v) => updateSettings({ background: { autostart: v } })} />
          </Row>
        </Group>
      </div>
      {edit && (
        <AutoEditor
          a={edit}
          onClose={() => setEdit(null)}
          onSave={(a) => {
            const exists = list.some((x) => x.id === a.id);
            save(exists ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]);
            setEdit(null);
          }}
          onDelete={list.some((x) => x.id === edit.id) ? () => (save(list.filter((x) => x.id !== edit.id)), setEdit(null)) : undefined}
        />
      )}
      {preview && <AutoPreview p={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AutoEditor({ a: initial, onClose, onSave, onDelete }: { a: Automation; onClose: () => void; onSave: (a: Automation) => void; onDelete?: () => void }) {
  const [a, setA] = useState(initial);
  const set = (p: Partial<Automation>) => setA({ ...a, ...p });
  const valid = a.type === 'year' ? !!a.parent : !!a.folder;
  return (
    <Dialog
      title={t(`auto.${a.type}` as TKey)}
      onClose={onClose}
      testId="auto-editor"
      foot={
        <>
          {onDelete && (
            <button className="btn ghost danger-text" onClick={onDelete}>
              <IconTrash size={15} /> {t('common.delete')}
            </button>
          )}
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(a)} data-testid="auto-save">
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t(`auto.${a.type}.long` as TKey)}
      </p>
      {a.type === 'year' && (
        <>
          <Picker mode="dir" paths={a.parent ? [a.parent] : []} onChange={(p) => set({ parent: p[0] || '' })} label={t('auto.year.parent')} testId="auto-parent" />
          <p className="small muted">{t('auto.year.parent.desc')}</p>
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>{t('auto.year.day')}</span>
              <input className="input" type="number" min={1} max={31} value={a.day} onChange={(e) => set({ day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>{t('auto.year.month')}</span>
              <select className="select" value={a.month} onChange={(e) => set({ month: Number(e.target.value) })}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {new Date(2025, m - 1, 1).toLocaleString(undefined, { month: 'long' })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={(a.lastYear || 0) < new Date().getFullYear()} onChange={(e) => set({ lastYear: e.target.checked ? new Date().getFullYear() - 1 : new Date().getFullYear() })} /> {t('auto.year.thisYear', { year: new Date().getFullYear() })}
          </label>
        </>
      )}
      {(a.type === 'tidy' || a.type === 'cleanup') && <Picker mode="dir" paths={a.folder ? [a.folder] : []} onChange={(p) => set({ folder: p[0] || '' })} label={t('auto.folder')} testId="auto-folder" />}
      {a.type === 'tidy' && (
        <>
          <div className="section-label">{t('sort.by')}</div>
          <Seg value={a.by || 'type'} onChange={(by) => set({ by })} options={[['type', t('auto.by.type')], ['month', t('auto.by.month')], ['year', t('auto.by.year')]]} />
          <p className="small muted">{t('auto.tidy.hint')}</p>
        </>
      )}
      {a.type === 'cleanup' && (
        <label className="field">
          <span>{t('auto.cleanup.days')}</span>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" type="number" min={1} value={a.days} onChange={(e) => set({ days: Math.max(1, Number(e.target.value) || 30) })} style={{ width: 90 }} />
            <span className="muted">{t('auto.cleanup.daysUnit')}</span>
          </div>
          <span className="small muted">{t('auto.cleanup.hint')}</span>
        </label>
      )}
    </Dialog>
  );
}

function AutoPreview({ p, onClose }: { p: { a: Automation; data: any }; onClose: () => void }) {
  const d = p.data;
  return (
    <Dialog title={t('auto.preview')} onClose={onClose}>
      {d.kind === 'year' &&
        (d.none ? (
          <p>{t('auto.preview.year.none')}</p>
        ) : (
          <p>{t('auto.preview.year', { src: basename(d.src), dest: basename(d.dest), n: d.dirs })}</p>
        ))}
      {d.kind === 'tidy' &&
        (d.count ? (
          <>
            <p>{t('auto.preview.tidy', { n: d.count })}</p>
            <div className="table" style={{ maxHeight: 300 }}>
              {d.moves.map((m: { name: string; folder: string }) => (
                <div className="trow" key={m.name}>
                  <span className="ellipsis grow">{m.name}</span>
                  <span className="faint small">→ {m.folder}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>{t('auto.preview.nothing')}</p>
        ))}
      {d.kind === 'cleanup' &&
        (d.count ? (
          <>
            <p>{t('auto.preview.cleanup', { n: d.count, size: fmtSize(d.size) })}</p>
            <div className="table" style={{ maxHeight: 300 }}>
              {d.files.map((f: { name: string; touched: number }) => (
                <div className="trow" key={f.name}>
                  <span className="ellipsis grow">{f.name}</span>
                  <span className="faint small">{fmtDate(f.touched, false)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>{t('auto.preview.nothing')}</p>
        ))}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Verlauf
export function HistoryScreen() {
  const items = useStore((s) => s.history);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    refreshHistory().then(() => setLoaded(true));
  }, []);
  return (
    <div className="screen">
      <div className="page" data-testid="history">
        <div className="tool-hero compact" style={{ marginBottom: 16 }}>
          <button className="btn icon ghost back" onClick={goHome} aria-label={t('common.back')}>
            <IconArrowLeft size={18} />
          </button>
          <div className="grow">
            <h1>{t('history.title')}</h1>
            <p className="muted hero-desc">{t('history.sub')}</p>
          </div>
          {items.length > 0 && (
            <button className="btn sm ghost" onClick={() => call('history:clear').then(refreshHistory)}>
              {t('history.clear')}
            </button>
          )}
        </div>
        {!loaded ? (
          <Busy />
        ) : !items.length ? (
          <Empty text={t('history.none')} />
        ) : (
          <div className="card">
            {items.map((h) => (
              <HistoryRow key={h.id} h={h} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TOOL_IDS = new Set(['structure', 'rename', 'images', 'dates', 'send', 'receive', 'sort', 'pdf', 'dupes', 'flatten', 'empty', 'size', 'list']);
function HistoryRow({ h }: { h: HistoryItem }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`list-row ${h.undone ? 'dim' : ''}`} data-testid="history-item">
      {TOOL_IDS.has(h.tool) ? <ToolIcon id={h.tool as ToolId} size={30} /> : <span className="tool-ic" style={{ width: 30, height: 30, borderRadius: 9, background: TYPE_COLOR.cleanup }}><IconBroom size={16} /></span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis">
          {h.title || t(`tool.${h.tool}` as TKey)}
          {h.auto && <span className="badge" style={{ marginLeft: 6 }}>{t('history.auto')}</span>}
        </div>
        <div className="small faint">
          {fmtDate(h.at)} · {t('common.files', { n: fmtNum(h.count) })}
        </div>
      </div>
      {h.undone ? (
        <span className="small faint">
          <IconCheck size={13} /> {t('history.wasUndone')}
        </span>
      ) : h.undoable ? (
        <button
          className="btn sm ghost"
          disabled={busy}
          data-testid="history-undo"
          onClick={async () => {
            setBusy(true);
            const r = await call<{ ok: number; failed: number }>('history:undo', h.id);
            await refreshHistory();
            setBusy(false);
            toast(r.failed ? t('history.undoPartial', { ok: r.ok, failed: r.failed }) : t('history.undone'), r.failed ? 'error' : 'ok');
          }}
        >
          <IconUndo size={14} /> {t('common.undo')}
        </button>
      ) : null}
    </div>
  );
}
