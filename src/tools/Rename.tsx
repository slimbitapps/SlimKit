import { useEffect, useMemo, useState } from 'react';
import { t, fmtNum, type TKey } from '../i18n';
import { call, useStore, toast } from '../store';
import { Picker, ToolFrame, Done, Empty, Busy, useFiles, errText, KindIcon } from '../components/kit';
import { Group, Row, Seg, Switch } from '../components/ui';
import { IconRename } from '../icons';

type Preset = 'number' | 'replace' | 'date' | 'case' | 'custom';
type Res = { from: string; to: string; name: string; changed: boolean; conflict: boolean; error?: string };

const TOKENS = ['{name}', '{n}', '{date}', '{time}', '{year}', '{month}', '{day}', '{folder}'];

export function RenameTool({ paths: initial }: { paths: string[] }) {
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const [paths, setPaths] = useState(initial);
  const [folders, setFolders] = useState(false);
  const all = useFiles(paths, false);
  const hasDirs = !!all?.some((f) => f.isDir);
  const files = useFiles(paths, folders ? false : {});
  const targets = useMemo(() => (files || []).filter((f) => (folders ? true : !f.isDir)).map((f) => f.path), [files, folders]);

  const [preset, setPreset] = useState<Preset>('number');
  const [base, setBase] = useState('');
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [regex, setRegex] = useState(false);
  const [tpl, setTpl] = useState('{name}');
  const [caseMode, setCase] = useState<'keep' | 'lower' | 'upper' | 'title'>('keep');
  const [extCase, setExtCase] = useState<'keep' | 'lower' | 'upper'>('lower');
  const [spaces, setSpaces] = useState<'keep' | 'underscore' | 'dash' | 'remove'>('keep');
  const [start, setStart] = useState(1);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'given'>('name');
  const [preview, setPreview] = useState<Res[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ done: number; failed: unknown[]; historyId?: string; renamed: string[] } | null>(null);

  // Vorschlag für den neuen Namen: Name des Ordners ("Urlaub Italien")
  useEffect(() => {
    if (!base && files?.length) setBase(files[0].dir.split(/[\\/]/).pop() || '');
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = useMemo(() => {
    const o: Record<string, unknown> = { extCase, sortBy, start, case: 'keep', spaces: 'keep' };
    if (preset === 'number') o.template = (base.trim() || '{name}') + ' {n}';
    else if (preset === 'replace') Object.assign(o, { template: '{name}', find, replace: repl, regex });
    else if (preset === 'date') o.template = '{date} {name}';
    else if (preset === 'case') Object.assign(o, { template: '{name}', case: caseMode, spaces });
    else Object.assign(o, { template: tpl, find, replace: repl, regex, case: caseMode, spaces });
    if (preset === 'date' || /\{(date|time|year|month|day)\}/.test(String(o.template))) o.sortBy = sortBy === 'name' ? 'date' : sortBy;
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
      <ToolFrame
        id="rename"
        side={null}
        main={
          <Done text={t('rename.done', { n: fmtNum(done.done) })} reveal={done.renamed[0]} historyId={done.historyId}>
            {done.failed.length > 0 && <p className="muted">{t('rename.failed', { n: done.failed.length })}</p>}
          </Done>
        }
      />
    );
  }

  const presets: [Preset, string][] = [
    ['number', t('rename.p.number')],
    ['replace', t('rename.p.replace')],
    ['date', t('rename.p.date')],
    ['case', t('rename.p.case')],
    ...(expert ? ([['custom', t('rename.p.custom')]] as [Preset, string][]) : []),
  ];

  return (
    <ToolFrame
      id="rename"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('pick.what')} testId="rename-pick" />
          {hasDirs && (
            <Group>
              <Row label={t('rename.folders')} desc={t('rename.folders.desc')}>
                <Switch on={folders} onChange={setFolders} />
              </Row>
            </Group>
          )}
          {targets.length > 0 && (
            <>
              <div className="section-label">{t('rename.how')}</div>
              <div className="preset-list cols-2">
                {presets.map(([id, label]) => (
                  <button key={id} className={`preset ${preset === id ? 'on' : ''}`} onClick={() => setPreset(id)} data-testid={`rename-${id}`}>
                    <b>{label}</b>
                    <span>{t(`rename.p.${id}.ex` as TKey)}</span>
                  </button>
                ))}
              </div>
              <div className="card pad" style={{ marginTop: 10 }}>
                {preset === 'number' && (
                  <label className="field">
                    <span>{t('rename.base')}</span>
                    <input className="input" value={base} onChange={(e) => setBase(e.target.value)} data-testid="rename-base" />
                  </label>
                )}
                {(preset === 'replace' || preset === 'custom') && (
                  <>
                    <label className="field">
                      <span>{t('rename.find')}</span>
                      <input className="input" value={find} onChange={(e) => setFind(e.target.value)} data-testid="rename-find" />
                    </label>
                    <label className="field">
                      <span>{t('rename.replaceWith')}</span>
                      <input className="input" value={repl} onChange={(e) => setRepl(e.target.value)} placeholder={t('rename.replace.empty')} data-testid="rename-repl" />
                    </label>
                    {expert && (
                      <label className="check">
                        <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> {t('rename.regex')}
                      </label>
                    )}
                    {regexError && <div className="small" style={{ color: 'var(--danger)' }}>{t('rename.regex.error')}</div>}
                  </>
                )}
                {preset === 'custom' && (
                  <label className="field">
                    <span>{t('rename.template')}</span>
                    <input className="input mono" value={tpl} onChange={(e) => setTpl(e.target.value)} />
                    <div className="token-row">
                      {TOKENS.map((k) => (
                        <button key={k} className="chip" onClick={() => setTpl(tpl + k)}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </label>
                )}
                {(preset === 'case' || preset === 'custom') && (
                  <>
                    <label className="field">
                      <span>{t('rename.case')}</span>
                      <Seg value={caseMode} onChange={setCase} options={[['keep', t('rename.case.keep')], ['lower', 'abc'], ['upper', 'ABC'], ['title', 'Abc']]} />
                    </label>
                    <label className="field">
                      <span>{t('rename.spaces')}</span>
                      <Seg value={spaces} onChange={setSpaces} options={[['keep', t('rename.case.keep')], ['underscore', 'a_b'], ['dash', 'a-b'], ['remove', 'ab']]} />
                    </label>
                  </>
                )}
                {preset === 'date' && <p className="small muted" style={{ margin: 0 }}>{t('rename.date.hint')}</p>}
              </div>
              {expert && (
                <Group>
                  <Row label={t('rename.ext')}>
                    <Seg value={extCase} onChange={setExtCase} options={[['keep', t('rename.case.keep')], ['lower', '.jpg'], ['upper', '.JPG']]} />
                  </Row>
                  <Row label={t('rename.order')}>
                    <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'name')}>
                      <option value="name">{t('rename.order.name')}</option>
                      <option value="date">{t('rename.order.date')}</option>
                    </select>
                  </Row>
                  <Row label={t('rename.start')}>
                    <input className="input" type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} style={{ width: 80 }} />
                  </Row>
                </Group>
              )}
            </>
          )}
        </>
      }
      main={
        !paths.length ? (
          <Empty icon={<IconRename size={40} />} text={t('rename.empty')} />
        ) : !files || (targets.length > 0 && !preview) ? (
          <Busy />
        ) : !targets.length ? (
          <Empty text={t('rename.none')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('rename.preview', { n: fmtNum(changed), total: fmtNum(targets.length) })}</b>
              {preview!.some((r) => r.conflict) && <span className="badge warn">{t('rename.conflicts')}</span>}
            </div>
            <div className="table" data-testid="rename-preview">
              {preview!.slice(0, 800).map((r) => (
                <div className={`trow ${r.changed ? 'changed' : ''}`} key={r.from}>
                  <KindIcon kind={folders ? 'folder' : 'other'} size={14} />
                  <span className="ellipsis old">{r.from.split(/[\\/]/).pop()}</span>
                  <span className="arrow">→</span>
                  <span className="ellipsis new">{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
      foot={
        targets.length > 0 && (
          <>
            <span className="muted small">{t('common.undoHint')}</span>
            <div className="spacer" />
            <button className="btn primary lg" disabled={!changed || busy || regexError} onClick={apply} data-testid="rename-apply">
              {busy ? t('common.working') : t('rename.apply', { n: fmtNum(changed) })}
            </button>
          </>
        )
      }
    />
  );
}
