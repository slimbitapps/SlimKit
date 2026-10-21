import { useEffect, useMemo, useState } from 'react';
import { t, fmtDate, fmtNum } from '../i18n';
import { call, toast } from '../store';
import { Picker, ToolPage, Step, More, Choices, Done, Busy, useFiles, errText, Thumb, FoundStrip } from '../components/kit';
import { Seg, Switch } from '../components/ui';
import { IconImage, IconTag, IconCalendarCheck, IconClock, IconArrowRight } from '../icons';

type Mode = 'taken' | 'name' | 'fixed' | 'shift';
type Prev = { path: string; old: { mtimeMs: number; birthtimeMs: number }; next: number | null };

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function DatesTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const [recursive, setRecursive] = useState(false);
  const files = useFiles(paths, { recursive });
  const hasDirs = useFiles(paths, false)?.some((f) => f.isDir);
  const targets = useMemo(() => (files || []).map((f) => f.path), [files]);
  const byPath = useMemo(() => new Map((files || []).map((f) => [f.path, f])), [files]);
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
      <ToolPage id="dates" compact>
        <Done text={t('dates.done', { n: fmtNum(done.done) })} reveal={targets[0]} historyId={done.historyId}>
          {done.createdFailed > 0 && <p className="muted">{t(isMac ? 'dates.createdFailed.mac' : 'dates.createdFailed', { n: done.createdFailed })}</p>}
        </Done>
      </ToolPage>
    );
  }

  const ready = targets.length > 0;
  return (
    <ToolPage
      id="dates"
      foot={
        <>
          <div className="foot-sum">
            {ready && preview ? (
              <>
                <b>{t('dates.preview', { n: fmtNum(found), total: fmtNum(preview.length) })}</b>
                <span>{found < preview.length ? t('dates.foot.skip', { n: preview.length - found }) : t('common.undoHint')}</span>
              </>
            ) : (
              <span>{t('dates.foot.empty')}</span>
            )}
          </div>
          <button className="btn primary xl" disabled={!found || busy} onClick={apply} data-testid="dates-apply">
            {busy ? t('common.working') : t('dates.apply', { n: fmtNum(found) })}
          </button>
        </>
      }
    >
      <Step n={1} title={t('dates.s1')} hint={t('dates.s1.hint')}>
        <Picker mode="files" paths={paths} onChange={setPaths} empty={t('dates.pick')} testId="dates-pick" />
        {hasDirs && (
          <label className="inline-switch">
            <Switch on={recursive} onChange={setRecursive} /> {t('common.subfolders')}
          </label>
        )}
        {hasDirs && files && <FoundStrip files={files} />}
      </Step>

      <Step n={2} title={t('dates.s2')} disabled={!ready}>
        <Choices<Mode>
          value={mode}
          onChange={setMode}
          cols={2}
          testPrefix="dates"
          options={[
            { id: 'taken', icon: <IconImage size={20} />, title: t('dates.m.taken'), desc: t('dates.m.taken.ex'), badge: t('common.recommended') },
            { id: 'name', icon: <IconTag size={20} />, title: t('dates.m.name'), desc: t('dates.m.name.ex') },
            { id: 'fixed', icon: <IconCalendarCheck size={20} />, title: t('dates.m.fixed'), desc: t('dates.m.fixed.ex') },
            { id: 'shift', icon: <IconClock size={20} />, title: t('dates.m.shift'), desc: t('dates.m.shift.ex') },
          ]}
        />
        {(mode === 'fixed' || mode === 'shift') && (
          <div className="opt-block" style={{ marginTop: 12 }}>
            {mode === 'fixed' && (
              <label className="field">
                <span>{t('dates.m.fixed')}</span>
                <input className="input" type="datetime-local" value={fixed} onChange={(e) => setFixed(e.target.value)} data-testid="dates-fixed" style={{ maxWidth: 260 }} />
              </label>
            )}
            {mode === 'shift' && (
              <div className="row" style={{ gap: 10 }}>
                <label className="field">
                  <span>{t('dates.hours')}</span>
                  <input className="input" type="number" value={hours} onChange={(e) => setHours(Number(e.target.value) || 0)} data-testid="dates-hours" style={{ width: 110 }} />
                </label>
                <label className="field">
                  <span>{t('dates.minutes')}</span>
                  <input className="input" type="number" value={mins} onChange={(e) => setMins(Number(e.target.value) || 0)} style={{ width: 110 }} />
                </label>
              </div>
            )}
          </div>
        )}
        <More>
          <div className="opt-row">
            <div className="grow">
              <div className="opt-title">{t('dates.which')}</div>
              <div className="small muted">{t('dates.which.desc')}</div>
            </div>
            <Seg value={which} onChange={setWhich} options={[['both', t('dates.which.both')], ['modified', t('dates.which.modified')], ['created', t('dates.which.created')]]} />
          </div>
        </More>
      </Step>

      <Step n={3} title={t('dates.s3')} disabled={!ready}>
        {!preview ? (
          <Busy />
        ) : (
          <div className="table" data-testid="dates-preview">
            <div className="trow head">
              <span className="grow">{t('common.name')}</span>
              <span className="col-date">{t('dates.now')}</span>
              <span style={{ width: 18 }} />
              <span className="col-date">{t('dates.new')}</span>
            </div>
            {preview.slice(0, 600).map((p) => {
              const f = byPath.get(p.path);
              return (
                <div className={`trow ${p.next ? 'changed' : 'dim'}`} key={p.path}>
                  {f && <Thumb file={f} size={28} />}
                  <span className="ellipsis grow">{p.path.split(/[\\/]/).pop()}</span>
                  <span className="col-date faint">{fmtDate(p.old.mtimeMs)}</span>
                  <IconArrowRight size={14} className="arrow" />
                  <span className="col-date new">{p.next ? fmtDate(p.next) : t('dates.none')}</span>
                </div>
              );
            })}
          </div>
        )}
      </Step>
    </ToolPage>
  );
}
