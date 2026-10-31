'use strict';
/**
 * SlimVoice – Hauptprozess.
 * Läuft im Infobereich (Windows) bzw. in der Menüleiste (Mac). Ein Tastenkürzel startet/beendet das Diktat,
 * ein kleines schwebendes Fenster (nimmt nie den Fokus!) nimmt auf und zeigt den Stand. Der Text landet
 * dort, wo der Cursor steht – man kann währenddessen ganz normal weitertippen.
 */
const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage, screen, clipboard, Menu, Tray, globalShortcut, safeStorage, systemPreferences, protocol, net, session: electronSession } = require('electron');

const isTest = !!process.env.SLIMVOICE_TEST;
if (process.env.SLIMVOICE_USERDATA) app.setPath('userData', process.env.SLIMVOICE_USERDATA);
if (process.env.SLIMVOICE_FAKE_AUDIO) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.SLIMVOICE_FAKE_AUDIO);
}
// Eigenes Schema für die lokale Spracherkennung: mit „cross-origin isolation“ darf WebAssembly mehrere Prozessorkerne nutzen
protocol.registerSchemesAsPrivileged([{ scheme: 'slimvoice', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
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
const { LocalEngine } = require('./core/local-engine.cjs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

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
const hasKey = (p) => !!providers.LLM[p]?.keyOptional || !!keyFor(p);
function resolveModels(cfg) {
  return providers.resolveModels(cfg.services, cfg.dictation.tempo, hasKey);
}
/** Kann die Spracherkennung loslegen? Sonst Fehlercode für die Anzeige */
function sttProblem(cfg, m) {
  if (m.sttProvider === 'local') return localReady(cfg) ? null : { code: 'local_missing' };
  if (!providers.STT[m.sttProvider]?.keyOptional && !keyFor(m.sttProvider)) return { code: 'no_key', provider: m.sttProvider };
  return null;
}
const localKey = (cfg) => (providers.LOCAL_MODELS[cfg.services.local.model] ? cfg.services.local.model : 'small');
const localReady = (cfg) => !!cfg.services.local.ready?.[localKey(cfg)];

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

  const models = resolveModels(cfg);
  const problem = sttProblem(cfg, models);
  if (problem) {
    rec.state = 'idle';
    updateTray();
    overlayEvent({ id, type: 'error', ...problem });
    return;
  }
  // KI-Korrektur gewünscht, aber kein Dienst mit Schlüssel → ohne KI weitermachen statt abzubrechen
  if (cfg.ai.level !== 'off' && (!models.llmModel || !hasKey(models.llmProvider))) {
    models.llmModel = '';
    overlayEvent({ id, type: 'warning', code: 'ai_no_key' });
  }
  if (isMac && !isTest && cfg.dictation.insert !== 'copy' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    overlayEvent({ id, type: 'warning', code: 'mac_accessibility' });
  }

  const appName = await withTimeout(inserter.foregroundApp(), 400, '');
  const insertMethod =
    isMac && !isTest && cfg.dictation.insert !== 'copy' && !systemPreferences.isTrustedAccessibilityClient(false) ? 'copy' : cfg.dictation.insert;
  const sess = new DictationSession({
    id,
    cfg,
    models,
    appName,
    deps: {
      transcribe: (o) =>
        models.sttProvider === 'local'
          ? localTranscribe(o, cfg)
          : providers.transcribe({ ...o, provider: models.sttProvider, apiKey: keyFor(models.sttProvider), baseUrl: cfg.services.stt.baseUrl }),
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

// ------------------------------------------------------------------ Lokale Spracherkennung
const engine = new LocalEngine({
  log,
  create: () => {
    const w = new BrowserWindow({
      show: false,
      width: 200,
      height: 100,
      skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.on('render-process-gone', (_e, d) => log('engine gone', d));
    if (isDev) w.loadURL(new URL('engine.html', process.env.VITE_DEV_SERVER_URL).toString());
    else w.loadURL('slimvoice://app/engine.html');
    return w;
  },
  onEvent: (ev) => {
    if (ev.type === 'error') log('engine', ev.message);
    sendSettings('local:event', { ...ev, status: engine.status });
  },
});

async function localTranscribe(o, cfg) {
  const pcm = o.wav.subarray(44);
  const ab = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
  const res = await engine.send('transcribe', {
    model: providers.LOCAL_MODELS[localKey(cfg)].id,
    device: cfg.services.local.device,
    language: o.language,
    pcm: ab,
  });
  if (!res.ok) throw Object.assign(new Error(res.message), { code: 'local' });
  return res.text;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function registerAppProtocol() {
  protocol.handle('slimvoice', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    return new Response(res.body, {
      status: res.status,
      headers: {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'credentialless',
        'cross-origin-resource-policy': 'same-origin',
      },
    });
  });
}

/** Modell herunterladen und laden; settings.services.local.ready merkt sich fertige Modelle */
async function localDownload(key) {
  const m = providers.LOCAL_MODELS[key];
  if (!m) throw new Error('unknown model');
  settings.update({ services: { local: { model: key } } });
  const res = await engine.send('load', { model: m.id, device: settings.data.services.local.device });
  if (res.ok) settings.update({ services: { local: { ready: { [key]: true } } } });
  sendSettings('settings:changed');
  return res;
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
    local: { models: providers.LOCAL_MODELS, status: engine.status, ramGB: Math.round(os.totalmem() / 1024 ** 3), cores: os.cpus().length },
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
  /** provider: optional einen bestimmten Dienst prüfen (z. B. direkt nach dem Einfügen des Schlüssels) */
  'service:test': async (kind, provider) => {
    const cfg = structuredClone(settings.data);
    if (provider && kind === 'stt') Object.assign(cfg.services.stt, { provider, model: provider === cfg.services.stt.provider ? cfg.services.stt.model : '' });
    if (provider && kind === 'llm') Object.assign(cfg.services.llm, { provider, model: provider === cfg.services.llm.provider ? cfg.services.llm.model : '' });
    const m = resolveModels(cfg);
    const t0 = Date.now();
    try {
      if (kind === 'stt' && m.sttProvider === 'local') {
        if (!localReady(cfg)) throw Object.assign(new Error('not downloaded'), { code: 'local_missing' });
        await localTranscribe({ wav: encodeWav(new Int16Array(16000)), language: cfg.dictation.language }, cfg);
      } else if (kind === 'stt') {
        // 0,6 s leises Rauschen – es geht nur darum, ob Schlüssel, Adresse und Modell stimmen
        const pcm = new Int16Array(9600).map(() => Math.round((Math.random() - 0.5) * 60));
        await providers.transcribe({ provider: m.sttProvider, apiKey: keyFor(m.sttProvider), baseUrl: cfg.services.stt.baseUrl, model: m.sttMain, language: cfg.dictation.language, wav: encodeWav(pcm) });
      } else {
        if (!m.llmProvider) throw Object.assign(new Error('no provider'), { code: 'no_key' });
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
  'local:status': async () => {
    const res = await engine.send('status');
    return { ...res, status: engine.status };
  },
  'local:download': (key) => localDownload(key),
  'local:cancel': () => {
    engine.dispose();
    engine.status.downloading = '';
    sendSettings('local:event', { type: 'cancelled', status: engine.status });
  },
  'local:delete': async (key) => {
    const m = providers.LOCAL_MODELS[key];
    const res = await engine.send('delete', { model: m.id });
    settings.update({ services: { local: { ready: { [key]: false } } } });
    return res;
  },
  'engine:reply': (id, result) => engine.reply(id, result),
  'engine:event': (ev) => engine.event(ev),
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
  engine.dispose();
});
app.on('activate', () => showSettings());

app.whenReady().then(async () => {
  if (isMac) app.dock?.hide();
  // Mikrofon nur für die eigenen Seiten
  electronSession.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && isOwnPage(wc.getURL())));
  electronSession.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && isOwnPage(wc?.getURL() || ''));
  nativeTheme.on('updated', () => sendSettings('theme:changed', nativeTheme.shouldUseDarkColors));

  registerAppProtocol();
  hotkeyStatus = registerHotkeys();
  createOverlay();
  // Lokales Modell schon mal in den Speicher laden, damit das erste Diktat nicht warten muss
  const cfg0 = settings.data;
  if (cfg0.services.stt.provider === 'local' && localReady(cfg0)) {
    setTimeout(() => engine.send('load', { model: providers.LOCAL_MODELS[localKey(cfg0)].id, device: cfg0.services.local.device }).catch(() => {}), 2500);
  }
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
  return url.startsWith('file://') || url.startsWith('slimvoice://') || (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL));
}

// Für den Ende-zu-Ende-Test
if (isTest) {
  globalThis.__slimvoice = { toggleDictation, stopDictation, cancelDictation, rec, history, settings, showSettings, engine, localDownload };
}
module.exports = { quitting: () => quitting };
