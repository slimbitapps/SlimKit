import { useEffect, useState } from 'react';
import { Cards, Keys, Row, Section, Segmented, Select, TextField, Toggle, HotkeyInput, useApp } from './ui';
import { LANGUAGES, type Key } from './i18n';
import type { HistoryItem, Level, Mode, Profile, Tempo } from './types';

// ------------------------------------------------------------------ Start
export function Welcome() {
  const { t, s, snap, set, nav, lang } = useApp();
  const sttReady = snap.stt[s.services.stt.provider]?.keyOptional || !!snap.secrets.keys[s.services.stt.provider];
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const mac = snap.platform === 'darwin';
  const where = t(mac ? 'welcome.where.mac' : snap.platform === 'win32' ? 'welcome.where.win' : 'welcome.where.linux');
  const keyText = s.hotkey.toggle ? <Keys accel={s.hotkey.toggle} /> : '—';
  const lead = t('welcome.lead', { key: '\u0000' }).split('\u0000');
  const tryText = t('welcome.try', { key: '\u0000' }).split('\u0000');

  return (
    <div className="page">
      <div className="hero">
        <h1>{t('welcome.title')}</h1>
        <p>
          {lead[0]}
          {keyText}
          {lead[1]}
        </p>
      </div>

      {mac && (
        <Section title={t('welcome.mac')}>
          <Perm label={t('perm.mic')} ok={snap.permissions.mic === 'granted'} what="mic" />
          <Perm label={t('perm.accessibility')} ok={snap.permissions.accessibility} what="accessibility" />
        </Section>
      )}

      <ol className="steps">
        <li className={sttReady ? 'done' : ''}>
          <span className="num">1</span>
          <div className="step-body">
            <strong>{sttReady ? t('welcome.step1.done') : t('welcome.step1')}</strong>
            {!sttReady && (
              <button className="btn primary" onClick={() => nav('services')}>
                {t('welcome.setup')}
              </button>
            )}
          </div>
        </li>
        <li>
          <span className="num">2</span>
          <div className="step-body grow">
            <strong>{t('welcome.step2')}</strong>
            <p className="hint">
              {tryText[0]}
              {keyText}
              {tryText[1]}
              {keyText}
              {tryText[2]}
            </p>
            <textarea className="input try" rows={5} value={text} placeholder={t('welcome.tryPlaceholder')} onChange={(e) => setText(e.target.value)} />
            <div className="actions">
              <button
                className="btn"
                disabled={!sttReady}
                onMouseDown={(e) => e.preventDefault() /* Fokus bleibt im Textfeld */}
                onClick={() => {
                  (document.querySelector('.try') as HTMLTextAreaElement)?.focus();
                  setRecording(!recording);
                  window.api.call('dictation:toggle');
                }}
              >
                {recording ? t('welcome.stop') : t('welcome.start')}
              </button>
            </div>
          </div>
        </li>
        <li>
          <span className="num">3</span>
          <div className="step-body">
            <strong>{t('welcome.step3', { where })}</strong>
            {!s.onboarded && (
              <button className="btn primary" onClick={() => set({ onboarded: true })}>
                {t('welcome.done')}
              </button>
            )}
          </div>
        </li>
      </ol>
      <p className="hint center">{lang === 'de' ? 'Tipp: Modus, Tempo und KI-Stufe kannst du auch schnell über das Symbol umstellen.' : 'Tip: you can also switch mode, speed and AI level from the icon.'}</p>
    </div>
  );
}

function Perm({ label, ok, what }: { label: string; ok: boolean; what: string }) {
  const { t, refresh } = useApp();
  return (
    <Row label={label}>
      {ok ? (
        <span className="badge ok">{t('perm.ok')}</span>
      ) : (
        <button
          className="btn"
          onClick={async () => {
            await window.api.call('perm:request', what);
            setTimeout(refresh, 1500);
          }}
        >
          {t('perm.allow')}
        </button>
      )}
    </Row>
  );
}

// ------------------------------------------------------------------ Diktat
export function Dictation() {
  const { t, s, set, snap, lang } = useApp();
  const d = s.dictation;
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setMics(list.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications')))
        .catch(() => {});
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  const langName = (l: [string, string, string]) => (lang === 'de' ? l[1] : l[2]);

  return (
    <div className="page">
      <Section title={t('dict.mode')}>
        <Cards<Mode>
          label={t('dict.mode')}
          value={d.mode}
          onChange={(mode) => set({ dictation: { mode } })}
          options={[
            ['live', t('dict.mode.live'), t('dict.mode.live.d')],
            ['preview', t('dict.mode.preview'), t('dict.mode.preview.d')],
            ['batch', t('dict.mode.batch'), t('dict.mode.batch.d')],
          ]}
        />
      </Section>

      <Section>
        <Row label={t('dict.tempo')} hint={t('dict.tempo.d')}>
          <Segmented<Tempo>
            label={t('dict.tempo')}
            value={d.tempo}
            onChange={(tempo) => set({ dictation: { tempo } })}
            options={[
              ['fast', t('dict.tempo.fast')],
              ['balanced', t('dict.tempo.balanced')],
              ['best', t('dict.tempo.best')],
            ]}
          />
        </Row>
        <Row label={t('dict.language')}>
          <Select label={t('dict.language')} value={d.language} onChange={(language) => set({ dictation: { language } })} options={[['auto', t('dict.language.auto')], ...LANGUAGES.map((l) => [l[0], langName(l)] as [string, string])]} />
        </Row>
      </Section>

      <Section title={t('dict.hotkey')} desc={t('dict.hotkey.d')}>
        <Row label={t('dict.hotkey.toggle')}>
          <HotkeyInput label={t('dict.hotkey.toggle')} value={s.hotkey.toggle} onChange={(toggle) => set({ hotkey: { toggle } })} />
          {!snap.hotkeys.toggle && <div className="hint error">{t('dict.hotkey.taken')}</div>}
        </Row>
        <Row label={t('dict.hotkey.cancel')}>
          <HotkeyInput allowEmpty label={t('dict.hotkey.cancel')} value={s.hotkey.cancel} onChange={(cancel) => set({ hotkey: { cancel } })} />
        </Row>
      </Section>

      <Section title={t('dict.insert')} desc={t('dict.insert.d')}>
        <Row label={t('dict.insert')}>
          <Select
            label={t('dict.insert')}
            value={d.insert}
            onChange={(insert) => set({ dictation: { insert: insert as 'paste' } })}
            options={[
              ['paste', t('dict.insert.paste')],
              ['type', t('dict.insert.type')],
              ['copy', t('dict.insert.copy')],
            ]}
          />
        </Row>
        {d.insert === 'paste' && <Toggle label={t('dict.restore')} value={d.restoreClipboard} onChange={(restoreClipboard) => set({ dictation: { restoreClipboard } })} />}
        <Toggle label={t('dict.trailingSpace')} value={d.trailingSpace} onChange={(trailingSpace) => set({ dictation: { trailingSpace } })} />
      </Section>

      <Section title={t('dict.recording')}>
        <Row label={t('dict.mic')}>
          <Select label={t('dict.mic')} value={d.micId} onChange={(micId) => set({ dictation: { micId } })} options={[['', t('dict.mic.default')], ...mics.map((m, i) => [m.deviceId, m.label || `Mikrofon ${i + 1}`] as [string, string])]} />
        </Row>
        <Row label={t('dict.sensitivity')} hint={t('dict.sensitivity.d')}>
          <input className="range" type="range" min={0} max={100} step={5} value={d.sensitivity} aria-label={t('dict.sensitivity')} onChange={(e) => set({ dictation: { sensitivity: +e.target.value } })} />
        </Row>
        <Row label={t('dict.pause')}>
          <Select
            label={t('dict.pause')}
            value={String(d.pauseMs)}
            onChange={(v) => set({ dictation: { pauseMs: +v } })}
            options={[['0', t('dict.pause.auto')], ...[400, 600, 800, 1000, 1300, 1700, 2200].map((ms) => [String(ms), `${(ms / 1000).toLocaleString()} s`] as [string, string])]}
          />
        </Row>
        <Row label={t('dict.max')}>
          <Select label={t('dict.max')} value={String(d.maxMinutes)} onChange={(v) => set({ dictation: { maxMinutes: +v } })} options={[2, 5, 10, 15, 30, 60].map((n) => [String(n), t('dict.minutes', { n })])} />
        </Row>
        <Row label={t('dict.overlay')}>
          <Segmented
            label={t('dict.overlay')}
            value={d.overlay}
            onChange={(overlay) => set({ dictation: { overlay } })}
            options={[
              ['bottom', t('dict.overlay.bottom')],
              ['top', t('dict.overlay.top')],
            ]}
          />
        </Row>
        <Toggle label={t('dict.processing')} value={d.audioProcessing} onChange={(audioProcessing) => set({ dictation: { audioProcessing } })} />
        <Toggle label={t('dict.sounds')} value={d.sounds} onChange={(sounds) => set({ dictation: { sounds } })} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ KI
export function Ai() {
  const { t, s, set, snap, nav, lang } = useApp();
  const a = s.ai;
  const llmProvider = s.services.llm.provider === 'same' ? (snap.llm[s.services.stt.provider] ? s.services.stt.provider : 'openai') : s.services.llm.provider;
  const llmReady = snap.llm[llmProvider]?.keyOptional || !!snap.secrets.keys[llmProvider];
  const langLabel = (l: [string, string, string]) => (lang === 'de' ? l[1] : l[2]);
  const styleOpts: [string, string][] = [
    ['neutral', t('ai.style.neutral')],
    ['casual', t('ai.style.casual')],
    ['formal', t('ai.style.formal')],
  ];
  const levelOpts: [Level, string][] = (['off', 'punct', 'light', 'strong'] as Level[]).map((l) => [l, t(`ai.level.${l}` as Key)]);
  const updProfile = (i: number, p: Partial<Profile>) => set({ ai: { profiles: a.profiles.map((x, j) => (j === i ? { ...x, ...p } : x)) } });

  return (
    <div className="page">
      {a.level !== 'off' && !llmReady && (
        <div className="banner warn" onClick={() => nav('services')}>
          {t('ai.noLlm')}
        </div>
      )}
      <Section title={t('ai.level')}>
        <Cards<Level> label={t('ai.level')} value={a.level} onChange={(level) => set({ ai: { level } })} options={(['off', 'punct', 'light', 'strong'] as Level[]).map((l) => [l, t(`ai.level.${l}` as Key), t(`ai.level.${l}.d` as Key)])} />
      </Section>

      <Section>
        <Row label={t('ai.style')}>
          <Segmented label={t('ai.style')} value={a.style} onChange={(style) => set({ ai: { style } })} options={styleOpts} />
        </Row>
        <Row label={t('ai.translate')}>
          <Select label={t('ai.translate')} value={a.translateTo} onChange={(translateTo) => set({ ai: { translateTo } })} options={[['', t('ai.translate.none')], ...LANGUAGES.map((l) => [l[0], langLabel(l)] as [string, string])]} />
        </Row>
        <Toggle label={t('ai.fillers')} value={a.removeFillers} onChange={(removeFillers) => set({ ai: { removeFillers } })} />
        <Toggle label={t('ai.commands')} value={a.voiceCommands} onChange={(voiceCommands) => set({ ai: { voiceCommands } })} />
        <Toggle label={t('ai.context')} value={a.useContext} onChange={(useContext) => set({ ai: { useContext } })} />
        <Row label={t('ai.custom')} wide>
          <TextField label={t('ai.custom')} value={a.customInstruction} placeholder={t('ai.custom.ph')} onCommit={(customInstruction) => set({ ai: { customInstruction } })} />
        </Row>
      </Section>

      <Section title={t('ai.vocab')} desc={t('ai.vocab.d')}>
        <TextField
          multiline
          label={t('ai.vocab')}
          value={a.vocabulary.join('\n')}
          placeholder={t('ai.vocab.ph')}
          onCommit={(v) =>
            set({
              ai: {
                vocabulary: v
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            })
          }
        />
      </Section>

      <Section title={t('ai.replace')} desc={t('ai.replace.d')}>
        <div className="table">
          {a.replacements.map((r, i) => (
            <div className="table-row" key={i}>
              <TextField label={t('ai.replace.from')} value={r.from} placeholder={t('ai.replace.from')} onCommit={(from) => set({ ai: { replacements: a.replacements.map((x, j) => (j === i ? { ...x, from } : x)) } })} />
              <span className="arrow">→</span>
              <TextField label={t('ai.replace.to')} value={r.to} placeholder={t('ai.replace.to')} onCommit={(to) => set({ ai: { replacements: a.replacements.map((x, j) => (j === i ? { ...x, to } : x)) } })} />
              <button className="icon-btn" aria-label={t('hist.delete')} onClick={() => set({ ai: { replacements: a.replacements.filter((_, j) => j !== i) } })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => set({ ai: { replacements: [...a.replacements, { from: '', to: '' }] } })}>
            +
          </button>
        </div>
      </Section>

      <Section title={t('ai.profiles')} desc={t('ai.profiles.d')}>
        <div className="table">
          {a.profiles.map((p, i) => (
            <div className="table-row" key={i}>
              <TextField label={t('ai.profiles.app')} value={p.match} placeholder="outlook" onCommit={(match) => updProfile(i, { match })} />
              <Select label={t('ai.level')} value={p.level || 'inherit'} onChange={(level) => updProfile(i, { level: level as Level })} options={[['inherit', `${t('ai.level')}: ${t('ai.inherit')}`], ...levelOpts]} />
              <Select label={t('ai.style')} value={p.style || 'inherit'} onChange={(style) => updProfile(i, { style })} options={[['inherit', `${t('ai.style')}: ${t('ai.inherit')}`], ...styleOpts]} />
              <button className="icon-btn" aria-label={t('hist.delete')} onClick={() => set({ ai: { profiles: a.profiles.filter((_, j) => j !== i) } })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => set({ ai: { profiles: [...a.profiles, { match: '', level: 'inherit', style: 'inherit' }] } })}>
            +
          </button>
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Dienste
export function Services() {
  const { t, s, set, snap } = useApp();
  const stt = s.services.stt;
  const llm = s.services.llm;
  const sttInfo = snap.stt[stt.provider] || snap.stt.openai;
  const llmProvider = llm.provider === 'same' ? (snap.llm[stt.provider] ? stt.provider : 'openai') : llm.provider;
  const llmInfo = snap.llm[llmProvider];
  const tempo = s.dictation.tempo;
  const [expert, setExpert] = useState(!!(stt.model || stt.fastModel || stt.baseUrl || llm.model || llm.baseUrl));

  return (
    <div className="page">
      <Section title={t('svc.stt')} desc={t('svc.stt.d')}>
        <Row label={t('svc.provider')}>
          <Select label={t('svc.provider')} value={stt.provider} onChange={(provider) => set({ services: { stt: { provider, model: '', fastModel: '', baseUrl: '' } } })} options={Object.entries(snap.stt).map(([k, v]) => [k, k === 'custom' ? t('svc.custom') : v.label])} />
        </Row>
        <KeyRow provider={stt.provider} info={sttInfo} />
        {(stt.provider === 'custom' || expert) && (
          <Row label={t('svc.baseUrl')}>
            <TextField mono label={t('svc.baseUrl')} value={stt.baseUrl} placeholder={sttInfo.baseUrl} onCommit={(baseUrl) => set({ services: { stt: { baseUrl } } })} />
          </Row>
        )}
        {expert && (
          <>
            <Row label={t('svc.model')} hint={t('svc.model.auto', { model: sttInfo.main[tempo] })}>
              <TextField mono list="stt-models" label={t('svc.model')} value={stt.model} placeholder={sttInfo.main[tempo]} onCommit={(model) => set({ services: { stt: { model } } })} />
            </Row>
            <Row label={t('svc.previewModel')} hint={t('svc.model.auto', { model: sttInfo.preview || '' })}>
              <TextField mono list="stt-models" label={t('svc.previewModel')} value={stt.fastModel} placeholder={sttInfo.preview} onCommit={(fastModel) => set({ services: { stt: { fastModel } } })} />
            </Row>
            <datalist id="stt-models">
              {sttInfo.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        )}
        <TestRow kind="stt" />
      </Section>

      <Section title={t('svc.llm')} desc={t('svc.llm.d')}>
        <Row label={t('svc.provider')}>
          <Select label={t('svc.provider')} value={llm.provider} onChange={(provider) => set({ services: { llm: { provider, model: '', baseUrl: '' } } })} options={[['same', t('svc.same')], ...Object.entries(snap.llm).map(([k, v]) => [k, k === 'custom' ? t('svc.custom') : v.label] as [string, string])]} />
        </Row>
        {llmInfo && llmProvider !== stt.provider && <KeyRow provider={llmProvider} info={llmInfo} />}
        {llmInfo && (llmProvider === 'custom' || expert) && (
          <Row label={t('svc.baseUrl')}>
            <TextField mono label={t('svc.baseUrl')} value={llm.baseUrl} placeholder={llmInfo.baseUrl} onCommit={(baseUrl) => set({ services: { llm: { baseUrl } } })} />
          </Row>
        )}
        {llmInfo && expert && (
          <Row label={t('svc.model')} hint={t('svc.model.auto', { model: llmInfo.main[tempo] })}>
            <TextField mono list="llm-models" label={t('svc.model')} value={llm.model} placeholder={llmInfo.main[tempo]} onCommit={(model) => set({ services: { llm: { model } } })} />
            <datalist id="llm-models">
              {llmInfo.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Row>
        )}
        <TestRow kind="llm" />
      </Section>

      <Toggle label={t('svc.expert')} value={expert} onChange={setExpert} />
      {!snap.secrets.encrypted && Object.keys(snap.secrets.keys).length > 0 && <p className="hint">{t('svc.key.plain')}</p>}
      <p className="hint">{t('svc.costs')}</p>
      <p className="hint">{t('svc.local')}</p>
    </div>
  );
}

function KeyRow({ provider, info }: { provider: string; info: { keyOptional: boolean; keyUrl: string; label: string } }) {
  const { t, snap, refresh } = useApp();
  const saved = snap.secrets.keys[provider];
  const [v, setV] = useState('');
  const save = async (value: string) => {
    await window.api.call('secret:set', provider, value);
    setV('');
    await refresh();
  };
  return (
    <Row label={`${t('svc.key')} · ${provider === 'custom' ? t('svc.custom') : info.label}`} hint={info.keyOptional ? t('svc.key.optional') : undefined}>
      {saved ? (
        <div className="inline">
          <span className="badge ok">{t('svc.key.saved', { hint: saved.hint })}</span>
          <button className="btn small" onClick={() => save('')}>
            {t('svc.key.remove')}
          </button>
        </div>
      ) : (
        <div className="inline">
          <input
            className="input mono"
            type="password"
            value={v}
            aria-label={t('svc.key')}
            placeholder={t('svc.key.ph')}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => v.trim() && save(v)}
            onKeyDown={(e) => e.key === 'Enter' && v.trim() && save(v)}
          />
          {info.keyUrl && (
            <button className="btn small" onClick={() => window.api.call('shell:openExternal', info.keyUrl)}>
              {t('svc.key.get')}
            </button>
          )}
        </div>
      )}
    </Row>
  );
}

function TestRow({ kind }: { kind: 'stt' | 'llm' }) {
  const { t } = useApp();
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; ms?: number; code?: string; message?: string } | null>(null);
  return (
    <div className="test-row">
      <button
        className="btn small"
        disabled={state?.busy}
        onClick={async () => {
          setState({ busy: true });
          setState(await window.api.call('service:test', kind));
        }}
      >
        {state?.busy ? t('svc.testing') : t('svc.test')}
      </button>
      {state && !state.busy && (
        <span className={'badge ' + (state.ok ? 'ok' : 'bad')} title={state.message}>
          {state.ok ? t('svc.ok', { ms: state.ms ?? 0 }) : t('svc.fail', { msg: t(`err.${state.code}` as Key) || state.code || '' })}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Verlauf
export function History() {
  const { t, s, set, lang } = useApp();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState('');
  const load = () => window.api.call<HistoryItem[]>('history:list').then(setItems);
  useEffect(() => {
    load();
    return window.api.on('history:changed', load);
  }, []);
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div className="page">
      <div className="toolbar">
        <Toggle label={t('hist.keep')} value={s.history.keep} onChange={(keep) => set({ history: { keep } })} />
        {items.length > 0 && (
          <button
            className="btn small"
            onClick={async () => {
              await window.api.call('history:clear');
              load();
            }}
          >
            {t('hist.clear')}
          </button>
        )}
      </div>
      {items.length === 0 && <p className="empty">{t('hist.empty')}</p>}
      <div className="history">
        {items.map((it) => (
          <article key={it.id} className="hist-item">
            <header>
              <span>{fmt.format(new Date(it.at))}</span>
              {it.app && <span className="tag">{it.app}</span>}
              <span className="tag">{t(`dict.mode.${it.mode}` as Key)}</span>
              <span>{t('hist.seconds', { n: it.seconds })}</span>
              <span className="spacer" />
              <button
                className="btn small"
                onClick={() => {
                  window.api.call('clipboard:write', it.text);
                  setCopied(it.id);
                  setTimeout(() => setCopied(''), 1200);
                }}
              >
                {copied === it.id ? t('hist.copied') : t('hist.copy')}
              </button>
              <button
                className="icon-btn"
                aria-label={t('hist.delete')}
                onClick={async () => {
                  await window.api.call('history:remove', it.id);
                  load();
                }}
              >
                ×
              </button>
            </header>
            <p>{it.text}</p>
            {it.raw && (
              <details>
                <summary>{t('hist.raw')}</summary>
                <p className="raw">{it.raw}</p>
              </details>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Allgemein
export function General() {
  const { t, s, set, snap } = useApp();
  return (
    <div className="page">
      <Section>
        <Row label={t('gen.lang')}>
          <Select
            label={t('gen.lang')}
            value={s.ui.lang}
            onChange={(lang) => set({ ui: { lang: lang as 'de' } })}
            options={[
              ['', t('gen.lang.auto')],
              ['de', 'Deutsch'],
              ['en', 'English'],
            ]}
          />
        </Row>
        <Row label={t('gen.theme')}>
          <Segmented
            label={t('gen.theme')}
            value={s.ui.theme}
            onChange={(theme) => set({ ui: { theme } })}
            options={[
              ['system', t('gen.theme.system')],
              ['light', t('gen.theme.light')],
              ['dark', t('gen.theme.dark')],
            ]}
          />
        </Row>
        {snap.platform !== 'linux' && <Toggle label={t('gen.autostart')} value={s.autostart} onChange={(autostart) => set({ autostart })} />}
      </Section>
      <Section title={t('gen.privacy')}>
        <p className="card-text">{t('gen.privacy.d')}</p>
      </Section>
      <p className="hint center">SlimVoice · SlimBit Apps · {t('gen.version', { v: snap.version })}</p>
    </div>
  );
}
