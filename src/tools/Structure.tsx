import { useEffect, useMemo, useState } from 'react';
import { t, fmtNum } from '../i18n';
import { call, useStore, updateSettings, setView, toast } from '../store';
import { Picker, ToolPage, Step, More, Done, Busy, errText } from '../components/kit';
import { Seg, Switch } from '../components/ui';
import { ArtAuto } from '../components/art';
import { IconFolder, IconBolt, IconPlus, IconTrash, IconArrowRight, IconCheck } from '../icons';
import type { Automation, Template } from '../types';
import { basename, join } from '../paths';
import { builtInTemplates } from '../lib/templates';

type Plan = { dirs: { rel: string; exists: boolean }[]; dirCount: number; newDirs: number; files: number; skippedFiles: number; truncated: boolean; destExists: boolean };
type Source = 'folder' | 'template';
type DoneInfo = { created: number; existed: number; copied: number; historyId?: string; dest: string };

export function StructureTool({ paths }: { paths: string[] }) {
  const app = useStore((s) => s.app);
  const myTemplates = useStore((s) => s.settings.templates);
  const [source, setSource] = useState<Source>('folder');
  const [src, setSrc] = useState<string[]>(paths.slice(0, 1));
  const [tplId, setTplId] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [map, setMap] = useState<[string, string][]>([]);
  const [include, setInclude] = useState(false);
  const [exts, setExts] = useState('docx, xlsx, pptx, pdf');
  const [depth, setDepth] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [error, setError] = useState('');

  const builtIns = useMemo(() => builtInTemplates(), []);
  const templates = useMemo(() => [...myTemplates.map((x) => ({ id: x.id, name: x.name, dirs: x.dirs, color: '#64748b', mine: true })), ...builtIns.map((x) => ({ ...x, mine: false }))], [myTemplates, builtIns]);
  const tpl = templates.find((x) => x.id === tplId);

  // Vorschlag aus dem Quellordner: Ziel daneben, Jahreszahl +1
  useEffect(() => {
    if (source !== 'folder' || !src[0]) return;
    call<{ map: Record<string, string>; name: string; parent: string }>('structure:suggest', src[0]).then((s) => {
      setParent(s.parent);
      setMap(Object.entries(s.map));
      setName(s.name === basename(src[0]) ? `${s.name} – ${t('structure.copy')}` : s.name);
    });
  }, [src[0], source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (source !== 'template' || !tpl) return;
    setName(tpl.name);
    if (!parent) setParent(app.documents);
  }, [tplId, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const dest = parent && name.trim() ? join(parent, name.trim()) : '';
  const opts = useMemo(
    () => ({ map: Object.fromEntries(map.filter(([a]) => a)), includeExt: include ? exts.split(/[\s,;]+/).filter(Boolean) : [], maxDepth: depth > 0 ? depth : undefined }),
    [map, include, exts, depth],
  );

  useEffect(() => {
    setPlan(null);
    setError('');
    if (source !== 'folder' || !src[0] || !dest) return;
    const id = setTimeout(() => call<Plan>('structure:plan', src[0], dest, opts).then(setPlan, (e) => setError(errText(e))), 250);
    return () => clearTimeout(id);
  }, [src[0], dest, opts, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = source === 'folder' ? !!src[0] : !!tpl;
  const newCount = source === 'folder' ? plan?.newDirs ?? 0 : tpl ? tpl.dirs.length : 0;

  const apply = async () => {
    setBusy(true);
    try {
      if (source === 'folder') setDone(await call('structure:apply', src[0], dest, opts, name));
      else setDone(await call('structure:create', dest, tpl!.dirs, name));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const yearly = async (p = parent) => {
    const a: Automation = { id: crypto.randomUUID(), type: 'year', enabled: true, parent: p, source: '', month: 1, day: 1, includeExt: opts.includeExt, lastYear: new Date().getFullYear() };
    await updateSettings({ automations: [...useStore.getState().settings.automations, a] });
    toast(t('structure.yearly.done'));
    setView({ kind: 'auto' });
  };

  if (done) {
    return (
      <ToolPage id="structure" compact>
        <Done text={t('structure.done', { n: fmtNum(done.created) })} reveal={done.dest} historyId={done.historyId}>
          <p className="muted">
            {t('structure.done.where', { name: basename(done.dest) })} {done.copied ? t('structure.done.copied', { n: done.copied }) : ''}
          </p>
          {map.length > 0 && source === 'folder' && (
            <div className="offer-card">
              <div className="offer-art">
                <ArtAuto />
              </div>
              <div className="grow">
                <b>{t('structure.offer.title')}</b>
                <p className="muted small">{t('structure.offer.text')}</p>
                <button className="btn sm primary" onClick={() => yearly(parent)} data-testid="offer-yearly">
                  <IconBolt size={14} /> {t('structure.yearly')}
                </button>
              </div>
            </div>
          )}
        </Done>
      </ToolPage>
    );
  }

  return (
    <ToolPage
      id="structure"
      foot={
        <>
          <div className="foot-sum">
            {ready && dest ? (
              <>
                <b>
                  {source === 'folder' && plan?.destExists
                    ? newCount
                      ? t('structure.foot.merge', { name: name.trim(), n: fmtNum(newCount) })
                      : t('structure.foot.nothing', { name: name.trim() })
                    : t('structure.foot', { name: name.trim(), n: fmtNum(newCount) })}
                </b>
                <span>{t('structure.foot.sub', { dir: basename(parent) || parent })}</span>
              </>
            ) : (
              <span>{t('structure.foot.empty')}</span>
            )}
          </div>
          <button className="btn primary xl" disabled={!ready || !dest || busy || (source === 'folder' && (!plan || (!plan.newDirs && !plan.files)))} onClick={apply} data-testid="structure-apply">
            {busy ? t('common.working') : t('structure.apply')}
          </button>
        </>
      }
    >
      <Step n={1} title={t('structure.s1')} hint={t('structure.s1.hint')}>
        <Seg
          value={source}
          onChange={setSource}
          options={[
            ['folder', t('structure.src.folder')],
            ['template', t('structure.src.template')],
          ]}
        />
        <div style={{ marginTop: 14 }}>
          {source === 'folder' ? (
            <Picker mode="dir" paths={src} onChange={setSrc} empty={t('structure.pick')} hint={t('structure.pick.hint')} testId="structure-src" />
          ) : (
            <div className="tpl-grid" data-testid="structure-templates">
              {templates.map((x) => (
                <button key={x.id} className={`tpl-card ${tplId === x.id ? 'on' : ''}`} onClick={() => setTplId(x.id)}>
                  <span className="tpl-ic" style={{ background: x.color }}>
                    <IconFolder size={18} />
                  </span>
                  <b className="ellipsis">{x.name}</b>
                  <span className="tpl-dirs">{x.dirs.slice(0, 4).map((d) => d.split('/').pop()).join(' · ')}{x.dirs.length > 4 ? ' …' : ''}</span>
                  {x.mine && <span className="badge">{t('structure.template.mine')}</span>}
                  {tplId === x.id && (
                    <span className="tpl-check">
                      <IconCheck size={12} strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </Step>

      <Step n={2} title={t('structure.s2')} hint={source === 'folder' ? t('structure.s2.hint') : undefined} disabled={!ready}>
        <input className="input big-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="structure-name" />
        <div className="where-row">
          <IconFolder size={15} />
          <span className="grow ellipsis" title={parent}>
            {t('structure.in')} <b>{basename(parent) || parent}</b>
          </span>
          <button className="btn sm ghost" onClick={async () => (await call<string[]>('fs:pick', { dirs: true, multi: false })).forEach(setParent)}>
            {t('structure.otherPlace')}
          </button>
        </div>
        {source === 'folder' && map.length > 0 && (
          <div className="year-chips">
            {map.map(([a, b]) => (
              <span className="year-chip" key={a}>
                <IconCheck size={13} strokeWidth={3} /> {t('structure.year.auto', { from: a, to: b })}
              </span>
            ))}
          </div>
        )}
        {source === 'folder' && (
          <More>
            <div className="opt-block">
              <div className="opt-title">{t('structure.replace')}</div>
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                {map.length ? t('structure.replace.desc') : t('structure.replace.none')}
              </p>
              {map.map(([a, b], i) => (
                <div className="row" style={{ gap: 6, marginBottom: 6 }} key={i}>
                  <input className="input" value={a} onChange={(e) => setMap(map.map((m, j) => (j === i ? [e.target.value, m[1]] : m)))} style={{ width: 0, flex: 1 }} />
                  <IconArrowRight size={14} className="faint" />
                  <input className="input" value={b} onChange={(e) => setMap(map.map((m, j) => (j === i ? [m[0], e.target.value] : m)))} style={{ width: 0, flex: 1 }} data-testid={`structure-to-${i}`} />
                  <button className="btn icon ghost xs" onClick={() => setMap(map.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
              <button className="btn xs ghost" onClick={() => setMap([...map, ['', '']])}>
                <IconPlus size={13} /> {t('structure.replace.add')}
              </button>
            </div>
            <div className="opt-row">
              <div className="grow">
                <div className="opt-title">{t('structure.include')}</div>
                <div className="small muted">{t('structure.include.desc')}</div>
                {include && <input className="input" style={{ marginTop: 8 }} value={exts} onChange={(e) => setExts(e.target.value)} />}
              </div>
              <Switch on={include} onChange={setInclude} testId="structure-include" />
            </div>
            <div className="opt-row">
              <div className="grow">
                <div className="opt-title">{t('structure.depth')}</div>
                <div className="small muted">{t('structure.depth.desc')}</div>
              </div>
              <select className="select" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                <option value={0}>{t('structure.depth.all')}</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="opt-row">
              <div className="grow">
                <div className="opt-title">{t('structure.template.save')}</div>
                <div className="small muted">{t('structure.template.save.desc')}</div>
              </div>
              <button
                className="btn sm"
                onClick={async () => {
                  const tplNew = await call<Template>('templates:save', src[0], basename(src[0]));
                  useStore.setState({ settings: { ...useStore.getState().settings, templates: [...myTemplates, tplNew] } });
                  toast(t('structure.template.saved', { name: tplNew.name }));
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </More>
        )}
      </Step>

      <Step n={3} title={t('structure.s3')} disabled={!ready || !dest}>
        {source === 'folder' ? (
          error ? (
            <div className="banner warn">{error}</div>
          ) : !plan ? (
            <Busy />
          ) : (
            <>
              <div className="compare">
                <div className="cmp-card">
                  <span className="cmp-label">{t('common.before')}</span>
                  <div className="cmp-name">
                    <IconFolder size={18} /> {basename(src[0])}
                  </div>
                  <div className="small muted">{t('structure.cmp.src', { d: fmtNum(plan.dirCount), f: fmtNum(plan.files + plan.skippedFiles) })}</div>
                </div>
                <IconArrowRight size={22} className="cmp-arrow" />
                <div className="cmp-card new">
                  <span className="cmp-label">{t('common.after')}</span>
                  <div className="cmp-name">
                    <IconFolder size={18} /> {name}
                  </div>
                  <div className="small">{t('structure.cmp.dest', { d: fmtNum(plan.dirCount), f: fmtNum(plan.files) })}</div>
                </div>
              </div>
              {plan.destExists && <div className="banner info small">{t('structure.merge')}</div>}
              <Tree name={name} dirs={plan.dirs} total={plan.dirCount} />
            </>
          )
        ) : (
          tpl && <Tree name={name} dirs={tpl.dirs.map((rel) => ({ rel, exists: false }))} total={tpl.dirs.length} />
        )}
      </Step>
    </ToolPage>
  );
}

function Tree({ name, dirs, total }: { name: string; dirs: { rel: string; exists: boolean }[]; total: number }) {
  return (
    <div className="tree" data-testid="structure-tree">
      <div className="tree-row root">
        <IconFolder size={16} /> <b>{name}</b>
      </div>
      {dirs.slice(0, 500).map((d) => {
        const depthN = d.rel.split('/').length;
        return (
          <div className={`tree-row ${d.exists ? 'exists' : ''}`} key={d.rel} style={{ paddingLeft: 12 + depthN * 20 }}>
            <IconFolder size={15} />
            <span className="ellipsis">{d.rel.split('/').pop()}</span>
            {d.exists && <span className="badge">{t('structure.exists')}</span>}
          </div>
        );
      })}
      {dirs.length > 500 && <div className="faint small" style={{ padding: 10 }}>{t('pick.more', { n: total - 500 })}</div>}
      {!dirs.length && <p className="muted small" style={{ padding: 12 }}>{t('structure.noDirs')}</p>}
    </div>
  );
}
