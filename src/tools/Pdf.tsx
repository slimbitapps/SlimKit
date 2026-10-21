import { useEffect, useState } from 'react';
import { t, fmtNum } from '../i18n';
import { call, toast } from '../store';
import { Picker, ToolPage, Step, Choices, Done, useFiles, errText, Thumb } from '../components/kit';
import { IconUp, IconDown, IconClose, IconForm, IconImage } from '../icons';
import { toJpeg } from '../lib/image';
import type { FileInfo } from '../types';

export function PdfTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const files = useFiles(paths, { kinds: ['image', 'doc'] });
  const [items, setItems] = useState<FileInfo[]>([]);
  const [page, setPage] = useState<'a4' | 'auto'>('a4');
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
      <ToolPage id="pdf" compact>
        <Done text={done.out ? t('pdf.done', { n: done.pages || 0 }) : t('pdf.split.done', { n: done.count || 0 })} reveal={done.out || done.dir} historyId={done.historyId} />
      </ToolPage>
    );

  const ready = items.length > 0;
  return (
    <ToolPage
      id="pdf"
      foot={
        <>
          <div className="foot-sum">
            {ready ? <b>{onePdf ? t('pdf.one') : t('pdf.foot', { n: items.length })}</b> : <span>{t('pdf.foot.empty')}</span>}
          </div>
          {onePdf ? (
            <button className="btn primary xl" disabled={busy} onClick={split} data-testid="pdf-split">
              {busy ? t('common.working') : t('pdf.split')}
            </button>
          ) : (
            <button className="btn primary xl" disabled={busy || !ready} onClick={merge} data-testid="pdf-apply">
              {busy ? t('common.working') : t('pdf.apply', { n: items.length })}
            </button>
          )}
        </>
      }
    >
      <Step n={1} title={t('pdf.s1')} hint={t('pdf.s1.hint')}>
        <Picker mode="files" paths={paths} onChange={setPaths} empty={t('pdf.pick')} testId="pdf-pick" />
        {files && paths.length > 0 && !items.length && <div className="banner warn small" style={{ marginTop: 10 }}>{t('pdf.none')}</div>}
      </Step>
      {!onePdf && (
        <Step n={2} title={t('pdf.s2')} hint={t('pdf.s2.hint')} disabled={!ready}>
          <div className="order-list" data-testid="pdf-list">
            {items.map((f, i) => (
              <div className="order-row" key={f.path}>
                <span className="order-n">{i + 1}</span>
                <Thumb file={f} size={44} />
                <span className="ellipsis grow">{f.name}</span>
                <button className="btn icon ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('pdf.up')}>
                  <IconUp size={15} />
                </button>
                <button className="btn icon ghost sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={t('pdf.down')}>
                  <IconDown size={15} />
                </button>
                <button className="btn icon ghost sm" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                  <IconClose size={14} />
                </button>
              </div>
            ))}
          </div>
        </Step>
      )}
      {!onePdf && (
        <Step n={3} title={t('pdf.s3')} disabled={!ready}>
          <Choices
            value={page}
            onChange={setPage}
            options={[
              { id: 'a4', icon: <IconForm size={20} />, title: t('pdf.page.a4'), desc: t('pdf.page.a4.desc'), badge: t('common.recommended') },
              { id: 'auto', icon: <IconImage size={20} />, title: t('pdf.page.auto'), desc: t('pdf.page.auto.desc') },
            ]}
          />
          <label className="field" style={{ marginTop: 14 }}>
            <span>{t('pdf.name')}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '') : t('pdf.name.default')} style={{ maxWidth: 360 }} />
          </label>
          <p className="small muted" style={{ marginBottom: 0 }}>{t('pdf.count', { n: fmtNum(items.length) })}</p>
        </Step>
      )}
    </ToolPage>
  );
}
