/**
 * Einrichtung: lokale Spracherkennung (Modelle herunterladen) und Online-Dienste (mit Schlüssel-Anleitung).
 * Wird im Einrichtungs-Assistenten und auf der Seite „Spracherkennung & KI“ benutzt.
 */
import { useEffect, useState } from 'react';
import { useApp } from './ui';
import { GUIDES, LLM_PROVIDERS, LOCAL_TEXT, STT_PROVIDERS, recommendLocal } from './guides';
import type { EngineStatus, LocalKey } from './types';

export function useL() {
  const { lang } = useApp();
  return (de: string, en: string) => (lang === 'de' ? de : en);
}

const fmtMB = (bytes: number) => (bytes / 1024 / 1024 >= 1000 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`);

// ------------------------------------------------------------------ Quelle wählen
export function SourceChoice() {
  const { s, set } = useApp();
  const L = useL();
  const local = s.services.stt.provider === 'local';
  const pick = (provider: string) => {
    if (provider === s.services.stt.provider) return;
    set({ services: { stt: { provider, model: '', fastModel: '', baseUrl: '' } } });
  };
  return (
    <div className="source-cards" role="radiogroup" aria-label={L('Spracherkennung', 'Speech recognition')}>
      <button type="button" role="radio" aria-checked={local} className={'source' + (local ? ' on' : '')} onClick={() => pick('local')}>
        <span className="source-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 5h16v10H4zM2 17h20v2H2zM9 7v6l5-3z" />
          </svg>
        </span>
        <strong>{L('Auf diesem Computer', 'On this computer')}</strong>
        <span>{L('Kostenlos, privat und offline. Einmaliger Download des Sprachmodells.', 'Free, private and offline. One-time download of the speech model.')}</span>
        <span className="tags">
          <em>{L('Kein Konto nötig', 'No account needed')}</em>
          <em>{L('Nichts verlässt den Rechner', 'Nothing leaves your computer')}</em>
        </span>
      </button>
      <button type="button" role="radio" aria-checked={!local} className={'source' + (!local ? ' on' : '')} onClick={() => pick(STT_PROVIDERS.includes(s.services.stt.provider) ? s.services.stt.provider : 'groq')}>
        <span className="source-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 8.3 5 5 0 0 1 18 18.98V19z" />
          </svg>
        </span>
        <strong>{L('Über einen Online-Dienst', 'Via an online service')}</strong>
        <span>{L('Am schnellsten und genauesten, auch auf älteren Rechnern. Braucht einen API-Schlüssel – mit Anleitung.', 'Fastest and most accurate, even on older computers. Needs an API key – with a guide.')}</span>
        <span className="tags">
          <em>{L('Groq kostenlos testen', 'Try Groq for free')}</em>
          <em>{L('Cent-Beträge', 'Costs cents')}</em>
        </span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Lokale Modelle
interface SelfTest {
  ok: boolean;
  text: string;
  ms?: number;
  gpu?: boolean;
}

export function useLocalEngine() {
  const { snap, refresh } = useApp();
  const [status, setStatus] = useState<EngineStatus>(snap.local.status);
  const [phase, setPhase] = useState<'' | 'testing'>('');
  const [test, setTest] = useState<SelfTest | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const off = window.api.on('local:event', (ev: { type: string; status: EngineStatus; message?: string; test?: SelfTest }) => {
      if (ev.status) setStatus({ ...ev.status });
      if (ev.type === 'loading') (setError(''), setTest(null));
      if (ev.type === 'testing') setPhase('testing');
      if (ev.type === 'error') setError(ev.message || 'error');
      if (ev.type === 'ready') {
        setPhase('');
        if (ev.test) setTest(ev.test);
      }
      if (ev.type === 'ready' || ev.type === 'cancelled') refresh();
    });
    return off;
  }, [refresh]);
  return { status, phase, test, setTest, error, setError };
}

export function LocalModels({ compact }: { compact?: boolean }) {
  const { s, set, snap, lang, refresh } = useApp();
  const L = useL();
  const { status, phase, test, setTest, error, setError } = useLocalEngine();
  const local = s.services.local;
  const rec = recommendLocal(snap.local.cores, snap.local.appleSilicon);
  const keys: LocalKey[] = ['base', 'small', 'turbo'];
  const busy = status.downloading;
  const mac = snap.platform === 'darwin';
  const [testing, setTesting] = useState(false);

  const download = async (key: LocalKey) => {
    setError('');
    const res = await window.api.call<{ ok: boolean; message?: string; offline?: boolean; test?: SelfTest }>('local:download', key);
    if (!res.ok && res.message !== 'cancelled') setError(res.offline ? L('Download fehlgeschlagen – bitte Internetverbindung prüfen.', 'Download failed – please check your internet connection.') : res.message || 'error');
    if (res.test) setTest(res.test);
    refresh();
  };

  return (
    <div className="local">
      <p className="hint machine">
        {L('Dein Computer', 'Your computer')}: {snap.local.cores} {L('Kerne', 'cores')}
        {mac && snap.local.appleSilicon ? ` · ${L('Apple-Chip mit Grafikbeschleunigung', 'Apple chip with graphics acceleration')}` : ''}
      </p>
      <div className="model-cards">
        {keys.map((k) => {
          const m = snap.local.models[k];
          const txt = LOCAL_TEXT[lang][k];
          const ready = !!snap.local.downloaded[k];
          const active = local.model === k;
          const loadingThis = busy === k;
          return (
            <div key={k} className={'model' + (active && ready ? ' on' : '')} data-testid={`model-${k}`}>
              <div className="model-head">
                <strong>{txt.name}</strong>
                {k === rec && <span className="badge accent">{L('Empfohlen', 'Recommended')}</span>}
              </div>
              <p>{txt.desc}</p>
              <div className="model-meta">
                {L('ca.', 'approx.')} {m.sizeMB} MB · {L('ab', 'from')} {m.ramGB} GB RAM
              </div>
              {loadingThis ? (
                <div className="progress-wrap">
                  <div className="progress" role="progressbar" aria-valuenow={Math.round(status.progress)} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${Math.max(2, status.progress)}%` }} />
                  </div>
                  <div className="progress-text">
                    {status.loaded ? `${fmtMB(status.loaded)} / ${fmtMB(status.total)}` : L('Wird vorbereitet …', 'Preparing …')}
                    <button className="link" onClick={() => window.api.call('local:cancel')}>
                      {L('Abbrechen', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : ready ? (
                <div className="model-actions">
                  {active ? (
                    <span className="badge ok">✓ {L('In Verwendung', 'In use')}</span>
                  ) : (
                    <button className="btn small" onClick={() => set({ services: { local: { model: k } } })}>
                      {L('Verwenden', 'Use')}
                    </button>
                  )}
                  {!compact && !active && (
                    <button className="link" onClick={async () => (await window.api.call('local:delete', k), refresh())}>
                      {L('Löschen', 'Delete')}
                    </button>
                  )}
                </div>
              ) : (
                <button className={'btn small' + (k === rec ? ' primary' : '')} disabled={!!busy} onClick={() => download(k)}>
                  {L('Herunterladen', 'Download')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {phase === 'testing' && <div className="banner info">{L('Prüfe die Erkennung mit einer Sprachprobe …', 'Checking recognition with a voice sample …')}</div>}
      {test && (
        <div className={'banner ' + (test.ok ? 'ok' : 'bad')}>
          {test.ok
            ? `✓ ${L('Erkennung funktioniert', 'Recognition works')} (${L('Probe erkannt als', 'sample recognised as')} „${test.text}“${test.ms ? `, ${(test.ms / 1000).toFixed(1)} s` : ''}${test.gpu ? `, ${L('mit Grafikbeschleunigung', 'with graphics acceleration')}` : ''})${(test.ms || 0) > 6000 ? ' – ' + L('auf deinem Rechner recht langsam. Tipp: ein kleineres Modell wählen.', 'quite slow on your computer. Tip: choose a smaller model.') : ''}`
            : `${L('Selbsttest fehlgeschlagen – bitte ein anderes Modell probieren.', 'Self-test failed – please try another model.')} (${test.text})`}
        </div>
      )}
      {error && <div className="banner bad">{error}</div>}
      {!compact && snap.local.downloaded[local.model] && (
        <div className="test-row">
          <button
            className="btn small"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setTest(await window.api.call<SelfTest>('local:selftest'));
              setTesting(false);
              refresh();
            }}
          >
            {testing ? L('Prüfe …', 'Checking …') : L('Erkennung testen', 'Test recognition')}
          </button>
        </div>
      )}
      {!compact && s.ui.mode === 'expert' && (
        <>
          <div className="row">
            <div className="row-label">
              <div>{L('Im Arbeitsspeicher halten', 'Keep in memory')}</div>
              <div className="hint">{L('Danach wird das Modell entladen, um Speicher freizugeben. Das nächste Diktat lädt es in Sekunden neu.', 'Afterwards the model is unloaded to free memory. The next dictation reloads it in seconds.')}</div>
            </div>
            <div className="row-control">
              <select className="select" value={String(local.keepLoadedMin)} aria-label={L('Im Arbeitsspeicher halten', 'Keep in memory')} onChange={(e) => set({ services: { local: { keepLoadedMin: +e.target.value } } })}>
                {[5, 15, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} {L('Minuten', 'minutes')}
                  </option>
                ))}
                <option value={0}>{L('Immer', 'Always')}</option>
              </select>
            </div>
          </div>
          {mac && (
            <div className="row">
              <div className="row-label">
                <div>{L('Grafikbeschleunigung (Metal)', 'Graphics acceleration (Metal)')}</div>
                <div className="hint">{L('Schneller. Wird automatisch ausgeschaltet, falls der Selbsttest damit fehlschlägt.', 'Faster. Turned off automatically if the self-test fails with it.')}</div>
              </div>
              <div className="row-control">
                <button type="button" role="switch" aria-checked={local.gpu} aria-label="Metal" className={'switch' + (local.gpu ? ' on' : '')} onClick={() => set({ services: { local: { gpu: !local.gpu } } })}>
                  <i />
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="hint">
        {L(
          'Das Modell wird einmalig heruntergeladen und auf deinem Rechner gespeichert. Danach funktioniert alles ohne Internet – und nichts verlässt deinen Rechner.',
          'The model is downloaded once and stored on your computer. After that everything works without internet – and nothing leaves your computer.',
        )}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Online-Dienste
export function ProviderPicker({ kind, value, onChange, allowAuto }: { kind: 'stt' | 'llm'; value: string; onChange: (p: string) => void; allowAuto?: boolean }) {
  const { snap, lang } = useApp();
  const L = useL();
  const list = kind === 'stt' ? STT_PROVIDERS : LLM_PROVIDERS;
  return (
    <div className="provider-cards" role="radiogroup" aria-label={L('Dienst', 'Service')}>
      {allowAuto && (
        <button type="button" role="radio" aria-checked={value === 'auto'} className={'provider' + (value === 'auto' ? ' on' : '')} onClick={() => onChange('auto')}>
          <strong>{L('Automatisch', 'Automatic')}</strong>
          <span>{L('Nimmt einen Dienst, für den du schon einen Schlüssel hast.', 'Uses a service you already have a key for.')}</span>
        </button>
      )}
      {list.map((p) => {
        const g = GUIDES[lang][p];
        const has = !!snap.secrets.keys[p];
        return (
          <button key={p} type="button" role="radio" aria-checked={value === p} className={'provider' + (value === p ? ' on' : '')} onClick={() => onChange(p)}>
            <strong>
              {g.name} {has && <span className="badge ok">✓</span>}
            </strong>
            <span>{g.pitch}</span>
            <span className="tags">
              {g.badges.map((b) => (
                <em key={b}>{b}</em>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type TestResult = { ok: boolean; ms?: number; code?: string; message?: string };

/** Anleitung + Schlüssel-Feld mit sofortiger Prüfung */
export function ProviderSetup({ kind, provider }: { kind: 'stt' | 'llm'; provider: string }) {
  const { snap, lang, refresh } = useApp();
  const L = useL();
  const g = GUIDES[lang][provider];
  const saved = snap.secrets.keys[provider];
  const [value, setValue] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!saved);
  useEffect(() => {
    setTest(null);
    setOpen(!snap.secrets.keys[provider]);
    setValue('');
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return null;

  const errText = (r: TestResult) =>
    ({
      auth: L('Der Schlüssel wurde abgelehnt. Ist er vollständig kopiert?', 'The key was rejected. Was it copied completely?'),
      quota: L('Der Schlüssel stimmt, aber es fehlt Guthaben oder das Limit ist erreicht.', 'The key is valid, but credit is missing or the limit is reached.'),
      network: L('Keine Verbindung – bitte Internet prüfen.', 'No connection – please check your internet.'),
      timeout: L('Der Dienst antwortet gerade nicht. Später nochmal versuchen.', 'The service is not responding. Try again later.'),
      bad_request: L('Anfrage abgelehnt – evtl. ist das Modell in deinem Konto nicht freigeschaltet.', 'Request rejected – the model may not be enabled for your account.'),
    })[r.code || ''] || `${L('Fehler', 'Error')}: ${r.message || r.code}`;

  const save = async (key: string) => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    await window.api.call('secret:set', provider, k);
    setValue('');
    const r = await window.api.call<TestResult>('service:test', kind, provider);
    setTest(r);
    setBusy(false);
    if (r.ok) setOpen(false);
    await refresh();
  };

  return (
    <div className="guide">
      <div className="guide-head">
        <strong>{g.name}</strong>
        <span className="hint">{g.cost}</span>
      </div>

      {saved && !open ? (
        <div className="key-ok">
          <span className={'badge ' + (test && !test.ok ? 'bad' : 'ok')}>
            {test && !test.ok ? '✗' : '✓'} {L('Schlüssel gespeichert', 'Key saved')} {saved.hint}
          </span>
          {test?.ok && <span className="hint">{L('funktioniert', 'works')} ({test.ms} ms)</span>}
          {test && !test.ok && <span className="hint error">{errText(test)}</span>}
          <span className="spacer" />
          <button
            className="btn small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setTest(await window.api.call<TestResult>('service:test', kind, provider));
              setBusy(false);
            }}
          >
            {busy ? L('Prüfe …', 'Checking …') : L('Prüfen', 'Check')}
          </button>
          <button className="btn small" onClick={() => setOpen(true)}>
            {L('Ändern', 'Change')}
          </button>
          <button
            className="link"
            onClick={async () => {
              await window.api.call('secret:set', provider, '');
              setTest(null);
              setOpen(true);
              refresh();
            }}
          >
            {L('Entfernen', 'Remove')}
          </button>
        </div>
      ) : (
        <>
          <ol className="guide-steps">
            {g.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {g.privacy && <p className="hint">{g.privacy}</p>}
          <div className="key-row">
            <button className="btn primary" onClick={() => window.api.call('shell:openExternal', g.url)}>
              {L('Seite öffnen', 'Open page')} ↗
            </button>
            <input
              className="input mono"
              type="password"
              value={value}
              aria-label={L('API-Schlüssel', 'API key')}
              placeholder={`${L('Schlüssel hier einfügen', 'Paste key here')} (${g.keyHint})`}
              onChange={(e) => setValue(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (text.trim().length > 15) {
                  e.preventDefault();
                  save(text);
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && save(value)}
            />
            <button className="btn" disabled={!value.trim() || busy} onClick={() => save(value)}>
              {busy ? L('Prüfe …', 'Checking …') : L('Speichern', 'Save')}
            </button>
          </div>
          {busy && <p className="hint">{L('Schlüssel wird geprüft …', 'Checking key …')}</p>}
          {test && !test.ok && <div className="banner bad">{errText(test)}</div>}
          {saved && (
            <button className="link" onClick={() => setOpen(false)}>
              {L('Zurück – vorhandenen Schlüssel behalten', 'Back – keep the existing key')}
            </button>
          )}
        </>
      )}
      {!snap.secrets.encrypted && saved && <p className="hint">{L('Hinweis: Auf diesem System ist keine Verschlüsselung verfügbar – der Schlüssel wird nur verschleiert gespeichert.', 'Note: no encryption is available on this system – the key is only obfuscated.')}</p>}
    </div>
  );
}

/** Ist die Spracherkennung startklar? */
export function sttReady(snap: ReturnType<typeof useApp>['snap']) {
  const svc = snap.settings.services;
  if (svc.stt.provider === 'local') return !!snap.local.downloaded[svc.local.model];
  return !!snap.stt[svc.stt.provider]?.keyOptional || !!snap.secrets.keys[svc.stt.provider];
}

/** Welcher Dienst macht gerade die KI-Korrektur (oder keiner)? */
export function llmProvider(snap: ReturnType<typeof useApp>['snap']) {
  const svc = snap.settings.services;
  const has = (p: string) => !!snap.secrets.keys[p] || !!snap.llm[p]?.keyOptional;
  if (svc.llm.provider && svc.llm.provider !== 'auto' && svc.llm.provider !== 'same') return has(svc.llm.provider) ? svc.llm.provider : '';
  if (snap.llm[svc.stt.provider] && svc.stt.provider !== 'local' && has(svc.stt.provider)) return svc.stt.provider;
  return ['groq', 'openai', 'gemini', 'anthropic'].find(has) || '';
}
