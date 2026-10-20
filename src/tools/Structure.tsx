import { useEffect, useMemo, useState } from 'react';
import { t, fmtNum } from '../i18n';
import { call, useStore, updateSettings, setView, toast } from '../store';
import { Picker, ToolFrame, Done, Empty, Busy, errText } from '../components/kit';
import { Group, Row, Switch } from '../components/ui';
import { IconFolder, IconBolt, IconPlus, IconTrash, IconFolderTree } from '../icons';
import type { Automation, Template } from '../types';
import { basename, join } from '../paths';

type Plan = { dirs: { rel: string; exists: boolean }[]; dirCount: number; newDirs: number; files: number; skippedFiles: number; truncated: boolean; destExists: boolean };
const PRESET_TEMPLATES = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'pdf', 'txt', 'md'];


export function StructureTool({ paths }: { paths: string[] }) {
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const templates = useStore((s) => s.settings.templates);
  const [src, setSrc] = useState<string[]>(paths.slice(0, 1));
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [map, setMap] = useState<[string, string][]>([]);
  const [include, setInclude] = useState(false);
  const [exts, setExts] = useState('docx, xlsx, pptx, pdf');
  const [depth, setDepth] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; existed: number; copied: number; historyId?: string; dest: string } | null>(null);
  const [error, setError] = useState('');

  // Vorschlag aus dem Quellordner: Ziel daneben, Jahreszahl +1
  useEffect(() => {
    if (!src[0]) return;
    call<{ map: Record<string, string>; name: string; parent: string }>('structure:suggest', src[0]).then((s) => {
      setParent(s.parent);
      setMap(Object.entries(s.map));
      setName(s.name === basename(src[0]) ? `${s.name} – ${t('structure.copy')}` : s.name);
    });
  }, [src[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  const dest = parent && name ? join(parent, name) : '';
  const opts = useMemo(
    () => ({
      map: Object.fromEntries(map.filter(([a]) => a)),
      includeExt: include ? exts.split(/[\s,;]+/).filter(Boolean) : [],
      maxDepth: depth > 0 ? depth : undefined,
    }),
    [map, include, exts, depth],
  );

  useEffect(() => {
    setPlan(null);
    setError('');
    if (!src[0] || !dest) return;
    const id = setTimeout(() => {
      call<Plan>('structure:plan', src[0], dest, opts).then(setPlan, (e) => setError(errText(e)));
    }, 250);
    return () => clearTimeout(id);
  }, [src[0], dest, opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setBusy(true);
    try {
      setDone(await call('structure:apply', src[0], dest, opts, name));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const yearly = async () => {
    const a: Automation = { id: crypto.randomUUID(), type: 'year', enabled: true, parent, source: '', month: 1, day: 1, includeExt: opts.includeExt, lastYear: new Date().getFullYear() };
    await updateSettings({ automations: [...useStore.getState().settings.automations, a] });
    toast(t('structure.yearly.done'));
    setView({ kind: 'auto' });
  };

  const saveTemplate = async () => {
    const tpl = await call<Template>('templates:save', src[0], basename(src[0]));
    useStore.setState({ settings: { ...useStore.getState().settings, templates: [...templates, tpl] } });
    toast(t('structure.template.saved', { name: tpl.name }));
  };

  if (done) {
    return (
      <ToolFrame
        id="structure"
        side={null}
        main={
          <Done text={t('structure.done', { n: fmtNum(done.created) })} reveal={done.dest} historyId={done.historyId}>
            <p className="muted">
              {done.copied ? t('structure.done.copied', { n: done.copied }) + ' ' : ''}
              {done.existed > 1 ? t('structure.done.existed', { n: done.existed }) : ''}
            </p>
            <button className="btn ghost sm" onClick={yearly} style={{ marginTop: 6 }}>
              <IconBolt size={15} /> {t('structure.yearly')}
            </button>
          </Done>
        }
      />
    );
  }

  const hasYear = map.length > 0;
  return (
    <ToolFrame
      id="structure"
      side={
        <>
          <Picker mode="dir" paths={src} onChange={setSrc} label={t('structure.src')} testId="structure-src" />
          {src[0] && (
            <>
              <div className="section-label">{t('structure.dest')}</div>
              <div className="card pad">
                <label className="field">
                  <span>{t('structure.name')}</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="structure-name" />
                </label>
                <div className="row small muted" style={{ gap: 6, marginTop: 8 }}>
                  <IconFolder size={14} />
                  <span className="grow ellipsis" title={parent}>
                    {t('structure.in')} {basename(parent) || parent}
                  </span>
                  <button className="btn xs ghost" onClick={async () => (await call<string[]>('fs:pick', { dirs: true, multi: false })).forEach(setParent)}>
                    {t('pick.change')}
                  </button>
                </div>
              </div>

              <div className="section-label">{t('structure.replace')}</div>
              <div className="card pad">
                {map.map(([a, b], i) => (
                  <div className="row" style={{ gap: 6, marginBottom: 6 }} key={i}>
                    <input className="input" value={a} onChange={(e) => setMap(map.map((m, j) => (j === i ? [e.target.value, m[1]] : m)))} style={{ width: 0, flex: 1 }} />
                    <span className="faint">→</span>
                    <input className="input" value={b} onChange={(e) => setMap(map.map((m, j) => (j === i ? [m[0], e.target.value] : m)))} style={{ width: 0, flex: 1 }} data-testid={`structure-to-${i}`} />
                    <button className="btn icon ghost xs" onClick={() => setMap(map.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
                {!hasYear && <p className="small muted" style={{ margin: '0 0 8px' }}>{t('structure.replace.none')}</p>}
                <button className="btn xs ghost" onClick={() => setMap([...map, ['', '']])}>
                  <IconPlus size={13} /> {t('structure.replace.add')}
                </button>
              </div>

              <Group>
                <Row label={t('structure.include')} desc={t('structure.include.desc')}>
                  <Switch on={include} onChange={setInclude} testId="structure-include" />
                </Row>
                {include && (
                  <div style={{ padding: '0 14px 12px' }}>
                    <input className="input" value={exts} onChange={(e) => setExts(e.target.value)} placeholder={PRESET_TEMPLATES.join(', ')} />
                  </div>
                )}
                {expert && (
                  <Row label={t('structure.depth')} desc={t('structure.depth.desc')}>
                    <select className="select" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                      <option value={0}>{t('structure.depth.all')}</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </Row>
                )}
              </Group>
            </>
          )}
          <TemplateList parentHint={parent} />
        </>
      }
      main={
        !src[0] ? (
          <Empty icon={<IconFolderTree size={40} />} text={t('structure.empty')} />
        ) : error ? (
          <Empty text={error} />
        ) : !plan ? (
          <Busy />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('structure.preview', { n: fmtNum(plan.newDirs) })}</b>
              <span className="muted small">
                {plan.files ? t('structure.preview.files', { n: fmtNum(plan.files) }) + ' · ' : ''}
                {t('structure.preview.skipped', { n: fmtNum(plan.skippedFiles) })}
              </span>
            </div>
            {plan.destExists && <div className="banner info small">{t('structure.merge')}</div>}
            <div className="tree" data-testid="structure-tree">
              <div className="tree-row root">
                <IconFolder size={15} /> <b>{name}</b>
              </div>
              {plan.dirs.slice(0, 600).map((d) => {
                const depthN = d.rel.split('/').length;
                return (
                  <div className={`tree-row ${d.exists ? 'exists' : ''}`} key={d.rel} style={{ paddingLeft: 10 + depthN * 18 }}>
                    <IconFolder size={14} />
                    <span className="ellipsis">{d.rel.split('/').pop()}</span>
                    {d.exists && <span className="badge">{t('structure.exists')}</span>}
                  </div>
                );
              })}
              {plan.dirs.length > 600 && <div className="faint small" style={{ padding: 10 }}>{t('pick.more', { n: plan.dirCount - 600 })}</div>}
              {!plan.dirs.length && <p className="muted small" style={{ padding: 12 }}>{t('structure.noDirs')}</p>}
            </div>
          </div>
        )
      }
      foot={
        src[0] && (
          <>
            {expert && (
              <button className="btn ghost" onClick={saveTemplate} disabled={!src[0]}>
                {t('structure.template.save')}
              </button>
            )}
            <button className="btn ghost" onClick={yearly} disabled={!hasYear} title={t('structure.yearly.desc')}>
              <IconBolt size={15} /> {t('structure.yearly')}
            </button>
            <div className="spacer" />
            <button className="btn primary lg" disabled={!plan || busy || (!plan.newDirs && !plan.files)} onClick={apply} data-testid="structure-apply">
              {busy ? t('common.working') : t('structure.apply')}
            </button>
          </>
        )
      }
    />
  );
}

/** Gespeicherte Vorlagen: überall neu anlegen */
function TemplateList({ parentHint }: { parentHint: string }) {
  const templates = useStore((s) => s.settings.templates);
  const [busy, setBusy] = useState('');
  if (!templates.length) return null;
  const use = async (tpl: Template) => {
    const [dir] = await call<string[]>('fs:pick', { dirs: true, multi: false, defaultPath: parentHint || undefined });
    if (!dir) return;
    setBusy(tpl.id);
    try {
      const r = await call<{ created: number; dest: string; historyId?: string }>('templates:apply', tpl.id, dir, tpl.name);
      toast(t('structure.done', { n: r.created }), 'ok', r.historyId);
      call('fs:reveal', r.dest);
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <div className="section-label">{t('structure.templates')}</div>
      <div className="card">
        {templates.map((tpl) => (
          <div className="list-row" key={tpl.id}>
            <IconFolderTree size={16} />
            <div className="grow">
              <div className="ellipsis">{tpl.name}</div>
              <div className="faint small">{t('structure.template.count', { n: tpl.dirs.length })}</div>
            </div>
            <button className="btn xs" disabled={busy === tpl.id} onClick={() => use(tpl)}>
              {t('structure.template.use')}
            </button>
            <button
              className="btn icon ghost xs"
              aria-label={t('common.remove')}
              onClick={async () => {
                const list = await call<Template[]>('templates:remove', tpl.id);
                useStore.setState({ settings: { ...useStore.getState().settings, templates: list } });
              }}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
