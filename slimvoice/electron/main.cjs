'use strict';
/**
 * SlimVoice – Hauptprozess.
 * Läuft im Infobereich (Windows) bzw. in der Menüleiste (Mac). Ein Tastenkürzel startet/beendet das Diktat,
 * ein kleines schwebendes Fenster (nimmt nie den Fokus!) nimmt auf und zeigt den Stand. Der Text landet
 * dort, wo der Cursor steht – man kann währenddessen ganz normal weitertippen.
 */
const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage, screen, clipboard, Menu, Tray, globalShortcut, safeStorage, systemPreferences, session: electronSession } = require('electron');

const isTest = !!process.env.SLIMVOICE_TEST;
if (process.env.SLIMVOICE_USERDATA) app.setPath('userData', process.env.SLIMVOICE_USERDATA);
if (process.env.SLIMVOICE_FAKE_AUDIO) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.SLIMVOICE_FAKE_AUDIO);
}
if (!isTest && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const path = require('node:path');
const fs = require('node:fs');
const { SettingsStore, SecretStore } = require('./core/settings.cjs');
const { History } = require('./core/history.cjs');
const { Inserter } = require('./core/inserter.cjs');
const { DictationSession } = require('./core/session.cjs');
const providers = require('./core/providers.cjs');
const { encodeWav } = require('./core/wav.cjs');
const { makeT, prettyAccel } = require('./core/strings.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
const DIST = path.join(__dirname, '..', 'dist');

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), line);
  } catch {
    /* ignorieren */
  }
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

const userData = app.getPath('userData');
const settings = new SettingsStore(path.join(userData, 'settings.json'));
const secrets = new SecretStore(path.join(userData, 'secrets.json'), {
  available: () => !isTest && safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
});
const history = new History(path.join(userData, 'history.json'));
const inserter = new Inserter({ clipboard, dataDir: userData, log, testFile: process.env.SLIMVOICE_OUTPUT });
const uiLang = () => settings.data.ui.lang || (app.getLocale().startsWith('de') ? 'de' : 'en');
const t = makeT(uiLang);

let settingsWin = null;
let overlay = null;
let tray = null;
let quitting = false;

// ------------------------------------------------------------------ Diktat-Ablauf
/** state: idle | recording */
const rec = { state: 'idle', id: 0, session: null, startedAt: 0, maxTimer: null };
const running = new Set();
let lastText = '';

function sendOverlay(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}
function sendSettings(channel, payload) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, payload);
}
function overlayEvent(ev) {
  sendOverlay('ui:event', ev);
}

function keyFor(provider) {
  return secrets.get(provider);
}
function missingKey() {
  const s = settings.data.services;
  const m = providers.resolveModels(s, settings.data.dictation.tempo);
  if (!providers.STT[m.sttProvider]?.keyOptional && !keyFor(m.sttProvider)) return m.sttProvider;
  if (settings.data.ai.level !== 'off' && !providers.LLM[m.llmProvider]?.keyOptional && !keyFor(m.llmProvider)) return m.llmProvider;
  return '';
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

async function startDictation() {
  if (rec.state !== 'idle') return;
  const cfg = settings.public();
  const id = ++rec.id;
  rec.state = 'recording';
  rec.startedAt = Date.now();
  updateTray();
  showOverlay();

  const missing = missingKey();
  if (missing) {
    rec.state = 'idle';
    updateTray();
    overlayEvent({ id, type: 'error', code: 'no_key', provider: missing });
    return;
  }
  if (isMac && !isTest && cfg.dictation.insert !== 'copy' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    overlayEvent({ id, type: 'warning', code: 'mac_accessibility' });
  }

  const appName = await withTimeout(inserter.foregroundApp(), 400, '');
  const models = providers.resolveModels(cfg.services, cfg.dictation.tempo);
  const insertMethod =
    isMac && !isTest && cfg.dictation.insert !== 'copy' && !systemPreferences.isTrustedAccessibilityClient(false) ? 'copy' : cfg.dictation.insert;
  const sess = new DictationSession({
    id,
    cfg,
    models,
    appName,
    deps: {
      transcribe: (o) =>
        providers.transcribe({ ...o, provider: models.sttProvider, apiKey: keyFor(models.sttProvider), baseUrl: cfg.services.stt.baseUrl }),
      complete: (o) =>
        providers.complete({
          ...o,
          provider: models.llmProvider,
          apiKey: keyFor(models.llmProvider),
          baseUrl: cfg.services.llm.baseUrl,
          model: models.llmModel,
          tempo: cfg.dictation.tempo,
        }),
      insert: async (text) => {
        lastText = text;
        try {
          await inserter.insert(text, insertMethod, cfg.dictation.restoreClipboard);
        } catch (e) {
          log('insert failed', e);
          clipboard.writeText(text);
          overlayEvent({ id, type: 'warning', code: 'insert_failed' });
        }
      },
      emit: (ev) => overlayEvent({ id, ...ev }),
    },
  });
  rec.session = sess;
  if (rec.state !== 'recording' || rec.id !== id) return; // schon wieder abgebrochen
  overlayEvent({ id, type: 'info', app: appName, profile: sess.profile?.match || '' });
  sendOverlay('rec:start', {
    id,
    lang: uiLang(),
    mode: cfg.dictation.mode,
    position: cfg.dictation.overlay,
    micId: cfg.dictation.micId,
    pauseMs: pauseMsFor(cfg),
    sensitivity: cfg.dictation.sensitivity,
    sounds: cfg.dictation.sounds,
    processing: process.env.SLIMVOICE_RAW_AUDIO ? false : cfg.dictation.audioProcessing !== false,
    hotkey: prettyAccel(cfg.hotkey.toggle, process.platform, uiLang()),
  });
  clearTimeout(rec.maxTimer);
  rec.maxTimer = setTimeout(() => rec.id === id && stopDictation(), Math.max(1, cfg.dictation.maxMinutes) * 60000);
}

function pauseMsFor(cfg) {
  if (cfg.dictation.pauseMs > 0) return cfg.dictation.pauseMs;
  return { fast: 550, balanced: 750, best: 950 }[cfg.dictation.tempo] || 750;
}

function stopDictation() {
  if (rec.state !== 'recording') return;
  clearTimeout(rec.maxTimer);
  rec.state = 'idle';
  updateTray();
  sendOverlay('rec:stop', { id: rec.id });
}

function cancelDictation() {
  clearTimeout(rec.maxTimer);
  rec.session?.cancel();
  for (const s of running) s.cancel();
  rec.state = 'idle';
  updateTray();
  sendOverlay('rec:cancel', { id: rec.id });
  hideOverlaySoon(150);
}

function toggleDictation() {
  if (rec.state === 'recording') stopDictation();
  else startDictation();
}

/** Aufnahme ist im Overlay fertig → Rest umwandeln, einfügen, im Verlauf merken */
async function finishSession(id) {
  const sess = rec.session && rec.session.id === id ? rec.session : null;
  if (!sess) return;
  running.add(sess);
  overlayEvent({ id, type: 'state', state: 'processing' });
  try {
    const res = await sess.finish();
    if (sess.cancelled) return;
    if (res.text) {
      const cfg = settings.data;
      if (cfg.history.keep) {
        history.add(
          {
            text: res.text,
            raw: res.raw !== res.text ? res.raw : undefined,
            app: sess.appName || undefined,
            mode: sess.mode,
            seconds: Math.round((Date.now() - sess.startedAt) / 1000),
          },
          cfg.history.max,
        );
        sendSettings('history:changed');
      }
      overlayEvent({ id, type: 'state', state: 'done', text: res.text });
    } else {
      overlayEvent({ id, type: 'state', state: 'empty' });
    }
    if (rec.state === 'idle' && rec.id === id) hideOverlaySoon(res.text ? 1400 : 1800);
  } catch (e) {
    log('finish failed', e);
    overlayEvent({ id, type: 'error', code: e.code || 'error', message: String(e.message || e) });
  } finally {
    running.delete(sess);
  }
}

// ------------------------------------------------------------------ Overlay
function createOverlay() {
  overlay = new BrowserWindow({
    width: 460,
    height: 168,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.webContents.on('will-navigate', (e) => e.preventDefault());
  load(overlay, 'overlay.html');
}
let hideTimer = null;
function showOverlay() {
  clearTimeout(hideTimer);
  if (!overlay || overlay.isDestroyed()) createOverlay();
  const pos = settings.data.dictation.overlay;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const [w, h] = overlay.getSize();
  const x = Math.round(wa.x + (wa.width - w) / 2);
  const y = pos === 'top' ? wa.y + 12 : wa.y + wa.height - h - 12;
  overlay.setBounds({ x, y, width: w, height: h });
  overlay.showInactive();
}
function hideOverlaySoon(ms) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (rec.state === 'idle' && overlay && !overlay.isDestroyed()) {
      overlay.hide();
      sendOverlay('ui:hidden');
    }
  }, ms);
}

// ------------------------------------------------------------------ Einstellungsfenster
function createSettingsWindow(page) {
  const dark = settings.data.ui.theme === 'dark' || (settings.data.ui.theme !== 'light' && nativeTheme.shouldUseDarkColors);
  const saved = settings.data.window || {};
  settingsWin = new BrowserWindow({
    width: saved.width || 940,
    height: saved.height || 680,
    x: saved.x,
    y: saved.y,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'SlimVoice',
    backgroundColor: dark ? '#121316' : '#f5f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    if (isMac) app.dock?.show();
  });
  const remember = () => {
    if (!settingsWin || settingsWin.isDestroyed() || settingsWin.isMaximized()) return;
    settings.data.window = settingsWin.getBounds();
    settings.save();
  };
  settingsWin.on('resized', remember);
  settingsWin.on('moved', remember);
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (isMac) app.dock?.hide();
  });
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  load(settingsWin, 'index.html', page ? { page } : undefined);
}
function showSettings(page) {
  if (!settingsWin || settingsWin.isDestroyed()) return createSettingsWindow(page);
  if (page) sendSettings('nav', page);
  if (settingsWin.isMinimized()) settingsWin.restore();
  settingsWin.show();
  if (isMac) app.dock?.show();
  app.focus({ steal: true });
  settingsWin.focus();
}
function load(win, file, query) {
  if (isDev) {
    const u = new URL(file, process.env.VITE_DEV_SERVER_URL);
    for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
    win.loadURL(u.toString());
  } else win.loadFile(path.join(DIST, file), query ? { query } : undefined);
}

// ------------------------------------------------------------------ Infobereich / Menüleiste
function trayIcon(recording) {
  const name = isMac ? (recording ? 'trayRecTemplate' : 'trayTemplate') : recording ? 'tray-rec' : 'tray';
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray', name + '.png'));
  if (isMac) img.setTemplateImage(true);
  return img;
}
function updateTray() {
  if (isTest) return;
  const recording = rec.state === 'recording';
  if (!tray) {
    tray = new Tray(trayIcon(false));
    tray.on('click', () => (isMac ? tray.popUpContextMenu() : toggleDictation()));
    tray.on('double-click', () => showSettings());
  }
  tray.setImage(trayIcon(recording));
  const cfg = settings.data;
  const key = prettyAccel(cfg.hotkey.toggle, process.platform, uiLang());
  tray.setToolTip(t('tooltip', { key }));
  const radio = (group, values, current, onPick) =>
    values.map((v) => ({ label: t(`${group}.${v}`), type: 'radio', checked: current === v, click: () => onPick(v) }));
  const set = (partial) => {
    settings.update(partial);
    updateTray();
    sendSettings('settings:changed', settings.public());
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: recording ? t('stop') : t('start'), accelerator: cfg.hotkey.toggle || undefined, click: toggleDictation },
      ...(recording ? [{ label: t('cancel'), click: cancelDictation }] : []),
      { type: 'separator' },
      { label: t('mode'), submenu: radio('mode', ['live', 'preview', 'batch'], cfg.dictation.mode, (v) => set({ dictation: { mode: v } })) },
      { label: t('tempo'), submenu: radio('tempo', ['fast', 'balanced', 'best'], cfg.dictation.tempo, (v) => set({ dictation: { tempo: v } })) },
      { label: t('ai'), submenu: radio('ai', ['off', 'punct', 'light', 'strong'], cfg.ai.level, (v) => set({ ai: { level: v } })) },
      { type: 'separator' },
      { label: t('lastCopy'), enabled: !!(lastText || history.items[0]), click: () => clipboard.writeText((lastText || history.items[0]?.text || '').trim()) },
      { label: t('history'), click: () => showSettings('history') },
      { label: t('settings'), click: () => showSettings() },
      { type: 'separator' },
      {
        label: t('quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ------------------------------------------------------------------ Tastenkürzel
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const res = { toggle: true, cancel: true };
  const { toggle, cancel } = settings.data.hotkey;
  if (toggle) {
    try {
      res.toggle = globalShortcut.register(toggle, toggleDictation);
    } catch {
      res.toggle = false;
    }
  }
  if (cancel) {
    try {
      res.cancel = globalShortcut.register(cancel, () => rec.state === 'recording' && cancelDictation());
    } catch {
      res.cancel = false;
    }
  }
  return res;
}

// ------------------------------------------------------------------ IPC
function snapshot() {
  return {
    settings: settings.public(),
    secrets: secrets.summary(),
    platform: process.platform,
    version: app.getVersion(),
    lang: uiLang(),
    stt: Object.fromEntries(Object.entries(providers.STT).map(([k, v]) => [k, { label: v.label, models: v.models, preview: v.preview, main: v.main, baseUrl: v.baseUrl, keyOptional: !!v.keyOptional, keyUrl: v.keyUrl || '' }])),
    llm: Object.fromEntries(Object.entries(providers.LLM).map(([k, v]) => [k, { label: v.label, models: v.models, main: v.main, baseUrl: v.baseUrl, keyOptional: !!v.keyOptional, keyUrl: v.keyUrl || '' }])),
    hotkeys: hotkeyStatus,
    permissions: permissions(),
    dark: nativeTheme.shouldUseDarkColors,
  };
}
function permissions() {
  if (!isMac) return { mic: 'granted', accessibility: true };
  return { mic: systemPreferences.getMediaAccessStatus('microphone'), accessibility: systemPreferences.isTrustedAccessibilityClient(false) };
}
let hotkeyStatus = { toggle: true, cancel: true };

const handlers = {
  'app:snapshot': () => snapshot(),
  'settings:set': (partial) => {
    const before = settings.public();
    settings.update(partial);
    if (JSON.stringify(before.hotkey) !== JSON.stringify(settings.data.hotkey)) hotkeyStatus = registerHotkeys();
    if (before.autostart !== settings.data.autostart) applyAutostart();
    updateTray();
    return snapshot();
  },
  'secret:set': (name, value) => {
    if (!/^[a-z]+$/.test(name)) throw new Error('bad name');
    secrets.set(name, value);
    return secrets.summary();
  },
  /** Probiert ein Tastenkürzel aus, ohne es zu speichern */
  'hotkey:check': (accel) => {
    if (!accel) return true;
    if (accel === settings.data.hotkey.toggle || accel === settings.data.hotkey.cancel) return true;
    try {
      const ok = globalShortcut.register(accel, () => {});
      if (ok) globalShortcut.unregister(accel);
      return ok;
    } catch {
      return false;
    }
  },
  'service:test': async (kind) => {
    const cfg = settings.data;
    const m = providers.resolveModels(cfg.services, cfg.dictation.tempo);
    const t0 = Date.now();
    try {
      if (kind === 'stt') {
        // 0,6 s leises Rauschen – es geht nur darum, ob Schlüssel, Adresse und Modell stimmen
        const pcm = new Int16Array(9600).map(() => Math.round((Math.random() - 0.5) * 60));
        await providers.transcribe({ provider: m.sttProvider, apiKey: keyFor(m.sttProvider), baseUrl: cfg.services.stt.baseUrl, model: m.sttMain, language: cfg.dictation.language, wav: encodeWav(pcm) });
      } else {
        const out = await providers.complete({
          provider: m.llmProvider,
          apiKey: keyFor(m.llmProvider),
          baseUrl: cfg.services.llm.baseUrl,
          model: m.llmModel,
          tempo: cfg.dictation.tempo,
          system: 'Reply with the single word OK.',
          user: 'Ping',
        });
        if (!out) throw Object.assign(new Error('empty'), { code: 'empty' });
      }
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, code: e.code || 'error', message: String(e.message || e).slice(0, 300) };
    }
  },
  'dictation:toggle': () => toggleDictation(),
  'dictation:cancel': () => cancelDictation(),
  'history:list': () => history.items,
  'history:remove': (id) => history.remove(id),
  'history:clear': () => history.clear(),
  'clipboard:write': (text) => clipboard.writeText(String(text)),
  'perm:request': async (what) => {
    if (!isMac) return permissions();
    if (what === 'mic') await systemPreferences.askForMediaAccess('microphone');
    if (what === 'accessibility') {
      systemPreferences.isTrustedAccessibilityClient(true);
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
    return permissions();
  },
  'shell:openExternal': (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  },
  'app:log': (...a) => log('renderer', ...a),
  // vom Overlay
  'overlay:action': (action) => {
    if (action === 'stop') stopDictation();
    else if (action === 'cancel') cancelDictation();
    else if (action === 'settings') {
      cancelDictation();
      showSettings('services');
    } else if (action === 'close') hideOverlaySoon(0);
  },
  'rec:segment': (id, idx, buf) => {
    if (rec.session?.id !== id) return;
    rec.session.addSegment(idx, new Int16Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf));
  },
  'rec:stopped': (id) => finishSession(id),
  'rec:error': (id, code, message) => {
    log('recorder error', code, message);
    if (rec.id === id) {
      rec.state = 'idle';
      updateTray();
    }
    overlayEvent({ id, type: 'error', code: code || 'mic', message });
  },
};
for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...args) => fn(...args));

function applyAutostart() {
  if (isTest || process.platform === 'linux') return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.data.autostart, openAsHidden: true, args: ['--hidden'] });
  } catch (e) {
    log('autostart', e);
  }
}

// ------------------------------------------------------------------ Start
app.on('second-instance', () => showSettings());
app.on('window-all-closed', () => {
  /* läuft im Hintergrund weiter */
});
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  inserter.dispose();
});
app.on('activate', () => showSettings());

app.whenReady().then(async () => {
  if (isMac) app.dock?.hide();
  // Mikrofon nur für die eigenen Seiten
  electronSession.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && isOwnPage(wc.getURL())));
  electronSession.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && isOwnPage(wc?.getURL() || ''));
  nativeTheme.on('updated', () => sendSettings('theme:changed', nativeTheme.shouldUseDarkColors));

  hotkeyStatus = registerHotkeys();
  createOverlay();
  updateTray();
  inserter.warmup();
  applyAutostart();

  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings?.().wasOpenedAtLogin;
  if (!hidden || !settings.data.onboarded) showSettings(settings.data.onboarded ? undefined : 'welcome');
  if (isMac && !isTest && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
});

function isOwnPage(url) {
  return url.startsWith('file://') || (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL));
}

// Für den Ende-zu-Ende-Test
if (isTest) {
  globalThis.__slimvoice = { toggleDictation, stopDictation, cancelDictation, rec, history, settings, showSettings };
}
module.exports = { quitting: () => quitting };
