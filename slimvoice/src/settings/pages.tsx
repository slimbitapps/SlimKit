import { useEffect, useRef, useState } from 'react';
import { Cards, Keys, Row, Section, Segmented, Select, TextField, Toggle, HotkeyInput, useApp } from './ui';
import { LANGUAGES, type Key } from './i18n';
import { LLM_PROVIDERS, GUIDES, LOCAL_TEXT } from './guides';
import { LocalModels, ProviderPicker, ProviderSetup, SourceChoice, llmProvider, sttReady, useL } from './setup';
import type { HistoryItem, Level, Mode, Profile, Tempo } from './types';
import logo from '../assets/logo.png';

// ------------------------------------------------------------------ Start
/** Einrichtungs-Assistent beim ersten Start, danach Übersicht + Testfeld */
export function Welcome() {
  const { s } = useApp();
  return s.onboarded ? <Overview /> : <Wizard />;
}

function TryIt() {
  const { s, snap } = useApp();
  const L = useL();
  const [text, setText] = useState('');
  const ready = sttReady(snap);
  return (
    <div className="try-box">
      <p className="hint">
        {L('Klicke in das Feld, drücke', 'Click into the field, press')} {s.hotkey.toggle ? <Keys accel={s.hotkey.toggle} /> : '—'}{' '}
        {L('und sprich. Zum Beenden nochmal drücken – oder einfach mit der Maus:', 'and speak. Press again to finish – or use the mouse:')}
      </p>
      <textarea className="input try" rows={4} value={text} placeholder={L('Hier erscheint dein diktierter Text …', 'Your dictated text appears here …')} onChange={(e) => setText(e.target.value)} />
      <div className="actions">
        <button
          className="btn primary"
          disabled={!ready}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            (document.querySelector('.try') as HTMLTextAreaElement)?.focus();
            window.api.call('dictation:toggle');
          }}
        >
          🎤 {L('Diktat starten / beenden', 'Start / stop dictation')}
        </button>
      </div>
    </div>
  );
}

function Wizard() {
  const { s, snap, set, lang } = useApp();
  const L = useL();
  // Schritt wird gespeichert – wer zwischendurch woanders hinklickt, landet wieder an derselben Stelle
  const step = Math.min(3, Math.max(0, s.wizardStep || 0));
  const setStep = (n: number) => set({ wizardStep: n });
  const local = s.services.stt.provider === 'local';
  const ready = sttReady(snap);
  const llm = llmProvider(snap);
  const mac = snap.platform === 'darwin';
  const [wantAi, setWantAi] = useState<boolean | null>(s.ai.level !== 'off' ? true : null);
  const [aiProvider, setAiProvider] = useState(s.services.stt.provider !== 'local' && LLM_PROVIDERS.includes(s.services.stt.provider) ? s.services.stt.provider : 'groq');
  const steps = [L('Willkommen', 'Welcome'), L('Spracherkennung', 'Speech recognition'), L('KI-Korrektur', 'AI correction'), L('Ausprobieren', 'Try it')];

  const next = (
    <div className="wizard-nav">
      {step > 0 && (
        <button className="btn" onClick={() => setStep(step - 1)}>
          ← {L('Zurück', 'Back')}
        </button>
      )}
      <span className="spacer" />
      {step < 3 ? (
        <button className="btn primary" data-testid="wizard-next" disabled={step === 1 && !ready} onClick={() => setStep(step + 1)}>
          {L('Weiter', 'Next')} →
        </button>
      ) : (
        <button className="btn primary" data-testid="wizard-done" onClick={() => set({ onboarded: true, wizardStep: 0 })}>
          {L('Fertig', 'Done')} ✓
        </button>
      )}
    </div>
  );

  return (
    <div className="page wizard">
      <ol className="wizard-steps" aria-label={L('Schritte', 'Steps')}>
        {steps.map((name, i) => (
          <li key={i} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <span>{i < step ? '✓' : i + 1}</span>
            {name}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <div className="hero">
            <h1>{L('Diktieren, das wirklich funktioniert', 'Dictation that actually works')}</h1>
            <p>
              {L('Drücke', 'Press')} {s.hotkey.toggle && <Keys accel={s.hotkey.toggle} />}{' '}
              {L(
                'in irgendeiner App, sprich – und sauberer Text landet dort, wo dein Cursor steht. Du kannst währenddessen weitertippen. Die Einrichtung dauert zwei Minuten.',
                'in any app, speak – and clean text appears where your cursor is. You can keep typing meanwhile. Setup takes two minutes.',
              )}
            </p>
          </div>
          <h2 className="step-title">{L('Wie soll deine Sprache erkannt werden?', 'How should your speech be recognised?')}</h2>
          <SourceChoice />
          <p className="hint">{L('Du kannst das später jederzeit ändern.', 'You can change this any time later.')}</p>
        </>
      )}

      {step === 1 && (
        <>
          <h2 className="step-title">{local ? L('Sprachmodell herunterladen', 'Download a speech model') : L('Online-Dienst einrichten', 'Set up an online service')}</h2>
          {local ? (
            <LocalModels compact />
          ) : (
            <>
              <ProviderPicker kind="stt" value={s.services.stt.provider} onChange={(provider) => set({ services: { stt: { provider, model: '', fastModel: '', baseUrl: '' } } })} />
              <ProviderSetup kind="stt" provider={s.services.stt.provider} />
            </>
          )}
          {!ready && <p className="hint">{local ? L('Sobald ein Modell heruntergeladen ist, geht es weiter.', 'Continue once a model is downloaded.') : L('Sobald der Schlüssel gespeichert ist, geht es weiter.', 'Continue once the key is saved.')}</p>}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="step-title">{L('Soll eine KI den Text zusätzlich glätten?', 'Should an AI polish the text as well?')}</h2>
          <p className="hint">
            {L(
              'Die Spracherkennung setzt schon Satzzeichen. Die KI-Korrektur geht weiter: Sie korrigiert falsch verstandene Wörter aus dem Zusammenhang, repariert Sätze, die keinen Sinn ergeben, und kann auf Wunsch umformulieren. Dafür braucht sie einen Online-Dienst.',
              'Speech recognition already adds punctuation. AI correction goes further: it fixes misheard words from the context, repairs sentences that make no sense and can rewrite on request. It needs an online service.',
            )}
          </p>
          <div className="choice-cards">
            <button
              type="button"
              className={'choice' + (wantAi === false ? ' on' : '')}
              onClick={() => {
                setWantAi(false);
                set({ ai: { level: 'off' } });
              }}
            >
              <span className="dot" />
              <strong>{L('Nein, erstmal nicht', 'No, not now')}</strong>
              <span>{L('Text kommt so, wie er erkannt wurde. Später in den Einstellungen einschaltbar.', 'Text comes as recognised. Can be switched on later in settings.')}</span>
            </button>
            <button
              type="button"
              className={'choice' + (wantAi ? ' on' : '')}
              onClick={() => {
                setWantAi(true);
                set({ ai: { level: s.ai.level === 'off' ? 'light' : s.ai.level } });
              }}
            >
              <span className="dot" />
              <strong>{L('Ja, Text glätten', 'Yes, polish the text')}</strong>
              <span>{L('Empfohlen für E-Mails und längere Texte.', 'Recommended for emails and longer texts.')}</span>
            </button>
          </div>
          {wantAi && (llm ? (
            <div className="banner ok">
              ✓ {L('KI-Korrektur läuft über', 'AI correction uses')} {GUIDES[lang][llm]?.name || llm}. {L('Stufe „Leicht“ ist eingestellt.', 'Level “Light” is set.')}
            </div>
          ) : (
            <>
              <ProviderPicker kind="llm" value={aiProvider} onChange={setAiProvider} />
              <ProviderSetup kind="llm" provider={aiProvider} />
            </>
          ))}
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="step-title">{L('Ausprobieren', 'Try it')}</h2>
          {mac && (
            <Section title={L('Auf dem Mac braucht SlimVoice zwei Freigaben:', 'On the Mac, SlimVoice needs two permissions:')}>
              <AccessPerm />
              <p className="hint">{L('Das Mikrofon fragt macOS beim ersten Diktat – dann auf „Erlauben“ klicken.', 'macOS asks for the microphone on the first dictation – click “Allow”.')}</p>
            </Section>
          )}
          <TryIt />
          <p className="hint">
            {L('SlimVoice läuft danach im Hintergrund weiter –', 'SlimVoice then keeps running in the background –')}{' '}
            {mac ? L('Symbol oben in der Menüleiste.', 'icon in the menu bar.') : L('Symbol unten rechts in der Taskleiste (ggf. unter dem Pfeil ^).', 'icon at the bottom right of the taskbar (maybe under the ^ arrow).')}
          </p>
        </>
      )}
      {next}
    </div>
  );
}

/** Wie viel wurde schon diktiert – und wie viel Zeit gespart (Tippen: ca. 40 Wörter/Minute) */
function Stats() {
  const L = useL();
  const { lang } = useApp();
  const [items, setItems] = useState<HistoryItem[]>([]);
  useEffect(() => {
    window.api.call<HistoryItem[]>('history:list').then(setItems);
    return window.api.on('history:changed', () => window.api.call<HistoryItem[]>('history:list').then(setItems));
  }, []);
  if (!items.length) return null;
  const words = items.reduce((n, i) => n + (i.text.match(/\S+/g)?.length || 0), 0);
  const speakMin = items.reduce((n, i) => n + i.seconds, 0) / 60;
  const savedMin = Math.max(0, Math.round(words / 40 - speakMin));
  const wpm = speakMin > 0 ? Math.round(words / speakMin) : 0;
  const nf = new Intl.NumberFormat(lang);
  return (
    <div className="stats">
      <div>
        <strong>{nf.format(words)}</strong>
        <span>{L('Wörter diktiert', 'words dictated')}</span>
      </div>
      <div>
        <strong>{nf.format(savedMin)} min</strong>
        <span>{L('gespart gegenüber Tippen', 'saved vs. typing')}</span>
      </div>
      <div>
        <strong>{wpm || '—'}</strong>
        <span>{L('Wörter pro Minute', 'words per minute')}</span>
      </div>
    </div>
  );
}

function Overview() {
  const { s, snap, set, nav, lang, t } = useApp();
  const L = useL();
  const svc = s.services;
  const ready = sttReady(snap);
  const llm = llmProvider(snap);
  const local = svc.stt.provider === 'local';
  const sttName = local ? `${L('Auf diesem Computer', 'On this computer')} · ${LOCAL_TEXT[lang][svc.local.model]?.name}` : svc.stt.provider === 'custom' ? t('svc.custom') : GUIDES[lang][svc.stt.provider]?.name || svc.stt.provider;
  const levelName = { off: L('Aus', 'Off'), punct: L('Nur Satzzeichen', 'Punctuation only'), light: L('Leicht', 'Light'), strong: L('Stark', 'Strong') }[s.ai.level];
  return (
    <div className="page">
      <div className="status-grid">
        <button className="status-card" onClick={() => nav('services')}>
          <span className={'dot-state ' + (ready ? 'ok' : 'bad')} />
          <span className="label">{L('Spracherkennung', 'Speech recognition')}</span>
          <strong>{sttName}</strong>
          {!ready && <span className="hint error">{local ? L('Modell noch nicht heruntergeladen', 'Model not downloaded yet') : L('Schlüssel fehlt', 'Key missing')}</span>}
        </button>
        <button className="status-card" onClick={() => nav('ai')}>
          <span className={'dot-state ' + (s.ai.level === 'off' ? 'off' : llm ? 'ok' : 'bad')} />
          <span className="label">{L('KI-Korrektur', 'AI correction')}</span>
          <strong>{s.ai.level === 'off' ? levelName : `${levelName} · ${llm === 'custom' ? t('svc.custom') : GUIDES[lang][llm]?.name || '—'}`}</strong>
          {s.ai.level !== 'off' && !llm && <span className="hint error">{L('Kein Dienst eingerichtet – wird übersprungen', 'No service set up – skipped')}</span>}
        </button>
        <button className="status-card" onClick={() => nav('dictation')}>
          <span className="dot-state ok" />
          <span className="label">{L('Starten', 'Start')}</span>
          <strong>{s.hotkey.toggle ? <Keys accel={s.hotkey.toggle} /> : '—'}</strong>
          <span className="hint">{L('halten = sprechen · tippen = freihändig', 'hold = talk · tap = hands-free')}</span>
        </button>
      </div>
      <Stats />
      <Section title={L('Ausprobieren', 'Try it')}>
        <TryIt />
      </Section>
      <p className="hint center">
        <button className="link" onClick={() => set({ onboarded: false, wizardStep: 0 })}>
          {L('Einrichtungs-Assistent erneut starten', 'Run the setup assistant again')}
        </button>
      </p>
    </div>
  );
}

/** Mac-Freigabe „Bedienungshilfen“: Knopf + Schritt-für-Schritt-Hilfe. Der Status aktualisiert sich von selbst. */
export function AccessPerm() {
  const { snap } = useApp();
  const L = useL();
  const ok = snap.permissions.accessibility;
  const [asked, setAsked] = useState(false);
  return (
    <div className="perm">
      <Row
        label={L('Bedienungshilfen (zum Einfügen des Textes)', 'Accessibility (to insert the text)')}
        hint={ok ? undefined : L('Ohne diese Freigabe kann SlimVoice den Text nur in die Zwischenablage legen.', 'Without it, SlimVoice can only put the text on the clipboard.')}
      >
        {ok ? (
          <span className="badge ok">✓ {L('Freigegeben', 'Allowed')}</span>
        ) : (
          <button
            className="btn primary"
            onClick={async () => {
              setAsked(true);
              await window.api.call('perm:request', 'accessibility');
            }}
          >
            {L('Freigeben …', 'Allow …')}
          </button>
        )}
      </Row>
      {!ok && asked && (
        <ol className="guide-steps perm-steps">
          <li>{L('Es öffnet sich „Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen“.', '“System Settings → Privacy & Security → Accessibility” opens.')}</li>
          <li>{L('Schalte den Schalter bei „SlimVoice“ ein (ggf. mit Passwort/Touch ID bestätigen).', 'Turn on the switch next to “SlimVoice” (confirm with password/Touch ID if asked).')}</li>
          <li>{L('Fertig – diese Anzeige wird von selbst grün, du musst nichts neu laden.', 'Done – this turns green by itself, no need to reload.')}</li>
          <li>
            <strong>{L('Steht SlimVoice schon in der Liste und ist eingeschaltet, aber hier bleibt es rot?', 'SlimVoice is already in the list and switched on, but this stays red?')}</strong>{' '}
            {L(
              'Das passiert nach einem Update der Testversion: SlimVoice in der Liste markieren, unten auf „–“ klicken, dann hier nochmal „Freigeben …“ und den neuen Eintrag einschalten.',
              'This happens after updating the test version: select SlimVoice in the list, click “–” below, then click “Allow …” here again and switch on the new entry.',
            )}
          </li>
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Diktat
/** Mikrofon ausprobieren: Pegel live anzeigen (aufgenommen wird in der App selbst) */
function MicTest() {
  const L = useL();
  const [level, setLevel] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const stop = () => {
    window.api.call('mic:test', 'stop');
    clearTimeout(timer.current);
    setLevel(null);
  };
  useEffect(() => {
    const off = window.api.on('mic:level', (m: { level?: number; error?: string }) => {
      if (m.error) {
        setErr(m.error);
        setLevel(null);
      } else if (m.level !== undefined) setLevel(m.level);
    });
    return () => {
      off();
      window.api.call('mic:test', 'stop');
    };
  }, []);
  const start = () => {
    setErr('');
    setLevel(0);
    window.api.call('mic:test', 'start');
    timer.current = window.setTimeout(stop, 15000);
  };
  return (
    <Row label={L('Mikrofon testen', 'Test microphone')} hint={level !== null ? L('Sprich etwas – der Balken sollte deutlich ausschlagen.', 'Say something – the bar should move clearly.') : err || undefined}>
      {level === null ? (
        <button className="btn small" onClick={start}>
          {L('Test starten', 'Start test')}
        </button>
      ) : (
        <div className="inline">
          <div className="meter" aria-label={L('Pegel', 'Level')}>
            <i style={{ width: `${Math.round(level * 100)}%` }} className={level > 0.85 ? 'loud' : level > 0.08 ? 'ok' : ''} />
          </div>
          <button className="btn small" onClick={stop}>
            {L('Stopp', 'Stop')}
          </button>
        </div>
      )}
    </Row>
  );
}

export function Dictation() {
  const { t, s, set, snap, lang } = useApp();
  const L = useL();
  const d = s.dictation;
  const [mics, setMics] = useState<string[]>([]);
  useEffect(() => {
    window.api.call<string[]>('mic:list').then(setMics).catch(() => {});
  }, []);
  const expert = s.ui.mode === 'expert';
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
        <Row label={t('dict.hotkey.toggle')} hint={L('Halten = sprechen, loslassen = fertig. Kurz tippen = freihändig (du kannst nebenher tippen), nochmal drücken = fertig.', 'Hold = talk, release = done. Quick tap = hands-free (you can keep typing), press again = done.')}>
          <HotkeyInput label={t('dict.hotkey.toggle')} value={s.hotkey.toggle} onChange={(toggle) => set({ hotkey: { toggle } })} />
          {snap.hotkeys.toggle === false && <div className="hint error">{t('dict.hotkey.taken')}</div>}
        </Row>
        {expert && (
          <Row label={t('dict.hotkey.cancel')}>
            <HotkeyInput allowEmpty label={t('dict.hotkey.cancel')} value={s.hotkey.cancel} onChange={(cancel) => set({ hotkey: { cancel } })} />
          </Row>
        )}
        <Row
          label={L('Befehlsmodus (markierten Text umschreiben)', 'Command mode (rewrite selected text)')}
          hint={L(
            'Text markieren, Kürzel drücken, sagen was passieren soll („mach das förmlicher“, „übersetze ins Englische“, „fasse zusammen“). Ohne Markierung schreibt die KI neuen Text („schreib eine kurze Absage für morgen“). Braucht einen KI-Dienst.',
            'Select text, press the shortcut, say what should happen (“make this more formal”, “translate to English”, “summarise”). Without a selection the AI writes new text. Needs an AI service.',
          )}
        >
          <HotkeyInput allowEmpty label={L('Befehlsmodus', 'Command mode')} value={s.hotkey.command} onChange={(command) => set({ hotkey: { command } })} />
          {snap.hotkeys.command === false && <div className="hint error">{t('dict.hotkey.taken')}</div>}
        </Row>
      </Section>

      {expert && (
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
      )}

      <Section title={t('dict.recording')}>
        <MicTest />
        <Row label={t('dict.mic')}>
          <Select label={t('dict.mic')} value={d.micId} onChange={(micId) => set({ dictation: { micId } })} options={[['', t('dict.mic.default')], ...mics.map((m) => [m, m] as [string, string])]} />
        </Row>
        {expert && (
          <>
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
          </>
        )}
        <Toggle label={t('dict.sounds')} value={d.sounds} onChange={(sounds) => set({ dictation: { sounds } })} />
      </Section>
      {!expert && <ExpertHint />}
    </div>
  );
}

/** Hinweis im Einfach-Modus: es gibt mehr Einstellungen */
export function ExpertHint() {
  const { set } = useApp();
  const L = useL();
  return (
    <p className="hint center">
      {L('Mehr Einstellungen?', 'More settings?')}{' '}
      <button className="link" onClick={() => set({ ui: { mode: 'expert' } })}>
        {L('Expertenmodus einschalten', 'Switch on expert mode')}
      </button>
    </p>
  );
}

// ------------------------------------------------------------------ KI
export function Ai() {
  const { t, s, set, snap, nav, lang } = useApp();
  const a = s.ai;
  const llmReady = !!llmProvider(snap);
  const langLabel = (l: [string, string, string]) => (lang === 'de' ? l[1] : l[2]);
  const styleOpts: [string, string][] = [
    ['neutral', t('ai.style.neutral')],
    ['casual', t('ai.style.casual')],
    ['formal', t('ai.style.formal')],
  ];
  const expert = s.ui.mode === 'expert';

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
        <Toggle label={t('ai.fillers')} value={a.removeFillers} onChange={(removeFillers) => set({ ai: { removeFillers } })} />
        {expert && (
          <>
            <Row label={t('ai.translate')}>
              <Select label={t('ai.translate')} value={a.translateTo} onChange={(translateTo) => set({ ai: { translateTo } })} options={[['', t('ai.translate.none')], ...LANGUAGES.map((l) => [l[0], langLabel(l)] as [string, string])]} />
            </Row>
            <Toggle label={t('ai.commands')} value={a.voiceCommands} onChange={(voiceCommands) => set({ ai: { voiceCommands } })} />
            <Toggle label={t('ai.context')} value={a.useContext} onChange={(useContext) => set({ ai: { useContext } })} />
            <Row label={t('ai.custom')} wide>
              <TextField label={t('ai.custom')} value={a.customInstruction} placeholder={t('ai.custom.ph')} onCommit={(customInstruction) => set({ ai: { customInstruction } })} />
            </Row>
          </>
        )}
      </Section>

      {!expert && <ExpertHint />}
    </div>
  );
}

// ------------------------------------------------------------------ Wörter & Programme
const lines = (v: string) =>
  v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

function ReplacementList({ items, onChange }: { items: { from: string; to: string }[]; onChange: (v: { from: string; to: string }[]) => void }) {
  const { t } = useApp();
  return (
    <div className="table">
      {items.map((r, i) => (
        <div className="table-row" key={i}>
          <TextField label={t('ai.replace.from')} value={r.from} placeholder={t('ai.replace.from')} onCommit={(from) => onChange(items.map((x, j) => (j === i ? { ...x, from } : x)))} />
          <span className="arrow">→</span>
          <TextField label={t('ai.replace.to')} value={r.to} placeholder={t('ai.replace.to')} onCommit={(to) => onChange(items.map((x, j) => (j === i ? { ...x, to } : x)))} />
          <button className="icon-btn" aria-label={t('hist.delete')} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...items, { from: '', to: '' }])}>
        + {t('ai.replace')}
      </button>
    </div>
  );
}

function ProfileCard({ p, onChange, onRemove }: { p: Profile; onChange: (p: Partial<Profile>) => void; onRemove: () => void }) {
  const { t, s } = useApp();
  const L = useL();
  const [open, setOpen] = useState(!p.match);
  const levelOpts: [string, string][] = [['inherit', `${L('Wie allgemein', 'As general')}`], ...(['off', 'punct', 'light', 'strong'] as Level[]).map((l) => [l, t(`ai.level.${l}` as Key)] as [string, string])];
  const styleOpts: [string, string][] = [['inherit', L('Wie allgemein', 'As general')], ['neutral', t('ai.style.neutral')], ['casual', t('ai.style.casual')], ['formal', t('ai.style.formal')]];
  const words = p.vocabulary?.length || 0;
  const reps = p.replacements?.length || 0;
  return (
    <div className="profile">
      <div className="profile-head">
        <TextField label={t('ai.profiles.app')} value={p.match} placeholder={L('Name des Programms, z. B. Word', 'App name, e.g. Word')} list="seen-apps" onCommit={(match) => onChange({ match })} />
        <span className="hint">
          {words} {L('Wörter', 'words')} · {reps} {L('Ersetzungen', 'replacements')}
        </span>
        <button className="btn small" onClick={() => setOpen(!open)}>
          {open ? L('Zuklappen', 'Collapse') : L('Bearbeiten', 'Edit')}
        </button>
        <button className="icon-btn" aria-label={t('hist.delete')} onClick={onRemove}>
          ×
        </button>
      </div>
      {open && (
        <div className="profile-body">
          <label className="field-label">{L('Fachbegriffe, Namen, Kürzel für dieses Programm – eins pro Zeile', 'Terms, names, abbreviations for this app – one per line')}</label>
          <TextField multiline label={L('Wörter', 'Words')} value={(p.vocabulary || []).join('\n')} placeholder={L('z. B.\nIBAN\nRechnungsnummer\nDr. Özdemir', 'e.g.\nIBAN\ninvoice number\nDr. Smith')} onCommit={(v) => onChange({ vocabulary: lines(v) })} />
          <label className="field-label">{L('Ersetzungen nur hier', 'Replacements only here')}</label>
          <ReplacementList items={p.replacements || []} onChange={(replacements) => onChange({ replacements })} />
          <div className="profile-grid">
            <Row label={L('KI-Korrektur hier', 'AI correction here')}>
              <Select label={t('ai.level')} value={p.level || 'inherit'} onChange={(level) => onChange({ level: level as Level })} options={levelOpts} />
            </Row>
            <Row label={t('ai.style')}>
              <Select label={t('ai.style')} value={p.style || 'inherit'} onChange={(style) => onChange({ style })} options={styleOpts} />
            </Row>
          </div>
          {s.ui.mode === 'expert' && (
            <Row label={t('ai.custom')} wide>
              <TextField label={t('ai.custom')} value={p.customInstruction || ''} placeholder={L('z. B. „Antworte immer mit Sie“', 'e.g. “Always use formal address”')} onCommit={(customInstruction) => onChange({ customInstruction })} />
            </Row>
          )}
        </div>
      )}
    </div>
  );
}

export function Words() {
  const { t, s, set } = useApp();
  const L = useL();
  const a = s.ai;
  const [detecting, setDetecting] = useState(false);
  const upd = (i: number, p: Partial<Profile>) => set({ ai: { profiles: a.profiles.map((x, j) => (j === i ? { ...x, ...p } : x)) } });
  const add = (match: string) => set({ ai: { profiles: [...a.profiles, { match, level: 'inherit', style: 'inherit', vocabulary: [], replacements: [] }] } });
  return (
    <div className="page">
      <Section title={L('Meine Wörter (überall)', 'My words (everywhere)')} desc={L('Namen, Fachbegriffe und Kürzel, die oft falsch erkannt werden – eins pro Zeile. Die Erkennung bekommt sie als Hinweis.', 'Names, terms and abbreviations that are often misheard – one per line. Recognition gets them as a hint.')}>
        <TextField multiline label={t('ai.vocab')} value={a.vocabulary.join('\n')} placeholder={t('ai.vocab.ph')} onCommit={(v) => set({ ai: { vocabulary: lines(v) } })} />
      </Section>

      <Section title={t('ai.replace')} desc={L('Was du sagst → was geschrieben wird. Immer, auch ohne KI. Z. B. „mfg“ → „Mit freundlichen Grüßen“.', 'What you say → what is written. Always, even without AI. E.g. “brb” → “be right back”.')}>
        <ReplacementList items={a.replacements} onChange={(replacements) => set({ ai: { replacements } })} />
      </Section>

      <Section
        title={L('Pro Programm', 'Per app')}
        desc={L(
          'Eigene Wörter, Ersetzungen und KI-Einstellungen für einzelne Programme – sie gelten nur, wenn du in diesem Programm diktierst (zusätzlich zu „Meine Wörter“).',
          'Own words, replacements and AI settings for single apps – they apply only when you dictate in that app (in addition to “My words”).',
        )}
      >
        <datalist id="seen-apps">
          {(s.seenApps || []).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="profiles">
          {a.profiles.map((p, i) => (
            <ProfileCard key={i} p={p} onChange={(x) => upd(i, x)} onRemove={() => set({ ai: { profiles: a.profiles.filter((_, j) => j !== i) } })} />
          ))}
        </div>
        <div className="actions left">
          <button
            className="btn primary"
            disabled={detecting}
            onClick={async () => {
              setDetecting(true);
              const name = await window.api.call<string>('app:detect');
              setDetecting(false);
              if (name) add(name);
            }}
          >
            {detecting ? L('Wechsle jetzt in das Programm … (3 s)', 'Switch to the app now … (3 s)') : L('Programm erkennen', 'Detect app')}
          </button>
          <button className="btn" onClick={() => add('')}>
            + {L('Von Hand hinzufügen', 'Add manually')}
          </button>
        </div>
        {(s.seenApps || []).length > 0 && (
          <p className="hint">
            {L('Zuletzt benutzt:', 'Recently used:')}{' '}
            {s.seenApps
              .filter((n) => !a.profiles.some((p) => p.match && n.toLowerCase().includes(p.match.toLowerCase())))
              .slice(0, 8)
              .map((n) => (
                <button key={n} className="chip" onClick={() => add(n)}>
                  + {n}
                </button>
              ))}
          </p>
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Dienste
export function Services() {
  const { t, s, set, snap, lang } = useApp();
  const L = useL();
  const stt = s.services.stt;
  const llm = s.services.llm;
  const local = stt.provider === 'local';
  const custom = stt.provider === 'custom';
  const tempo = s.dictation.tempo;
  const [expert, setExpert] = useState(custom || !!(stt.model || stt.fastModel || stt.baseUrl || llm.model || llm.baseUrl || llm.provider === 'custom'));
  const activeLlm = llmProvider(snap);
  const llmChoice = llm.provider === 'same' ? 'auto' : llm.provider;
  const sttInfo = snap.stt[stt.provider];
  const llmInfoKey = llmChoice === 'auto' ? activeLlm : llmChoice;
  const llmInfo = snap.llm[llmInfoKey];

  return (
    <div className="page">
      <Section title={L('Spracherkennung', 'Speech recognition')} desc={L('Wandelt deine Sprache in Text um.', 'Turns your speech into text.')}>
        <div className="pad">
          <SourceChoice />
          {local && <LocalModels />}
          {!local && !custom && (
            <>
              <ProviderPicker kind="stt" value={stt.provider} onChange={(provider) => set({ services: { stt: { provider, model: '', fastModel: '', baseUrl: '' } } })} />
              <ProviderSetup kind="stt" provider={stt.provider} />
            </>
          )}
          {custom && (
            <>
              <Row label={t('svc.baseUrl')} hint={L('OpenAI-kompatibler Server, z. B. speaches / faster-whisper-server.', 'OpenAI-compatible server, e.g. speaches / faster-whisper-server.')}>
                <TextField mono label={t('svc.baseUrl')} value={stt.baseUrl} placeholder={sttInfo?.baseUrl} onCommit={(baseUrl) => set({ services: { stt: { baseUrl } } })} />
              </Row>
              <KeyRow provider="custom" info={{ keyOptional: true, keyUrl: '', label: t('svc.custom') }} />
              <TestRow kind="stt" />
            </>
          )}
          {expert && !local && sttInfo && (
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
          {expert && (
            <Toggle
              label={L('Eigenen / lokalen Server verwenden (für Profis)', 'Use your own / local server (advanced)')}
              value={custom}
              onChange={(on) => set({ services: { stt: { provider: on ? 'custom' : 'local', model: '', fastModel: '', baseUrl: '' } } })}
            />
          )}
        </div>
      </Section>

      <Section
        title={L('KI-Korrektur', 'AI correction')}
        desc={L('Glättet den Text (Stufe unter „KI-Korrektur“). Optional – ohne Dienst wird sie einfach übersprungen.', 'Polishes the text (level under “AI correction”). Optional – skipped without a service.')}
      >
        <div className="pad">
          <ProviderPicker kind="llm" allowAuto value={llmChoice === 'custom' ? '' : llmChoice} onChange={(provider) => set({ services: { llm: { provider, model: '', baseUrl: '' } } })} />
          {llmChoice === 'auto' ? (
            <p className="hint">
              {activeLlm
                ? `${L('Aktuell', 'Currently')}: ${GUIDES[lang][activeLlm]?.name || activeLlm}`
                : L('Noch kein Dienst mit Schlüssel – wähle oben einen Dienst aus, um ihn einzurichten.', 'No service with a key yet – pick one above to set it up.')}
            </p>
          ) : llmChoice !== 'custom' ? (
            <ProviderSetup kind="llm" provider={llmChoice} />
          ) : null}
          {expert && llmInfo && (
            <Row label={t('svc.model')} hint={t('svc.model.auto', { model: llmInfo.main[tempo] })}>
              <TextField mono list="llm-models" label={t('svc.model')} value={llm.model} placeholder={llmInfo.main[tempo]} onCommit={(model) => set({ services: { llm: { model } } })} />
              <datalist id="llm-models">
                {llmInfo.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Row>
          )}
          {expert && (
            <Toggle label={L('Eigenen / lokalen KI-Server verwenden (z. B. Ollama)', 'Use your own / local AI server (e.g. Ollama)')} value={llmChoice === 'custom'} onChange={(on) => set({ services: { llm: { provider: on ? 'custom' : 'auto', model: '', baseUrl: '' } } })} />
          )}
          {expert && llmChoice === 'custom' && (
            <>
              <Row label={t('svc.baseUrl')}>
                <TextField mono label={t('svc.baseUrl')} value={llm.baseUrl} placeholder={snap.llm.custom.baseUrl} onCommit={(baseUrl) => set({ services: { llm: { baseUrl } } })} />
              </Row>
              <TestRow kind="llm" />
            </>
          )}
        </div>
      </Section>

      <Toggle label={t('svc.expert')} value={expert} onChange={setExpert} />
      <p className="hint">{t('svc.costs')}</p>
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
  const { t, s, set, snap, lang } = useApp();
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
      <Section title={lang === 'de' ? 'Über SlimVoice' : 'About SlimVoice'}>
        <div className="about">
          <img src={logo} alt="" width={64} height={64} />
          <div>
            <strong>SlimVoice {snap.version}</strong>
            <p>{lang === 'de' ? 'Kostenlos, ohne Werbung, ohne Konto – von SlimBit Apps.' : 'Free, no ads, no account – by SlimBit Apps.'}</p>
            <p>
              <button className="link" onClick={() => window.api.call('shell:openExternal', snap.website)}>
                slimbitapps.github.io
              </button>{' '}
              ·{' '}
              <button className="link" onClick={() => window.api.call('shell:openExternal', `mailto:${snap.email}`)}>
                {snap.email}
              </button>
            </p>
          </div>
        </div>
      </Section>
      <Section title={t('gen.privacy')}>
        <p className="card-text">{t('gen.privacy.d')}</p>
      </Section>
      <p className="hint center">SlimVoice · SlimBit Apps · {t('gen.version', { v: snap.version })}</p>
    </div>
  );
}
