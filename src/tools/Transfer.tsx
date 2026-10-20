import { useEffect, useRef, useState } from 'react';
import { t, fmtSize, fmtNum } from '../i18n';
import { call, useStore, toast, updateSettings } from '../store';
import { Picker, ToolFrame, Empty, Busy, useFiles } from '../components/kit';
import { IconSend, IconReceive, IconCopy, IconPhone, IconWifi, IconCheck, IconStop, IconFolder } from '../icons';
import type { TransferInfo } from '../types';

type Ev = { ev: string; id?: string; name?: string; size?: number; received?: number; device?: string; path?: string; zip?: boolean };

/** Gemeinsamer QR-Bereich für Senden und Empfangen */
function QrPanel({ info, mode, onStop }: { info: TransferInfo; mode: 'send' | 'receive'; onStop: () => void }) {
  const expert = useStore((s) => s.settings.prefs.mode === 'expert');
  const [copied, setCopied] = useState(false);
  return (
    <div className="qr-panel">
      <div className="qr" data-testid="qr" dangerouslySetInnerHTML={{ __html: info.qr }} />
      <ol className="steps">
        <li>
          <span className="num">1</span>
          {t('transfer.step1')}
        </li>
        <li>
          <span className="num">2</span>
          {t('transfer.step2')}
        </li>
        <li>
          <span className="num">3</span>
          {t(mode === 'send' ? 'transfer.step3.send' : 'transfer.step3.receive')}
        </li>
      </ol>
      <div className="row small" style={{ gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        <span className="chip mono" title={info.url}>
          <IconWifi size={13} /> {info.address ? info.address.address : '127.0.0.1'}
        </span>
        <button
          className="btn xs ghost"
          onClick={() => {
            call('clipboard:write', info.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />} {t('transfer.copyLink')}
        </button>
        <button className="btn xs ghost" onClick={onStop} data-testid="transfer-stop">
          <IconStop size={12} /> {t('transfer.stop')}
        </button>
      </div>
      {!info.address && <div className="banner warn small">{t('transfer.noNetwork')}</div>}
      {expert && info.addresses.length > 1 && (
        <select
          className="select small"
          style={{ marginTop: 8 }}
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
      )}
      <p className="small faint" style={{ marginTop: 10 }}>
        {t('transfer.wifiHint')}
      </p>
    </div>
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
  return { info, events, stop: () => call('transfer:stop').then(() => setInfo(null)), restart: () => start && start().then(setInfo) };
}

export function SendTool({ paths: initial }: { paths: string[] }) {
  const [paths, setPaths] = useState(initial);
  const files = useFiles(paths, { recursive: true });
  const ready = paths.length > 0 && files !== null;
  const key = paths.join('|');
  const { info, events, stop, restart } = useTransfer(ready ? () => call<TransferInfo>('transfer:start', { mode: 'send', paths }) : null);
  useEffect(() => {
    if (ready && info) restart();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = (files || []).reduce((a, f) => a + f.size, 0);
  const devices = info?.devices || [];
  const downloads = events.filter((e) => e.ev === 'download');
  return (
    <ToolFrame
      id="send"
      side={
        <>
          <Picker mode="files" paths={paths} onChange={setPaths} label={t('send.what')} testId="send-pick" />
          {files && files.length > 0 && (
            <div className="card pad small">
              <b>{t('send.summary', { n: fmtNum(files.length), size: fmtSize(total) })}</b>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {t('send.how')}
              </p>
            </div>
          )}
          {devices.length > 0 && (
            <>
              <div className="section-label">{t('transfer.devices')}</div>
              <div className="card">
                {devices.map((d) => (
                  <div className="list-row" key={d.ip}>
                    <IconPhone size={16} />
                    <span className="grow">{d.name}</span>
                    <span className="faint small mono">{d.ip}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {downloads.length > 0 && (
            <>
              <div className="section-label">{t('send.downloads')}</div>
              <div className="card">
                {downloads.slice(-8).map((d, i) => (
                  <div className="list-row" key={i}>
                    <IconCheck size={15} className="ok-ic" />
                    <span className="grow ellipsis">{d.name}</span>
                    <span className="faint small">{fmtSize(d.size || 0)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      }
      main={
        !paths.length ? (
          <Empty icon={<IconSend size={40} />} text={t('send.empty')} />
        ) : files && !files.length ? (
          <Empty text={t('send.none')} />
        ) : !info ? (
          ready ? (
            <div className="empty-state">
              <button className="btn primary" onClick={restart}>
                {t('transfer.again')}
              </button>
            </div>
          ) : (
            <Busy />
          )
        ) : (
          <QrPanel info={info} mode="send" onStop={stop} />
        )
      }
    />
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
    <ToolFrame
      id="receive"
      side={
        <>
          <Picker mode="dir" paths={dir} onChange={setDir} label={t('receive.where')} testId="receive-dir" />
          <p className="small muted">{t('receive.how')}</p>
          {target && (
            <button className="btn sm ghost" onClick={() => updateSettings({ transfer: { inbox: target } }).then(() => toast(t('receive.default.saved')))}>
              {t('receive.default')}
            </button>
          )}
          {uploads.length > 0 && (
            <>
              <div className="section-label">{t('receive.list', { n: doneN })}</div>
              <div className="card" data-testid="receive-list">
                {uploads
                  .slice(-30)
                  .reverse()
                  .map((u) => (
                    <div className="list-row" key={u.id}>
                      {u.ev === 'upload-done' ? <IconCheck size={15} className="ok-ic" /> : <IconReceive size={15} />}
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="ellipsis">{u.name}</div>
                        {u.ev === 'upload-progress' || u.ev === 'upload-start' ? (
                          <div className="progress sm">
                            <i style={{ width: `${((u.received || 0) / Math.max(1, u.size || 1)) * 100}%` }} />
                          </div>
                        ) : u.ev === 'upload-failed' ? (
                          <div className="small" style={{ color: 'var(--danger)' }}>
                            {t('receive.failed')}
                          </div>
                        ) : null}
                      </div>
                      <span className="faint small">{fmtSize(u.size || 0)}</span>
                    </div>
                  ))}
              </div>
              {doneN > 0 && (
                <button className="btn sm" style={{ marginTop: 10 }} onClick={() => call('fs:open', target)}>
                  <IconFolder size={14} /> {t('receive.open')}
                </button>
              )}
            </>
          )}
        </>
      }
      main={!target ? <Busy /> : !info ? (
        <div className="empty-state">
          <button className="btn primary" onClick={restart}>
            {t('transfer.again')}
          </button>
        </div>
      ) : <QrPanel info={info} mode="receive" onStop={stop} />}
    />
  );
}
