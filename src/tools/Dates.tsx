import { useEffect, useMemo, useState } from 'react';
import { t, fmtDate, fmtNum, type TKey } from '../i18n';
import { call, toast } from '../store';
import { Picker, ToolFrame, Done, Empty, Busy, useFiles, errText } from '../components/kit';
import { Group, Row, Seg, Switch } from '../components/ui';
import { IconCalendar } from '../icons';

type Mode = 'taken' | 'name' | 'fixed' | 'shift';
type Prev = { path: string; old: { mtimeMs: number; birthtimeMs: number }; next: number | null };

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function DatesTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const [recursive, setRecursive] = useState(false);
  const files = useFiles(paths, { recursive });
  const targets = useMemo(() => (files || []).map((f) => f.path), [files]);
  const [mode, setMode] = useState<Mode>('taken');
  const [fixed, setFixed] = useState(localInput(new Date()));
  const [hours, setHours] = useState(0);
  const [mins, setMins] = useState(0);
  const [which, setWhich] = useState<'both' | 'modified' | 'created'>('both');
  const [preview, setPreview] = useState<Prev[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ done: number; createdFailed: number; historyId?: string } | null>(null);
  const opts = useMemo(() => ({ mode, date: mode === 'fixed' ? new Date(fixed).getTime() : undefined, minutes: hours * 60 + mins }), [mode, fixed, hours, mins]);

  useEffect(() => {
    setPreview(null);
    if (!targets.length) return;
    const id = setTimeout(() => call<Prev[]>('dates:preview', targets, opts).then(setPreview), 200);
    return () => clearTimeout(id);
  }, [targets, opts]);

  const found = preview?.filter((p) => p.next).length ?? 0;
  const isMac = window.api.platform === 'darwin';
  const apply = async () => {
    setBusy(true);
    try {
      setDone(await call('dates:apply', targets, opts, which, t('dates.title', { n: found })));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <ToolFrame
        id="dates"
        side={null}
        main={
          <Done text={t('dates.done', { n: fmtNum(done.done) })} reveal={targets[0]} historyId={done.historyId}>
            {done.createdFailed > 0 && <p className="muted">{t(isMac ? 'dates.createdFailed.mac' : 'dates.createdFailed', { n: done.createdFailed })}</p>}
          </Done>
        }
      />
    );
  }

  return (
    <ToolFrame
      id="dates"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('pick.what')} testId="dates-pick" />
          {files?.length !== undefined && paths.length > 0 && (
            <Group>
              <Row label={t('common.subfolders')}>
                <Switch on={recursive} onChange={setRecursive} />
              </Row>
            </Group>
          )}
          <div className="section-label">{t('dates.source')}</div>
          <div className="preset-list cols-2">
            {(['taken', 'name', 'fixed', 'shift'] as Mode[]).map((m) => (
              <button key={m} className={`preset ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)} data-testid={`dates-${m}`}>
                <b>{t(`dates.m.${m}` as TKey)}</b>
                <span>{t(`dates.m.${m}.ex` as TKey)}</span>
              </button>
            ))}
          </div>
          {(mode === 'fixed' || mode === 'shift') && (
            <div className="card pad" style={{ marginTop: 10 }}>
              {mode === 'fixed' && <input className="input" type="datetime-local" value={fixed} onChange={(e) => setFixed(e.target.value)} data-testid="dates-fixed" />}
              {mode === 'shift' && (
                <div className="row" style={{ gap: 8 }}>
                  <label className="field" style={{ flex: 1 }}>
                    <span>{t('dates.hours')}</span>
                    <input className="input" type="number" value={hours} onChange={(e) => setHours(Number(e.target.value) || 0)} data-testid="dates-hours" />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    <span>{t('dates.minutes')}</span>
                    <input className="input" type="number" value={mins} onChange={(e) => setMins(Number(e.target.value) || 0)} />
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="section-label">{t('dates.which')}</div>
          <div className="card pad">
            <Seg
              value={which}
              onChange={setWhich}
              options={[
                ['both', t('dates.which.both')],
                ['modified', t('dates.which.modified')],
                ['created', t('dates.which.created')],
              ]}
            />
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              {t('dates.which.desc')}
            </p>
          </div>
        </>
      }
      main={
        !paths.length ? (
          <Empty icon={<IconCalendar size={40} />} text={t('dates.empty')} />
        ) : !preview ? (
          targets.length || !files ? <Busy /> : <Empty text={t('rename.none')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('dates.preview', { n: fmtNum(found), total: fmtNum(preview.length) })}</b>
            </div>
            <div className="table" data-testid="dates-preview">
              <div className="trow head">
                <span className="grow">{t('common.name')}</span>
                <span className="col-date">{t('dates.now')}</span>
                <span className="col-date">{t('dates.new')}</span>
              </div>
              {preview.slice(0, 800).map((p) => (
                <div className={`trow ${p.next ? 'changed' : 'dim'}`} key={p.path}>
                  <span className="ellipsis grow">{p.path.split(/[\\/]/).pop()}</span>
                  <span className="col-date faint">{fmtDate(p.old.mtimeMs)}</span>
                  <span className="col-date">{p.next ? fmtDate(p.next) : t('dates.none')}</span>
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
            <button className="btn primary lg" disabled={!found || busy} onClick={apply} data-testid="dates-apply">
              {busy ? t('common.working') : t('dates.apply', { n: fmtNum(found) })}
            </button>
          </>
        )
      }
    />
  );
}
