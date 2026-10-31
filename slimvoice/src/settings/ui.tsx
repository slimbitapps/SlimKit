import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DeepPartial, Settings, Snapshot } from './types';
import type { T } from './i18n';

export interface Ctx {
  snap: Snapshot;
  s: Settings;
  set: (p: DeepPartial<Settings>) => void;
  t: T;
  lang: 'de' | 'en';
  refresh: () => Promise<void>;
  nav: (page: string) => void;
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function Section({ title, desc, children }: { title?: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {title && <h2>{title}</h2>}
      {desc && <p className="desc">{desc}</p>}
      <div className="card">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={'row' + (wide ? ' wide' : '')}>
      <div className="row-label">
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children !== undefined && <div className="row-control">{children}</div>}
    </div>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={value} aria-label={label} className={'switch' + (value ? ' on' : '')} onClick={() => onChange(!value)}>
        <i />
      </button>
    </label>
  );
}

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: [V, string][]; onChange: (v: V) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Cards<V extends string>({ value, options, onChange, label }: { value: V; options: [V, string, string][]; onChange: (v: V) => void; label: string }) {
  return (
    <div className="choice-cards" role="radiogroup" aria-label={label}>
      {options.map(([v, title, desc]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={'choice' + (value === v ? ' on' : '')} onClick={() => onChange(v)}>
          <span className="dot" />
          <strong>{title}</strong>
          <span>{desc}</span>
        </button>
      ))}
    </div>
  );
}

export function Select({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  return (
    <select className="select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** Textfeld, das erst beim Verlassen (oder Enter) speichert */
export function TextField({ value, onCommit, placeholder, label, list, multiline, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string; list?: string; multiline?: boolean; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  if (multiline)
    return <textarea className={'input' + (mono ? ' mono' : '')} rows={4} value={v} aria-label={label} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />;
  return (
    <input
      className={'input' + (mono ? ' mono' : '')}
      value={v}
      list={list}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Tastenkürzel aufnehmen → Electron-„Accelerator“ */
export function HotkeyInput({ value, onChange, label, allowEmpty }: { value: string; onChange: (v: string) => void; label: string; allowEmpty?: boolean }) {
  const { t, snap } = useApp();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const mac = snap.platform === 'darwin';

  const onKey = async (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') return setRecording(false);
    if ((e.key === 'Backspace' || e.key === 'Delete') && allowEmpty) {
      setRecording(false);
      return onChange('');
    }
    const key = keyName(e);
    if (!key) return; // nur Modifier gedrückt
    const mods = [];
    if (e.metaKey) mods.push(mac ? 'Command' : 'Super');
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    const isF = /^F\d+$/.test(key);
    if (!mods.length && !isF) return setError(t('dict.hotkey.press'));
    const accel = [...mods, key].join('+');
    setRecording(false);
    const ok = await window.api.call<boolean>('hotkey:check', accel);
    if (!ok) return setError(t('dict.hotkey.taken'));
    setError('');
    onChange(accel);
  };

  return (
    <div className="hotkey">
      <button ref={ref} type="button" aria-label={label} className={'kbd-field' + (recording ? ' rec' : '')} onClick={() => setRecording(true)} onBlur={() => setRecording(false)} onKeyDown={onKey}>
        {recording ? t('dict.hotkey.press') : value ? <Keys accel={value} /> : t('dict.hotkey.none')}
      </button>
      {error && <div className="hint error">{error}</div>}
    </div>
  );
}

function keyName(e: React.KeyboardEvent) {
  const k = e.key;
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(k)) return '';
  if (e.code === 'Space') return 'Space';
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(k)) return k;
  const map: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Tab: 'Tab', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Pause: 'Pause' };
  if (map[k]) return map[k];
  const codes: Record<string, string> = { Period: '.', Comma: ',', Minus: '-', Equal: '=', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`' };
  return codes[e.code] || '';
}

function keyLabels(platform: string, lang: string): Record<string, string> {
  const mac = platform === 'darwin';
  const de = lang === 'de';
  return {
    CommandOrControl: mac ? '⌘' : de ? 'Strg' : 'Ctrl',
    Command: '⌘',
    Control: mac ? '⌃' : de ? 'Strg' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : de ? 'Umschalt' : 'Shift',
    Super: 'Win',
    Space: de ? 'Leertaste' : 'Space',
    Return: '↵',
  };
}

export function Keys({ accel }: { accel: string }) {
  const { snap, lang } = useApp();
  const names = keyLabels(snap.platform, lang);
  return (
    <span className="keys">
      {accel.split('+').map((p, i) => (
        <kbd key={i}>{names[p] || p}</kbd>
      ))}
    </span>
  );
}

export function prettyKey(accel: string, platform: string, lang: string) {
  const names = keyLabels(platform, lang);
  const parts = accel.split('+').map((p) => names[p] || p);
  return platform === 'darwin' ? parts.join('') : parts.join('+');
}
