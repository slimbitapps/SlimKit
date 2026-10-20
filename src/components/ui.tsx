import { useEffect, type ReactNode } from 'react';
import { t } from '../i18n';
import { IconClose } from '../icons';
import logoUrl from '../assets/logo.svg';

/** App-Logo im SlimBit-Schema: abgerundetes Quadrat mit Farbverlauf, weißes Motiv (Ordner mit Menü-Zeilen). */
export function Logo({ size = 28 }: { size?: number }) {
  return <img className="logo" src={logoUrl} width={size} height={size} alt="" draggable={false} />;
}

export function Switch({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label?: string; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} data-testid={testId} />;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, desc, children }: { label: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="lbl">
        <div className="t">{label}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      {label && <div className="section-label">{label}</div>}
      <div className="card">{children}</div>
    </div>
  );
}

/** Einfacher Dialog mit Kopf, schließt mit Esc oder Klick daneben */
export function Dialog({ title, onClose, children, wide, foot, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; foot?: ReactNode; testId?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" data-testid={testId}>
        <div className="d-head">
          <h2>{title}</h2>
          <button className="btn icon ghost sm" onClick={onClose} aria-label={t('common.close')}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="d-body">{children}</div>
        {foot && <div className="d-foot">{foot}</div>}
      </div>
    </div>
  );
}
