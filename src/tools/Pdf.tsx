import { useEffect, useState } from 'react';
import { t, fmtSize, fmtNum } from '../i18n';
import { call, toast } from '../store';
import { Picker, ToolFrame, Done, Empty, Busy, useFiles, errText, KindIcon } from '../components/kit';
import { Seg } from '../components/ui';
import { IconPdf, IconUp, IconDown, IconClose } from '../icons';
import { toJpeg } from '../lib/image';
import type { FileInfo } from '../types';

export function PdfTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const files = useFiles(paths, { kinds: ['image', 'doc'] });
  const [items, setItems] = useState<FileInfo[]>([]);
  const [page, setPage] = useState<'auto' | 'a4'>('a4');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ out?: string; dir?: string; pages?: number; count?: number; historyId?: string } | null>(null);
  useEffect(() => {
    setItems((files || []).filter((f) => f.ext === 'pdf' || (f.kind === 'image' && !/^(svg|raw|cr2|cr3|nef|arw|dng)$/.test(f.ext))));
  }, [files]);
  const onePdf = items.length === 1 && items[0].ext === 'pdf';

  const merge = async () => {
    setBusy(true);
    try {
      const payload = [];
      for (const f of items) {
        if (f.ext === 'pdf' || f.ext === 'jpg' || f.ext === 'jpeg' || f.ext === 'png') payload.push({ path: f.path });
        else payload.push({ src: f.path, name: f.name, bytes: await toJpeg(f.path) });
      }
      setDone(await call('pdf:merge', payload, { page, name: name.trim() || undefined }));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const split = async () => {
    setBusy(true);
    try {
      setDone(await call('pdf:split', items[0].path));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, d: number) => {
    const n = [...items];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x);
    setItems(n);
  };

  if (done)
    return (
      <ToolFrame
        id="pdf"
        side={null}
        main={<Done text={done.out ? t('pdf.done', { n: done.pages || 0 }) : t('pdf.split.done', { n: done.count || 0 })} reveal={done.out || done.dir} historyId={done.historyId} />}
      />
    );

  return (
    <ToolFrame
      id="pdf"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('pdf.what')} testId="pdf-pick" />
          {items.length > 0 && !onePdf && (
            <>
              <div className="section-label">{t('pdf.page')}</div>
              <div className="card pad">
                <Seg value={page} onChange={setPage} options={[['a4', t('pdf.page.a4')], ['auto', t('pdf.page.auto')]]} />
              </div>
              <label className="field" style={{ marginTop: 12 }}>
                <span>{t('pdf.name')}</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '') : t('pdf.name.default')} />
              </label>
            </>
          )}
        </>
      }
      main={
        !paths.length ? (
          <Empty icon={<IconPdf size={40} />} text={t('pdf.empty')} />
        ) : !files ? (
          <Busy />
        ) : !items.length ? (
          <Empty text={t('pdf.none')} />
        ) : (
          <div className="preview">
            <div className="preview-head">
              <b>{onePdf ? t('pdf.one') : t('pdf.order', { n: fmtNum(items.length) })}</b>
            </div>
            <div className="table" data-testid="pdf-list">
              {items.map((f, i) => (
                <div className="trow" key={f.path}>
                  <span className="faint small" style={{ width: 22 }}>
                    {i + 1}.
                  </span>
                  <KindIcon kind={f.kind} size={14} />
                  <span className="ellipsis grow">{f.name}</span>
                  <span className="faint small">{fmtSize(f.size)}</span>
                  <button className="btn icon ghost xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('pdf.up')}>
                    <IconUp size={14} />
                  </button>
                  <button className="btn icon ghost xs" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={t('pdf.down')}>
                    <IconDown size={14} />
                  </button>
                  <button className="btn icon ghost xs" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                    <IconClose size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      }
      foot={
        items.length > 0 && (
          <>
            <div className="spacer" />
            {onePdf ? (
              <button className="btn primary lg" disabled={busy} onClick={split} data-testid="pdf-split">
                {busy ? t('common.working') : t('pdf.split')}
              </button>
            ) : (
              <button className="btn primary lg" disabled={busy} onClick={merge} data-testid="pdf-apply">
                {busy ? t('common.working') : t('pdf.apply', { n: items.length })}
              </button>
            )}
          </>
        )
      }
    />
  );
}
