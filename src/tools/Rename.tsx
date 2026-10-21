import { useEffect, useMemo, useState } from 'react';
import { t, fmtNum } from '../i18n';
import { call, toast } from '../store';
import { Picker, ToolPage, Step, More, Choices, Done, Busy, useFiles, errText, Thumb, FoundStrip } from '../components/kit';
import { Seg, Switch } from '../components/ui';
import { IconNumbers, IconSwap, IconCalendar, IconTextCase, IconSliders, IconArrowRight } from '../icons';

type Preset = 'number' | 'replace' | 'date' | 'case' | 'custom';
type Res = { from: string; to: string; name: string; changed: boolean; conflict: boolean; error?: string };

const TOKENS = ['{name}', '{n}', '{date}', '{time}', '{year}', '{month}', '{day}', '{folder}'];

export function RenameTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const [folders, setFolders] = useState(false);
  const all = useFiles(paths, false);
  const hasDirs = !!all?.some((f) => f.isDir);
  const files = useFiles(paths, folders ? false : {});
  const targets = useMemo(() => (files || []).filter((f) => (folders ? true : !f.isDir)).map((f) => f.path), [files, folders]);
  const byPath = useMemo(() => new Map((files || []).map((f) => [f.path, f])), [files]);

  const [preset, setPreset] = useState<Preset>('number');
  const [base, setBase] = useState('');
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [regex, setRegex] = useState(false);
  const [tpl, setTpl] = useState('{name}');
  const [caseMode, setCase] = useState<'keep' | 'lower' | 'upper' | 'title'>('title');
  const [extCase, setExtCase] = useState<'keep' | 'lower' | 'upper'>('lower');
  const [spaces, setSpaces] = useState<'keep' | 'underscore' | 'dash' | 'remove'>('keep');
  const [start, setStart] = useState(1);
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');
  const [preview, setPreview] = useState<Res[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ done: number; failed: unknown[]; historyId?: string; renamed: string[] } | null>(null);

  // Vorschlag für den neuen Namen: Name des Ordners ("Urlaub Italien")
  useEffect(() => {
    if (!base && files?.length) setBase((files[0].dir.split(/[\\/]/).pop() || '').replace(/^\d{4}-\d{2}\s*/, ''));
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = useMemo(() => {
    const o: Record<string, unknown> = { extCase, sortBy, start, case: 'keep', spaces: 'keep' };
    if (preset === 'number') o.template = (base.trim() || '{name}') + ' {n}';
    else if (preset === 'replace') Object.assign(o, { template: '{name}', find, replace: repl, regex });
    else if (preset === 'date') o.template = '{date} {name}';
    else if (preset === 'case') Object.assign(o, { template: '{name}', case: caseMode, spaces });
    else Object.assign(o, { template: tpl, find, replace: repl, regex, case: caseMode, spaces });
    if (preset === 'date' || /\{(date|time|year|month|day)\}/.test(String(o.template))) o.sortBy = 'date';
    return o;
  }, [preset, base, find, repl, regex, tpl, caseMode, extCase, spaces, start, sortBy]);

  useEffect(() => {
    setPreview(null);
    if (!targets.length) return;
    const id = setTimeout(() => call<Res[]>('rename:preview', targets, opts).then(setPreview), 200);
    return () => clearTimeout(id);
  }, [targets, opts]);

  const changed = preview?.filter((r) => r.changed).length ?? 0;
  const regexError = preview?.some((r) => r.error);
  const ex = preview?.find((r) => r.changed) || preview?.[0];

  const apply = async () => {
    setBusy(true);
    try {
      setDone(await call('rename:apply', targets, opts, t('rename.title', { n: changed })));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <ToolPage id="rename" compact>
        <Done text={t('rename.done', { n: fmtNum(done.done) })} reveal={done.renamed[0]} historyId={done.historyId}>
          {done.failed.length > 0 && <p className="muted">{t('rename.failed', { n: done.failed.length })}</p>}
        </Done>
      </ToolPage>
    );
  }

  const ready = targets.length > 0;
  return (
    <ToolPage
      id="rename"
      foot={
        <>
          <div className="foot-sum">
            {ready ? (
              <>
                <b>{t('rename.preview', { n: fmtNum(changed), total: fmtNum(targets.length) })}</b>
                <span>{t('common.undoHint')}</span>
              </>
            ) : (
              <span>{t('rename.foot.empty')}</span>
            )}
          </div>
          <button className="btn primary xl" disabled={!changed || busy || regexError} onClick={apply} data-testid="rename-apply">
            {busy ? t('common.working') : t('rename.apply', { n: fmtNum(changed) })}
          </button>
        </>
      }
    >
      <Step n={1} title={t('rename.s1')} hint={t('rename.s1.hint')}>
        <Picker mode="files" paths={paths} onChange={setPaths} empty={t('rename.pick')} testId="rename-pick" />
        {hasDirs && (
          <label className="inline-switch">
            <Switch on={folders} onChange={setFolders} /> {t('rename.folders')}
          </label>
        )}
        {hasDirs && !folders && files && <FoundStrip files={files.filter((f) => !f.isDir)} />}
        {files && paths.length > 0 && !targets.length && <div className="banner warn small" style={{ marginTop: 10 }}>{t('rename.none')}</div>}
      </Step>

      <Step n={2} title={t('rename.s2')} disabled={!ready}>
        <Choices<Preset>
          value={preset}
          onChange={setPreset}
          cols={3}
          testPrefix="rename"
          options={[
            { id: 'number', icon: <IconNumbers size={20} />, title: t('rename.p.number'), desc: t('rename.p.number.ex') },
            { id: 'replace', icon: <IconSwap size={20} />, title: t('rename.p.replace'), desc: t('rename.p.replace.ex') },
            { id: 'date', icon: <IconCalendar size={20} />, title: t('rename.p.date'), desc: t('rename.p.date.ex') },
            { id: 'case', icon: <IconTextCase size={20} />, title: t('rename.p.case'), desc: t('rename.p.case.ex') },
            { id: 'custom', icon: <IconSliders size={20} />, title: t('rename.p.custom'), desc: t('rename.p.custom.ex') },
          ]}
        />
        <div className="opt-block" style={{ marginTop: 12 }}>
          {preset === 'number' && (
            <label className="field">
              <span>{t('rename.base')}</span>
              <input className="input big-input" value={base} onChange={(e) => setBase(e.target.value)} placeholder={t('rename.base.ph')} data-testid="rename-base" />
            </label>
          )}
          {(preset === 'replace' || preset === 'custom') && (
            <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
              <label className="field grow">
                <span>{t('rename.find')}</span>
                <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="IMG_" data-testid="rename-find" />
              </label>
              <IconArrowRight size={18} className="faint" style={{ marginBottom: 18 }} />
              <label className="field grow">
                <span>{t('rename.replaceWith')}</span>
                <input className="input" value={repl} onChange={(e) => setRepl(e.target.value)} placeholder={t('rename.replace.empty')} data-testid="rename-repl" />
              </label>
            </div>
          )}
          {preset === 'custom' && (
            <label className="field">
              <span>{t('rename.template')}</span>
              <input className="input mono" value={tpl} onChange={(e) => setTpl(e.target.value)} />
              <div className="token-row">
                {TOKENS.map((k) => (
                  <button key={k} className="chip" onClick={() => setTpl(tpl + k)} title={t(`rename.token.${k.slice(1, -1)}` as 'rename.token.name')}>
                    {k}
                  </button>
                ))}
              </div>
            </label>
          )}
          {(preset === 'case' || preset === 'custom') && (
            <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
              <label className="field">
                <span>{t('rename.case')}</span>
                <Seg value={caseMode} onChange={setCase} options={[['keep', t('rename.case.keep')], ['lower', 'abc'], ['upper', 'ABC'], ['title', 'Abc Def']]} />
              </label>
              <label className="field">
                <span>{t('rename.spaces')}</span>
                <Seg value={spaces} onChange={setSpaces} options={[['keep', t('rename.case.keep')], ['underscore', 'a_b'], ['dash', 'a-b'], ['remove', 'ab']]} />
              </label>
            </div>
          )}
          {preset === 'date' && <p className="small muted" style={{ margin: 0 }}>{t('rename.date.hint')}</p>}
          {regexError && <div className="small" style={{ color: 'var(--danger)' }}>{t('rename.regex.error')}</div>}
          {ex && (
            <div className="example">
              <span className="muted">{t('common.example')}</span>
              <span className="ex-old">{ex.from.split(/[\\/]/).pop()}</span>
              <IconArrowRight size={15} className="faint" />
              <b className="ex-new">{ex.name}</b>
            </div>
          )}
        </div>
        <More>
          <div className="opt-row">
            <div className="grow opt-title">{t('rename.ext')}</div>
            <Seg value={extCase} onChange={setExtCase} options={[['keep', t('rename.case.keep')], ['lower', '.jpg'], ['upper', '.JPG']]} />
          </div>
          <div className="opt-row">
            <div className="grow opt-title">{t('rename.order')}</div>
            <Seg value={sortBy} onChange={setSortBy} options={[['name', t('rename.order.name')], ['date', t('rename.order.date')]]} />
          </div>
          <div className="opt-row">
            <div className="grow opt-title">{t('rename.start')}</div>
            <input className="input" type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} style={{ width: 90 }} />
          </div>
          {(preset === 'replace' || preset === 'custom') && (
            <label className="check" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> {t('rename.regex')}
            </label>
          )}
        </More>
      </Step>

      <Step n={3} title={t('rename.s3')} disabled={!ready} right={preview?.some((r) => r.conflict) ? <span className="badge warn">{t('rename.conflicts')}</span> : undefined}>
        {!preview ? (
          <Busy />
        ) : (
          <div className="table rename-table" data-testid="rename-preview">
            <div className="trow head">
              <span className="grow">{t('common.before')}</span>
              <span className="grow">{t('common.after')}</span>
            </div>
            {preview.slice(0, 600).map((r) => {
              const f = byPath.get(r.from);
              return (
                <div className={`trow ${r.changed ? 'changed' : ''}`} key={r.from}>
                  {f && <Thumb file={f} size={28} />}
                  <span className="ellipsis old">{r.from.split(/[\\/]/).pop()}</span>
                  <IconArrowRight size={14} className="arrow" />
                  <span className="ellipsis new">{r.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </Step>
    </ToolPage>
  );
}
