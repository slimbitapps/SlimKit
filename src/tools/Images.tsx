import { useEffect, useMemo, useState } from 'react';
import { t, fmtSize, fmtNum } from '../i18n';
import { call, useStore, updateSettings } from '../store';
import { Picker, ToolPage, Step, More, Choices, Done, useFiles, errText, useThumb, FoundStrip } from '../components/kit';
import { Seg, Switch } from '../components/ui';
import { IconMail, IconChat, IconGlobe, IconForm, IconPrinter, IconSliders, IconFolderPlus, IconCopies, IconRefresh, IconArrowRight } from '../icons';
import { convert, type ImgOpts } from '../lib/image';
import type { FileInfo, Settings } from '../types';

type Purpose = 'email' | 'chat' | 'web' | 'form' | 'print' | 'custom';
type Result = { name: string; before: number; after: number; out?: string; error?: string };

/** Zweck → Einstellungen */
function optsFor(s: Settings['images']): ImgOpts {
  const p = s.size as Purpose;
  if (p === 'email') return { maxSide: 1600, percent: 0, format: 'same', quality: 80, targetKB: 0, upscale: false };
  if (p === 'chat') return { maxSide: 1280, percent: 0, format: 'same', quality: 80, targetKB: 0, upscale: false };
  if (p === 'web') return { maxSide: 1920, percent: 0, format: 'webp', quality: 78, targetKB: 0, upscale: false };
  if (p === 'form') return { maxSide: 2400, percent: 0, format: 'jpeg', quality: 85, targetKB: 900, upscale: false };
  if (p === 'print') return { maxSide: 3840, percent: 0, format: 'same', quality: 90, targetKB: 0, upscale: false };
  const by = s.customBy || 'px';
  return {
    maxSide: by === 'px' ? s.maxSide : 0,
    percent: by === 'percent' ? s.percent : 0,
    format: s.format,
    quality: s.quality,
    targetKB: by === 'kb' ? s.targetKB || 500 : 0,
    upscale: by === 'percent' && s.percent > 100,
  };
}

export function ImagesTool({ paths: initial }: { paths: string[] }) {
  const s = useStore((x) => x.settings.images);
  const [paths, setPaths] = useState(initial);
  const [recursive, setRecursive] = useState(false);
  const files = useFiles(paths, { kinds: ['image'], recursive });
  const usable = useMemo(() => (files || []).filter((f) => f.ext !== 'svg' && !/^(raw|cr2|cr3|nef|arw|dng|orf|rw2)$/.test(f.ext)), [files]);
  const hasDirs = useFiles(paths, false)?.some((f) => f.isDir);
  const [running, setRunning] = useState<{ i: number; n: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [historyId, setHistoryId] = useState<string>();
  const [sample, setSample] = useState<{ file: FileInfo; after: number; w: number; h: number; bw: number; bh: number } | null | 'busy'>(null);

  const purpose = (['email', 'chat', 'web', 'form', 'print', 'custom'].includes(s.size) ? s.size : 'email') as Purpose;
  const set = (p: Partial<Settings['images']>) => updateSettings({ images: p });
  const opts = optsFor({ ...s, size: purpose });
  const optsKey = JSON.stringify(opts);

  // Beispiel: das erste Foto probeweise umwandeln → zeigt, was herauskommt
  useEffect(() => {
    const f = usable[0];
    if (!f) return setSample(null);
    let alive = true;
    setSample('busy');
    const id = setTimeout(() => {
      convert(f.path, f.ext, opts)
        .then((r) => alive && setSample({ file: f, after: r.bytes.length, w: r.w, h: r.h, bw: r.before.w, bh: r.before.h }))
        .catch(() => alive && setSample(null));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [usable[0]?.path, optsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = usable.reduce((a, f) => a + f.size, 0);
  const ratio = sample && sample !== 'busy' ? sample.after / Math.max(1, sample.file.size) : 0;

  const run = async () => {
    const out: Result[] = [];
    const created: string[] = [];
    setRunning({ i: 0, n: usable.length });
    let i = 0;
    const queue = [...usable];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try {
          const r = await convert(f.path, f.ext, opts);
          const to = await call<string>('images:write', { src: f.path, bytes: r.bytes, ext: r.ext, output: s.output, suffix: '-' + t('images.suffix') });
          await call('images:copyTimes', f.path, to);
          created.push(to);
          out.push({ name: f.name, before: f.size, after: r.bytes.length, out: to });
        } catch (e) {
          out.push({ name: f.name, before: f.size, after: 0, error: /decode|unsupported/.test(String(e)) ? t('images.cantRead') : errText(e) });
        }
        setRunning({ i: ++i, n: usable.length });
      }
    };
    await Promise.all([worker(), worker()]);
    if (s.output !== 'replace') setHistoryId(await call<string>('images:done', created, t('images.title', { n: created.length })));
    setResults(out);
    setRunning(null);
  };

  if (results) {
    const ok = results.filter((r) => !r.error);
    const before = ok.reduce((a, r) => a + r.before, 0);
    const after = ok.reduce((a, r) => a + r.after, 0);
    return (
      <ToolPage id="images" compact>
        <Done text={t('images.done', { n: fmtNum(ok.length) })} reveal={ok[0]?.out} historyId={historyId}>
          <div className="big-saving">
            <span>{fmtSize(before)}</span>
            <IconArrowRight size={20} />
            <b>{fmtSize(after)}</b>
          </div>
          {after < before && <p className="muted">{t('images.saved.text', { pct: Math.round((1 - after / Math.max(1, before)) * 100) })}</p>}
          {results.some((r) => r.error) && (
            <div className="banner warn small" style={{ textAlign: 'left' }}>
              {t('images.someFailed', { n: results.filter((r) => r.error).length, names: results.filter((r) => r.error).slice(0, 3).map((r) => r.name).join(', ') })}
            </div>
          )}
        </Done>
      </ToolPage>
    );
  }

  if (running) {
    return (
      <ToolPage id="images" compact>
        <div className="done-card">
          <div className="spinner big" />
          <h3>{t('images.running', { i: running.i, n: running.n })}</h3>
          <div className="progress">
            <i style={{ width: `${(running.i / running.n) * 100}%` }} />
          </div>
          <p className="muted small">{t('images.running.hint')}</p>
        </div>
      </ToolPage>
    );
  }

  const ready = usable.length > 0;
  return (
    <ToolPage
      id="images"
      foot={
        <>
          <div className="foot-sum">
            {ready ? (
              <>
                <b>{t('images.foot', { n: fmtNum(usable.length) })}</b>
                <span>{ratio ? t('images.foot.est', { before: fmtSize(total), after: fmtSize(total * ratio) }) : fmtSize(total)}</span>
              </>
            ) : (
              <span>{t('images.foot.empty')}</span>
            )}
          </div>
          <button className="btn primary xl" disabled={!ready} onClick={run} data-testid="images-apply">
            {t('images.apply', { n: fmtNum(usable.length) })}
          </button>
        </>
      }
    >
      <Step n={1} title={t('images.s1')} hint={t('images.s1.hint')}>
        <Picker mode="files" paths={paths} onChange={setPaths} empty={t('images.pick')} testId="images-pick" />
        {hasDirs && (
          <label className="inline-switch">
            <Switch on={recursive} onChange={setRecursive} /> {t('common.subfolders')}
          </label>
        )}
        {hasDirs && <FoundStrip files={usable} />}
        {files && paths.length > 0 && !usable.length && <div className="banner warn small" style={{ marginTop: 10 }}>{t('images.none')}</div>}
      </Step>

      <Step n={2} title={t('images.s2')} disabled={!ready}>
        <Choices<Purpose>
          value={purpose}
          onChange={(v) => set({ size: v })}
          cols={3}
          testPrefix="images-size"
          options={[
            { id: 'email', icon: <IconMail size={20} />, title: t('images.p.email'), desc: t('images.p.email.desc'), badge: t('common.popular') },
            { id: 'chat', icon: <IconChat size={20} />, title: t('images.p.chat'), desc: t('images.p.chat.desc') },
            { id: 'web', icon: <IconGlobe size={20} />, title: t('images.p.web'), desc: t('images.p.web.desc') },
            { id: 'form', icon: <IconForm size={20} />, title: t('images.p.form'), desc: t('images.p.form.desc') },
            { id: 'print', icon: <IconPrinter size={20} />, title: t('images.p.print'), desc: t('images.p.print.desc') },
            { id: 'custom', icon: <IconSliders size={20} />, title: t('images.p.custom'), desc: t('images.p.custom.desc') },
          ]}
        />
        {purpose === 'custom' && (
          <div className="opt-block" style={{ marginTop: 12 }}>
            <Seg value={s.customBy || 'px'} onChange={(v) => set({ customBy: v })} options={[['px', t('images.by.px')], ['percent', t('images.by.percent')], ['kb', t('images.by.kb')]]} />
            <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              {(s.customBy || 'px') === 'px' && (
                <label className="field">
                  <span>{t('images.px')}</span>
                  <input className="input" type="number" min={16} value={s.maxSide} onChange={(e) => set({ maxSide: Math.max(16, Number(e.target.value) || 1920) })} style={{ width: 120 }} />
                </label>
              )}
              {s.customBy === 'percent' && (
                <label className="field" style={{ minWidth: 260 }}>
                  <span>{t('images.percent', { n: s.percent })}</span>
                  <input type="range" min={10} max={300} step={5} value={s.percent} onChange={(e) => set({ percent: Number(e.target.value) })} />
                  {s.percent > 100 && <span className="small muted">{t('images.upscale')}</span>}
                </label>
              )}
              {s.customBy === 'kb' && (
                <label className="field">
                  <span>{t('images.kb')}</span>
                  <input className="input" type="number" min={20} step={50} value={s.targetKB || 500} onChange={(e) => set({ targetKB: Math.max(20, Number(e.target.value) || 500) })} style={{ width: 120 }} data-testid="images-kb" />
                </label>
              )}
              <label className="field">
                <span>{t('images.format')}</span>
                <select className="select" value={s.format} onChange={(e) => set({ format: e.target.value as 'same' })} data-testid="images-format">
                  <option value="same">{t('images.format.same')}</option>
                  <option value="jpeg">JPG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
              <label className="field" style={{ minWidth: 200 }}>
                <span>{t('images.quality', { n: s.quality })}</span>
                <input type="range" min={40} max={100} value={s.quality} onChange={(e) => set({ quality: Number(e.target.value) })} />
              </label>
            </div>
          </div>
        )}
        {sample && <Sample sample={sample} />}
      </Step>

      <Step n={3} title={t('images.s3')} disabled={!ready}>
        <Choices<'folder' | 'next' | 'replace'>
          value={s.output}
          onChange={(v) => set({ output: v })}
          cols={3}
          options={[
            { id: 'folder', icon: <IconFolderPlus size={20} />, title: t('images.output.folder'), desc: t('images.output.folder.desc'), badge: t('common.recommended') },
            { id: 'next', icon: <IconCopies size={20} />, title: t('images.output.next'), desc: t('images.output.next.desc') },
            { id: 'replace', icon: <IconRefresh size={20} />, title: t('images.output.replace'), desc: t('images.output.replace.desc') },
          ]}
        />
        <More label={t('images.more')}>
          <p className="small muted" style={{ margin: 0 }}>
            {t('images.privacy')}
          </p>
        </More>
      </Step>
    </ToolPage>
  );
}

/** Beispiel mit dem ersten Foto: vorher → nachher */
function Sample({ sample }: { sample: 'busy' | { file: FileInfo; after: number; w: number; h: number; bw: number; bh: number } }) {
  const src = useThumb(sample === 'busy' ? undefined : sample.file.path, 220);
  if (sample === 'busy')
    return (
      <div className="sample busy">
        <div className="spinner sm" /> {t('images.sample.busy')}
      </div>
    );
  return (
    <div className="sample" data-testid="images-sample">
      <div className="sample-img">{src && <img src={src} alt="" />}</div>
      <div className="grow">
        <div className="small muted">{t('images.sample', { name: sample.file.name })}</div>
        <div className="sample-row">
          <span className="sample-box">
            <b>{fmtSize(sample.file.size)}</b>
            <span>
              {sample.bw} × {sample.bh}
            </span>
          </span>
          <IconArrowRight size={18} className="faint" />
          <span className="sample-box new">
            <b>{fmtSize(sample.after)}</b>
            <span>
              {sample.w} × {sample.h}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
