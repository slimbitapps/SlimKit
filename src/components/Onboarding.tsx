import { useState } from 'react';
import { t, LANGS } from '../i18n';
import { useStore, updatePrefs, finishOnboarding, call, refreshMenu, updateSettings } from '../store';
import type { Prefs } from '../types';
import { Logo } from './ui';
import { IconArrowLeft, IconArrowRight, IconCheck, IconShield, IconMouse, IconBolt } from '../icons';
import { ArtRightClick, ArtStructure, ArtUndo } from './art';

const MODE_COLORS = ['#14b8a6', '#f97316', '#22c55e', '#10b981', '#6366f1', '#a855f7', '#ef4444', '#0ea5e9', '#eab308', '#64748b', '#ec4899', '#84cc16', '#06b6d4', '#8b5cf6', '#f59e0b', '#94a3b8', '#78716c'];

/** Einführung beim ersten Start: Sprache → Aussehen → Bedienung → Rechtsklick-Menü → So geht's */
export function Onboarding() {
  const prefs = useStore((s) => s.settings.prefs);
  const menu = useStore((s) => s.menu);
  const [installing, setInstalling] = useState(false);
  const isMac = window.api.platform === 'darwin';
  const steps = menu && !menu.unsupported ? ['lang', 'theme', 'mode', 'menu', 'tour'] : ['lang', 'theme', 'mode', 'tour'];
  const [step, setStep] = useState(0);
  const id = steps[step];
  const last = step === steps.length - 1;
  const next = () => (last ? finishOnboarding() : setStep(step + 1));

  return (
    <div className="onb" data-testid="onboarding">
      <div className="onb-top" />
      <div className="onb-body">
        <div className="onb-panel" key={step}>
          {id === 'lang' && (
            <>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Logo size={88} />
              </div>
              <div className="onb-brand">SlimKit</div>
              <div className="welcome-words">Willkommen · Welcome</div>
              <h1>{t('onb.lang.title')}</h1>
              <p className="lead">{t('onb.lang.sub')}</p>
              <div className="choice-grid cols-2">
                {LANGS.map((l) => (
                  <button key={l.id} className={`choice lang-choice ${prefs.lang === l.id ? 'on' : ''}`} onClick={() => updatePrefs({ lang: l.id })} data-testid={`lang-${l.id}`}>
                    <span className="code">{l.id.toUpperCase()}</span>
                    <span className="ch-title">{l.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {id === 'theme' && (
            <>
              <h1>{t('onb.theme.title')}</h1>
              <p className="lead">{t('onb.theme.sub')}</p>
              <div className="choice-grid cols-3">
                {(['light', 'dark', 'system'] as Prefs['theme'][]).map((th) => (
                  <button key={th} className={`choice ${prefs.theme === th ? 'on' : ''}`} onClick={() => updatePrefs({ theme: th })} data-testid={`theme-${th}`}>
                    <div className="theme-preview">
                      <div className={`tp ${th === 'dark' ? 'dark' : 'light'}`}>
                        <i style={{ width: '60%' }} />
                        <b />
                      </div>
                      <div className={`tp ${th === 'light' ? 'light' : 'dark'}`}>
                        <i style={{ width: '40%' }} />
                        <b />
                      </div>
                    </div>
                    <span className="ch-title">{t(`theme.${th}`)}</span>
                    <span className="ch-desc">{t(`theme.${th}.desc`)}</span>
                    <span className="ch-check">
                      <IconCheck size={13} strokeWidth={3} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {id === 'mode' && (
            <>
              <h1>{t('onb.mode.title')}</h1>
              <p className="lead">{t('onb.mode.sub')}</p>
              <div className="choice-grid cols-2">
                {(['simple', 'expert'] as Prefs['mode'][]).map((m) => (
                  <button key={m} className={`choice ${prefs.mode === m ? 'on' : ''}`} style={{ padding: 20 }} onClick={() => updatePrefs({ mode: m })}>
                    <span className={`mode-preview ${m}`}>
                      {Array.from({ length: m === 'simple' ? 8 : 17 }, (_, i) => (
                        <i key={i} style={{ background: MODE_COLORS[i % MODE_COLORS.length] }} />
                      ))}
                    </span>
                    <span className="ch-title" style={{ fontSize: 17 }}>
                      {t(`mode.${m}`)}
                      {m === 'simple' && (
                        <span className="badge accent" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                          {t('mode.recommended')}
                        </span>
                      )}
                    </span>
                    <span className="ch-desc" style={{ marginTop: 4 }}>
                      {t(`mode.${m}.desc`)}
                    </span>
                    <span className="ch-check">
                      <IconCheck size={13} strokeWidth={3} />
                    </span>
                  </button>
                ))}
              </div>
              <p className="faint small" style={{ marginTop: 16 }}>
                {t('onb.mode.hint')}
              </p>
            </>
          )}

          {id === 'menu' && (
            <>
              <div className="onb-art">
                <ArtRightClick mac={isMac} />
              </div>
              <h1>{t('onb.menu.title')}</h1>
              <p className="lead">{t(isMac ? 'onb.menu.sub.mac' : 'onb.menu.sub.win')}</p>
              <div className={`perm-card ${menu?.installed ? 'ok' : ''}`}>
                <div className="perm-ic">
                  <IconMouse size={20} />
                </div>
                <div className="grow">
                  <div className="perm-t">{t('onb.menu.card')}</div>
                  <div className="small muted">{t(isMac ? 'onb.menu.card.mac' : 'onb.menu.card.win')}</div>
                </div>
                {menu?.installed ? (
                  <span className="badge success">
                    <IconCheck size={12} strokeWidth={3} /> {t('onb.menu.done')}
                  </span>
                ) : (
                  <button
                    className="btn primary"
                    disabled={installing}
                    data-testid="onb-menu-install"
                    onClick={async () => {
                      setInstalling(true);
                      await call('menu:install');
                      await refreshMenu();
                      await updateSettings({});
                      setInstalling(false);
                    }}
                  >
                    {t('menu.install')}
                  </button>
                )}
              </div>
              <p className="faint small" style={{ marginTop: 16 }}>
                {t('onb.menu.later')}
              </p>
            </>
          )}

          {id === 'tour' && (
            <>
              <h1>{t('onb.tour.title')}</h1>
              <p className="lead">{t('onb.tour.sub')}</p>
              <div className="tour">
                {[
                  [<ArtRightClick mac={isMac} key="1" />, 1],
                  [<ArtStructure key="2" />, 2],
                  [<ArtUndo key="3" />, 3],
                ].map(([ill, i]) => (
                  <div key={String(i)} className="tour-card">
                    <div className="ill">{ill}</div>
                    <h3>
                      <span className="num">{String(i)}</span>
                      {t(`onb.tour.${i}.title` as 'onb.tour.1.title')}
                    </h3>
                    <p>{t(`onb.tour.${i}.text` as 'onb.tour.1.text')}</p>
                  </div>
                ))}
              </div>
              <div className="safe-note">
                <IconShield size={17} />
                {t('onb.safe')}
              </div>
              <div className="safe-note" style={{ marginTop: 8 }}>
                <IconBolt size={17} />
                {t('onb.auto')}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="onb-foot">
        <div style={{ width: 110 }}>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              <IconArrowLeft size={16} />
              {t('common.back')}
            </button>
          )}
        </div>
        <div className="steps-dots">
          {steps.map((s, i) => (
            <i key={s} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div style={{ width: 110, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary lg" onClick={next} data-testid="onb-next">
            {last ? t('onb.start') : t('common.next')}
            {!last && <IconArrowRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
