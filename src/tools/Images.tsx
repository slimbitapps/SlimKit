import { useState } from 'react';
import { t, fmtSize, fmtNum, type TKey } from '../i18n';
import { call, useStore, updateSettings } from '../store';
import { Picker, ToolFrame, Done, Empty, Busy, useFiles, errText } from '../components/kit';
import { Group, Row, Seg, Switch } from '../components/ui';
import { IconImage } from '../icons';
import { convert, type ImgOpts } from '../lib/image';
import type { Settings } from '../types';

const SIZES: Record<string, number> = { small: 1280, fhd: 1920, large: 2560, '4k': 3840 };
type Result = { name: string; before: number; after: number; out?: string; error?: string };

export function ImagesTool({ paths: initial }: { paths: string[] }) {
  const s = useStore((x) => x.settings.images);
  const expert = useStore((x) => x.settings.prefs.mode === 'expert');
  const [paths, setPaths] = useState(initial);
  const [recursive, setRecursive] = useState(false);
  const files = useFiles(paths, { kinds: ['image'], recursive });
  const usable = (files || []).filter((f) => f.ext !== 'svg' && !/^(raw|cr2|cr3|nef|arw|dng|orf|rw2)$/.test(f.ext));
  const [running, setRunning] = useState<{ i: number; n: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [historyId, setHistoryId] = useState<string>();

  const set = (p: Partial<Settings['images']>) => updateSettings({ images: p });
  const opts: ImgOpts = {
    maxSide: s.size === 'percent' || s.size === 'kb' ? 0 : s.size === 'custom' ? s.maxSide : SIZES[s.size] || 1920,
    percent: s.size === 'percent' ? s.percent : 0,
    format: s.format,
    quality: s.quality,
    targetKB: s.size === 'kb' ? s.targetKB || 500 : expert ? s.targetKB : 0,
    upscale: s.size === 'percent' && s.percent > 100,
  };

  const run = async () => {
    const out: Result[] = [];
    const created: string[] = [];
    setRunning({ i: 0, n: usable.length });
    let i = 0;
    // Zwei Bilder gleichzeitig: schnell, aber der Rechner bleibt bedienbar
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
      <ToolFrame
        id="images"
        side={null}
        main={
          <Done text={t('images.done', { n: fmtNum(ok.length) })} reveal={ok[0]?.out} historyId={historyId}>
            <p className="muted">{after < before ? t('images.saved', { before: fmtSize(before), after: fmtSize(after), pct: Math.round((1 - after / Math.max(1, before)) * 100) }) : t('images.sizes', { before: fmtSize(before), after: fmtSize(after) })}</p>
            {results.some((r) => r.error) && (
              <div className="table" style={{ maxHeight: 160, textAlign: 'left' }}>
                {results
                  .filter((r) => r.error)
                  .map((r) => (
                    <div className="trow" key={r.name}>
                      <span className="ellipsis grow">{r.name}</span>
                      <span className="small" style={{ color: 'var(--danger)' }}>{r.error}</span>
                    </div>
                  ))}
              </div>
            )}
          </Done>
        }
      />
    );
  }

  const sizeOptions: [string, string][] = [
    ['small', t('images.size.small')],
    ['fhd', t('images.size.fhd')],
    ['large', t('images.size.large')],
    ['4k', t('images.size.4k')],
    ['percent', t('images.size.percent')],
    ['kb', t('images.size.kb')],
    ...(expert ? ([['custom', t('images.size.custom')]] as [string, string][]) : []),
  ];

  return (
    <ToolFrame
      id="images"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('pick.what')} testId="images-pick" />
          {files?.some((f) => f.isDir) || paths.length ? (
            <Group>
              <Row label={t('common.subfolders')}>
                <Switch on={recursive} onChange={setRecursive} />
              </Row>
            </Group>
          ) : null}
          <div className="section-label">{t('images.size')}</div>
          <div className="preset-list cols-2">
            {sizeOptions.map(([id, label]) => (
              <button key={id} className={`preset ${s.size === id ? 'on' : ''}`} onClick={() => set({ size: id })} data-testid={`images-size-${id}`}>
                <b>{label}</b>
                <span>{t(`images.size.${id}.ex` as TKey)}</span>
              </button>
            ))}
          </div>
          {(s.size === 'percent' || s.size === 'kb' || s.size === 'custom') && (
            <div className="card pad" style={{ marginTop: 10 }}>
              {s.size === 'percent' && (
                <label className="field">
                  <span>{t('images.percent', { n: s.percent })}</span>
                  <input type="range" min={10} max={300} step={5} value={s.percent} onChange={(e) => set({ percent: Number(e.target.value) })} />
                  {s.percent > 100 && <span className="small muted">{t('images.upscale')}</span>}
                </label>
              )}
              {s.size === 'kb' && (
                <label className="field">
                  <span>{t('images.kb')}</span>
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input" type="number" min={20} step={50} value={s.targetKB || 500} onChange={(e) => set({ targetKB: Math.max(20, Number(e.target.value) || 500) })} style={{ width: 110 }} data-testid="images-kb" />
                    <span className="muted">KB</span>
                  </div>
                </label>
              )}
              {s.size === 'custom' && (
                <label className="field">
                  <span>{t('images.px')}</span>
                  <input className="input" type="number" min={16} value={s.maxSide} onChange={(e) => set({ maxSide: Math.max(16, Number(e.target.value) || 1920) })} style={{ width: 110 }} />
                </label>
              )}
            </div>
          )}
          <Group>
            <Row label={t('images.format')}>
              <select className="select" value={s.format} onChange={(e) => set({ format: e.target.value as 'same' })} data-testid="images-format">
                <option value="same">{t('images.format.same')}</option>
                <option value="jpeg">JPG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
            </Row>
            {expert && (
              <Row label={t('images.quality', { n: s.quality })}>
                <input type="range" min={40} max={100} value={s.quality} onChange={(e) => set({ quality: Number(e.target.value) })} style={{ width: 140 }} />
              </Row>
            )}
          </Group>
          <div className="section-label">{t('images.output')}</div>
          <div className="card pad">
            <Seg
              value={s.output}
              onChange={(v) => set({ output: v })}
              options={[
                ['folder', t('images.output.folder')],
                ['next', t('images.output.next')],
                ['replace', t('images.output.replace')],
              ]}
            />
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              {t(`images.output.${s.output}.desc` as TKey)}
            </p>
          </div>
        </>
      }
      main={
        !paths.length ? (
          <Empty icon={<IconImage size={40} />} text={t('images.empty')} />
        ) : !files ? (
          <Busy />
        ) : !usable.length ? (
          <Empty text={t('images.none')} />
        ) : running ? (
          <div className="empty-state">
            <div className="progress">
              <i style={{ width: `${(running.i / running.n) * 100}%` }} />
            </div>
            <p>{t('images.running', { i: running.i, n: running.n })}</p>
          </div>
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{t('images.count', { n: fmtNum(usable.length) })}</b>
              <span className="muted small">{fmtSize(usable.reduce((a, f) => a + f.size, 0))}</span>
            </div>
            <div className="thumbs" data-testid="images-list">
              {usable.slice(0, 300).map((f) => (
                <div className="thumb-row" key={f.path}>
                  <span className="ext">{f.ext.toUpperCase()}</span>
                  <span className="ellipsis grow">{f.name}</span>
                  <span className="faint small">{fmtSize(f.size)}</span>
                </div>
              ))}
            </div>
            <p className="small muted">{t('images.privacy')}</p>
          </div>
        )
      }
      foot={
        usable.length > 0 &&
        !running && (
          <>
            <span className="muted small">{s.output === 'replace' ? t('images.replace.warn') : t('images.safe')}</span>
            <div className="spacer" />
            <button className="btn primary lg" onClick={run} data-testid="images-apply">
              {t('images.apply', { n: fmtNum(usable.length) })}
            </button>
          </>
        )
      }
    />
  );
}
