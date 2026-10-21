import { useEffect, useRef, useState } from 'react';
import { t, fmtSize, fmtNum } from '../i18n';
import { call, useStore, toast, updateSettings } from '../store';
import { Picker, ToolPage, Step, More, Busy, useFiles, Thumb, summarize, FoundStrip } from '../components/kit';
import { IconCopy, IconPhone, IconCheck, IconStop, IconFolder, IconHotspot, IconRefresh } from '../icons';
import type { TransferInfo } from '../types';

type Ev = { ev: string; id?: string; name?: string; size?: number; received?: number; device?: string; path?: string; zip?: boolean };

/** QR-Code mit Status (wartet / verbunden) */
function QrPanel({ info, mode, onStop }: { info: TransferInfo; mode: 'send' | 'receive'; onStop: () => void }) {
  const [copied, setCopied] = useState(false);
  const device = info.devices[info.devices.length - 1];
  return (
    <div className="qr-panel">
      <div className="qr-left">
        <div className="qr" data-testid="qr" dangerouslySetInnerHTML={{ __html: info.qr }} />
      </div>
      <div className="qr-right">
        <div className={`qr-status ${device ? 'ok' : ''}`} data-testid="qr-status">
          {device ? (
            <>
              <IconCheck size={16} strokeWidth={3} /> {t('transfer.connected', { name: device.name })}
            </>
          ) : (
            <>
              <span className="pulse" /> {t('transfer.waiting')}
            </>
          )}
        </div>
        <ol className="qr-steps">
          <li>
            <span className="n">1</span>
            {t('transfer.step1')}
          </li>
          <li>
            <span className="n">2</span>
            {t('transfer.step2')}
          </li>
          <li>
            <span className="n">3</span>
            {t(mode === 'send' ? 'transfer.step3.send' : 'transfer.step3.receive')}
          </li>
        </ol>
        <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn sm"
            onClick={() => {
              call('clipboard:write', info.url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />} {t('transfer.copyLink')}
          </button>
          <button className="btn sm ghost" onClick={onStop} data-testid="transfer-stop">
            <IconStop size={12} /> {t('transfer.stop')}
          </button>
        </div>
        {!info.address && <div className="banner warn small">{t('transfer.noNetwork')}</div>}
      </div>
    </div>
  );
}

/** Hilfe, wenn das Handy den Computer nicht findet */
function Trouble({ info }: { info: TransferInfo | null }) {
  return (
    <More label={t('transfer.trouble')}>
      <div className="trouble">
        <IconHotspot size={22} />
        <ol>
          <li>{t('transfer.trouble.1')}</li>
          <li>{t('transfer.trouble.2')}</li>
          <li>{t('transfer.trouble.3')}</li>
          <li>{t('transfer.trouble.4')}</li>
        </ol>
      </div>
      {info && info.addresses.length > 1 && (
        <div className="opt-row">
          <div className="grow opt-title">{t('transfer.network')}</div>
          <select
            className="select"
            value={info.address?.address || 'auto'}
            onChange={async (e) => {
              await updateSettings({ transfer: { address: e.target.value } });
              window.dispatchEvent(new Event('transfer-refresh'));
            }}
          >
            {info.addresses.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name} – {a.address}
              </option>
            ))}
          </select>
        </div>
      )}
    </More>
  );
}

function useTransfer(start: (() => Promise<TransferInfo>) | null) {
  const [info, setInfo] = useState<TransferInfo | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!start) return;
    let alive = true;
    start().then((i) => alive && setInfo(i));
    const off = window.api.on('transfer:event', (e: Ev) => {
      if (e.ev === 'stopped') return setInfo(null);
      setEvents((list) => {
        if (e.ev === 'upload-progress' || e.ev === 'upload-done' || e.ev === 'upload-failed') {
          const i = list.findIndex((x) => x.id === e.id);
          if (i >= 0) return list.map((x, j) => (j === i ? { ...x, ...e } : x));
        }
        return [...list, e];
      });
      if (e.ev === 'visit') call<TransferInfo>('transfer:info').then((i) => alive && i && setInfo(i));
    });
    const refresh = () => call<TransferInfo>('transfer:info').then((i) => alive && i && setInfo(i));
    window.addEventListener('transfer-refresh', refresh);
    return () => {
      alive = false;
      off();
      window.removeEventListener('transfer-refresh', refresh);
      call('transfer:stop');
    };
  }, [!!start]); // eslint-disable-line react-hooks/exhaustive-deps
  return { info, events, stop: () => call('transfer:stop').then(() => setInfo(null)), restart: () => startRef.current && startRef.current().then(setInfo) };
}

export function SendTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const files = useFiles(paths, { recursive: true });
  const top = useFiles(paths, false);
  const ready = paths.length > 0 && files !== null && files.length > 0;
  const key = paths.join('|');
  const { info, events, stop, restart } = useTransfer(ready ? () => call<TransferInfo>('transfer:start', { mode: 'send', paths }) : null);
  useEffect(() => {
    if (ready && info) restart();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const downloads = events.filter((e) => e.ev === 'download');
  return (
    <ToolPage id="send">
      <Step n={1} title={t('send.s1')} hint={t('send.s1.hint')}>
        <Picker mode="files" paths={paths} onChange={setPaths} empty={t('send.pick')} testId="send-pick" />
        {files && paths.length > 0 && !files.length && <div className="banner warn small" style={{ marginTop: 10 }}>{t('send.none')}</div>}
        {top && files && files.length > 0 && top.length === 1 && top[0].isDir && <FoundStrip files={files} label={t('send.how', { sum: summarize(files) })} />}
      </Step>
      <Step n={2} title={t('send.s2')} hint={t('transfer.wifiHint')} disabled={!ready}>
        {!info ? (
          files && files.length ? (
            <div className="center-row">
              <button className="btn primary" onClick={restart}>
                <IconRefresh size={15} /> {t('transfer.again')}
              </button>
            </div>
          ) : (
            <Busy />
          )
        ) : (
          <QrPanel info={info} mode="send" onStop={stop} />
        )}
        <Trouble info={info} />
      </Step>
      {downloads.length > 0 && (
        <Step n={3} title={t('send.s3', { n: downloads.length })}>
          <div className="card">
            {downloads.slice(-10).reverse().map((d, i) => (
              <div className="list-row" key={i}>
                <IconCheck size={16} className="ok-ic" />
                <span className="grow ellipsis">{d.name}</span>
                <span className="faint small">{fmtSize(d.size || 0)}</span>
              </div>
            ))}
          </div>
        </Step>
      )}
    </ToolPage>
  );
}

export function ReceiveTool({ paths }: { paths: string[] }) {
  const app = useStore((s) => s.app);
  const inbox = useStore((s) => s.settings.transfer.inbox);
  const initialInfo = useFiles(paths.slice(0, 1), false);
  const [dir, setDir] = useState<string[]>([]);
  useEffect(() => {
    if (dir.length || !initialInfo) return;
    const f = initialInfo[0];
    setDir([f ? (f.isDir ? f.path : f.dir) : inbox || app.downloads]);
  }, [initialInfo]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = dir[0];
  const { info, events, stop, restart } = useTransfer(target ? () => call<TransferInfo>('transfer:start', { mode: 'receive', dir: target }) : null);
  useEffect(() => {
    if (target && info && info.dir !== target) restart();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const uploads = events.filter((e) => e.ev.startsWith('upload'));
  const doneN = uploads.filter((u) => u.ev === 'upload-done').length;
  return (
    <ToolPage id="receive">
      <Step
        n={1}
        title={t('receive.s1')}
        hint={t('receive.how')}
        right={
          target && target !== inbox ? (
            <button className="btn sm ghost" onClick={() => updateSettings({ transfer: { inbox: target } }).then(() => toast(t('receive.default.saved')))}>
              {t('receive.default')}
            </button>
          ) : undefined
        }
      >
        <Picker mode="dir" paths={dir} onChange={setDir} empty={t('pick.folder')} testId="receive-dir" />
      </Step>
      <Step n={2} title={t('receive.s2')} hint={t('transfer.wifiHint')} disabled={!target}>
        {!info ? (
          <div className="center-row">
            <button className="btn primary" onClick={restart}>
              <IconRefresh size={15} /> {t('transfer.again')}
            </button>
          </div>
        ) : (
          <QrPanel info={info} mode="receive" onStop={stop} />
        )}
        <Trouble info={info} />
      </Step>
      <Step
        n={3}
        title={doneN ? t('receive.list', { n: fmtNum(doneN) }) : t('receive.s3')}
        hint={uploads.length ? undefined : t('receive.s3.hint')}
        right={
          doneN > 0 ? (
            <button className="btn sm" onClick={() => call('fs:open', target)}>
              <IconFolder size={14} /> {t('receive.open')}
            </button>
          ) : undefined
        }
      >
        {uploads.length > 0 && (
          <div className="received-grid" data-testid="receive-list">
            {uploads
              .slice(-40)
              .reverse()
              .map((u) => (
                <div className={`received ${u.ev}`} key={u.id}>
                  {u.ev === 'upload-done' && u.path ? <Thumb file={{ path: u.path, kind: /\.(jpe?g|png|heic|gif|webp)$/i.test(u.name || '') ? 'image' : 'other', ext: '', isDir: false }} size={56} /> : <span className="thumb" style={{ width: 56, height: 56 }}><IconPhone size={22} /></span>}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">{u.name}</div>
                    {u.ev === 'upload-done' ? (
                      <div className="small ok-text">
                        <IconCheck size={12} strokeWidth={3} className="ok-ic" /> {fmtSize(u.size || 0)}
                      </div>
                    ) : u.ev === 'upload-failed' ? (
                      <div className="small" style={{ color: 'var(--danger)' }}>
                        {t('receive.failed')}
                      </div>
                    ) : (
                      <div className="progress sm">
                        <i style={{ width: `${((u.received || 0) / Math.max(1, u.size || 1)) * 100}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </Step>
    </ToolPage>
  );
}
