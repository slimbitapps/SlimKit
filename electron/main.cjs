'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage, screen, dialog, clipboard, Menu, Tray, Notification } = require('electron');

// Zweiter Start (z. B. Rechtsklick auf weitere Datei): sofort an die laufende App übergeben und beenden
const isTest = !!process.env.SLIMKIT_TEST;
if (process.env.SLIMKIT_USERDATA) app.setPath('userData', process.env.SLIMKIT_USERDATA);
if (!isTest && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const QRCode = require('qrcode');
const { SettingsStore } = require('./core/settings.cjs');
const { History } = require('./core/history.cjs');
const { walk, uniquePath, kindOf, extOf, splitName, safeName, exists, statSafe, dirSize } = require('./core/fsutil.cjs');
const structure = require('./core/structure.cjs');
const { computeRenames, applyRenames } = require('./core/rename.cjs');
const dates = require('./core/dates.cjs');
const organize = require('./core/organize.cjs');
const { mergeToPdf, splitPdf } = require('./core/pdf.cjs');
const { TransferServer } = require('./core/transfer.cjs');
const { listAddresses, pickAddress } = require('./core/network.cjs');
const cm = require('./core/contextmenu.cjs');
const { AutomationRunner } = require('./core/automations.cjs');
const { makeT, kindNames } = require('./core/strings.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const DIST = path.join(__dirname, '..', 'dist');
const HEADER_H = 52;
const THEMES = {
  dark: { bg: '#121316', header: '#121316', symbols: '#e9eaee' },
  light: { bg: '#f5f5f7', header: '#f5f5f7', symbols: '#1c1c1e' },
};

// Einfaches Fehlerprotokoll (bleibt lokal)
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

const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
const t = makeT(() => settings.data.prefs.lang || (app.getLocale().startsWith('de') ? 'de' : 'en'));

/** Papierkorb (im Test: eigener Ordner statt echtem Papierkorb) */
const TEST_TRASH = path.join(app.getPath('userData'), 'test-trash');
async function trash(p) {
  if (isTest) {
    fs.mkdirSync(TEST_TRASH, { recursive: true });
    await fsp.rename(p, uniquePath(path.join(TEST_TRASH, path.basename(p))));
    return;
  }
  await shell.trashItem(p);
}
async function setCreated(p, d) {
  await dates.setCreatedBatch([{ path: p, created: d }]);
}
const history = new History(path.join(app.getPath('userData'), 'history.json'), { trash, setCreated });

let win = null;
let tray = null;
let quitting = false;
let pendingLaunch = null;
let launchTimer = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function isDark(theme) {
  return theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
}
function notify(title, body) {
  if (isTest || !Notification.isSupported()) return;
  try {
    new Notification({ title, body, silent: true }).show();
  } catch {
    /* egal */
  }
}

// ------------------------------------------------------------------ Hauptfenster
function createWindow() {
  const saved = settings.data.window || {};
  const { workAreaSize } = screen.getPrimaryDisplay();
  const colors = THEMES[isDark(settings.data.prefs.theme) ? 'dark' : 'light'];
  win = new BrowserWindow({
    width: Math.min(saved.width || 1080, workAreaSize.width),
    height: Math.min(saved.height || 740, workAreaSize.height),
    x: saved.x,
    y: saved.y,
    minWidth: 820,
    minHeight: 580,
    backgroundColor: colors.bg,
    title: 'SlimKit',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 18 } } : { titleBarOverlay: { color: colors.header, symbolColor: colors.symbols, height: HEADER_H } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    win.show();
    if (isMac) app.dock?.show();
  });
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    settings.data.window = win.getBounds();
    settings.save();
  };
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('closed', () => {
    win = null;
    if (!keepInBackground()) app.quit();
    else if (isMac) app.dock?.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (isDev) win.loadURL(new URL('index.html', process.env.VITE_DEV_SERVER_URL).toString());
  else win.loadFile(path.join(DIST, 'index.html'));
}
function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    if (isMac) app.dock?.show();
    app.focus({ steal: true });
    win.focus();
  }
}

/** Im Hintergrund weiterlaufen, wenn Automatik eingeschaltet ist */
function keepInBackground() {
  if (isTest || quitting) return false;
  return settings.data.background.tray && settings.data.automations.some((a) => a.enabled);
}
function updateTray() {
  const want = keepInBackground();
  if (!want) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'tray', isMac ? 'trayTemplate.png' : 'tray.png'));
    if (isMac) icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('SlimKit');
    tray.on('click', () => !isMac && showWindow());
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('tray.open'), click: showWindow },
      { label: t('tray.auto'), enabled: false },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ------------------------------------------------------------------ Start über Rechtsklick
/** Launcher = Programm (+ App-Ordner im Entwicklungsmodus) */
function launcher() {
  return app.isPackaged ? [process.execPath] : [process.execPath, path.resolve(__dirname, '..')];
}
function appBundle() {
  if (!isMac || !app.isPackaged) return null;
  const m = /^(.*?\.app)\//.exec(process.execPath);
  return m ? m[1] : null;
}

function queueLaunch(argv) {
  const l = cm.parseLaunch(argv, { skip: launcher() });
  if (!l.action) {
    showWindow();
    return;
  }
  // Windows startet bei mehreren markierten Dateien einmal pro Datei → kurz sammeln
  if (pendingLaunch && pendingLaunch.action === l.action) {
    for (const p of l.paths) if (!pendingLaunch.paths.includes(p)) pendingLaunch.paths.push(p);
  } else pendingLaunch = { ...l, paths: [...l.paths] };
  clearTimeout(launchTimer);
  launchTimer = setTimeout(deliverLaunch, isWin ? 450 : 120);
}

async function deliverLaunch() {
  const l = pendingLaunch;
  pendingLaunch = null;
  if (!l) return;
  // Schnelle Aktionen ohne Fenster
  if (l.action === 'copypath') {
    clipboard.writeText(l.paths.join(isWin ? '\r\n' : '\n'));
    notify(t('copied.title'), l.paths.length === 1 ? l.paths[0] : t('copied.many', { n: l.paths.length }));
    return quitIfIdle();
  }
  if (l.action === 'newfile') {
    const dir = l.paths[0] && fs.statSync(l.paths[0]).isDirectory() ? l.paths[0] : path.dirname(l.paths[0] || os.homedir());
    const f = await quickNewFile(dir);
    shell.showItemInFolder(f);
    return quitIfIdle();
  }
  if (l.action === 'newfolder') {
    const r = await quickNewFolder(l.paths);
    if (r) shell.showItemInFolder(r);
    return quitIfIdle();
  }
  const ready = win && !win.isDestroyed() && !win.webContents.isLoading();
  showWindow();
  launchQueue.push(l);
  if (ready) send('launch', l);
}
const launchQueue = [];
function quitIfIdle() {
  if (!win && !keepInBackground()) setTimeout(() => app.quit(), 300);
}

async function quickNewFile(dir, name) {
  const f = uniquePath(path.join(dir, safeName(name || t('new.file'))));
  await fsp.writeFile(f, '', { flag: 'wx' });
  history.add({ tool: 'newfile', title: path.basename(f), count: 1, ops: [{ t: 'create', path: f }] });
  return f;
}
async function quickNewFolder(paths, name) {
  if (!paths.length) return null;
  const parent = path.dirname(paths[0]);
  const dir = uniquePath(path.join(parent, safeName(name || t('new.folder'))));
  await fsp.mkdir(dir);
  const ops = [{ t: 'mkdir', path: dir }];
  for (const p of paths) {
    if (path.dirname(p) !== parent) continue;
    const to = path.join(dir, path.basename(p));
    await fsp.rename(p, to);
    ops.push({ t: 'move', from: p, to });
  }
  history.add({ tool: 'newfolder', title: path.basename(dir), count: paths.length, ops });
  return dir;
}

// ------------------------------------------------------------------ Rechtsklick-Menü einrichten
function menuLabels() {
  return Object.fromEntries(cm.MENU_ACTIONS.map((a) => [a.id, t('menu.' + a.id)]));
}
function servicesDir() {
  return process.env.SLIMKIT_SERVICES_DIR || path.join(os.homedir(), 'Library', 'Services');
}
function sendToLink() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'SendTo', 'SlimKit.lnk');
}
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err || '') })));

async function menuStatus() {
  if (isMac) return { platform: 'darwin', installed: cm.macInstalled(servicesDir()) > 0, count: cm.macInstalled(servicesDir()) };
  if (isWin) {
    const r = await run('reg.exe', ['query', 'HKCU\\Software\\Classes\\Directory\\shell\\SlimKit']);
    return { platform: 'win32', installed: r.ok, sendTo: exists(sendToLink()) };
  }
  return { platform: process.platform, installed: false, unsupported: true };
}

async function installMenu() {
  const actions = settings.data.menu.actions;
  if (isMac) {
    const made = cm.installMac({ dir: servicesDir(), launcher: launcher(), bundle: appBundle(), actions, labels: menuLabels() });
    if (!process.env.SLIMKIT_SERVICES_DIR) await run('/System/Library/CoreServices/pbs', ['-update']);
    settings.update({ menu: { installed: true } });
    return { ok: made.length > 0, count: made.length };
  }
  if (isWin) {
    const exe = launcher();
    const file = path.join(os.tmpdir(), `slimkit-menu-${crypto.randomBytes(4).toString('hex')}.reg`);
    fs.writeFileSync(file, cm.utf16(cm.winRegFile({ launcher: exe, icon: process.execPath, actions, labels: menuLabels() })));
    const r = await run('reg.exe', ['import', file]);
    fs.rmSync(file, { force: true });
    try {
      shell.writeShortcutLink(sendToLink(), { target: exe[0], args: exe.slice(1).map((a) => `"${a}"`).concat('--action=open').join(' '), icon: process.execPath, iconIndex: 0, description: 'SlimKit' });
    } catch (e) {
      log('sendto', e);
    }
    settings.update({ menu: { installed: r.ok } });
    if (!r.ok) log('reg import', r.stderr);
    return { ok: r.ok, error: r.ok ? undefined : r.stderr };
  }
  return { ok: false, error: 'unsupported' };
}

async function uninstallMenu() {
  if (isMac) {
    cm.removeMac(servicesDir());
    if (!process.env.SLIMKIT_SERVICES_DIR) await run('/System/Library/CoreServices/pbs', ['-update']);
  } else if (isWin) {
    const file = path.join(os.tmpdir(), `slimkit-menu-off-${crypto.randomBytes(4).toString('hex')}.reg`);
    fs.writeFileSync(file, cm.utf16(cm.winRegRemoveFile()));
    await run('reg.exe', ['import', file]);
    fs.rmSync(file, { force: true });
    fs.rmSync(sendToLink(), { force: true });
  }
  settings.update({ menu: { installed: false } });
  return { ok: true };
}

/** Beim Start: Menü aktuell halten (App verschoben, neue Version, andere Sprache) */
async function refreshMenu() {
  if (!settings.data.menu.installed || isTest) return;
  try {
    await installMenu();
  } catch (e) {
    log('menu refresh', e);
  }
}

// ------------------------------------------------------------------ Dateien ansehen
async function fileInfo(p) {
  const st = await statSafe(p);
  if (!st) return null;
  const name = path.basename(p);
  const pkg = st.isDirectory() && /\.(app|photoslibrary|bundle|pages|numbers|key|rtfd)$/i.test(name);
  return { path: p, name, dir: path.dirname(p), isDir: st.isDirectory() && !pkg, size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, ext: extOf(name), kind: st.isDirectory() && !pkg ? 'folder' : kindOf(name) };
}

/** Ordner in Dateien auflösen. kinds = nur diese Arten, recursive = auch Unterordner */
async function expand(paths, { kinds, recursive = false, limit = 5000 } = {}) {
  const out = [];
  const want = (name) => !kinds || kinds.includes(kindOf(name));
  for (const p of paths) {
    const info = await fileInfo(p);
    if (!info) continue;
    if (!info.isDir) {
      if (want(info.name)) out.push(info);
    } else {
      for await (const e of walk(p, { maxDepth: recursive ? Infinity : 1 })) {
        if (!e.isDir && want(e.name)) out.push({ path: e.path, name: e.name, dir: path.dirname(e.path), isDir: false, size: e.size, mtimeMs: e.mtimeMs, ext: extOf(e.name), kind: kindOf(e.name), rel: e.rel });
        if (out.length >= limit) break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ------------------------------------------------------------------ Übertragung
let transfer = null;
let transferIdle = null;
async function transferInfo() {
  const s = transfer?.session;
  if (!s) return null;
  const list = listAddresses();
  const a = pickAddress(list, settings.data.transfer.address);
  const host = a ? a.address : '127.0.0.1';
  const url = `http://${host}:${transfer.port}/s/${s.token}/`;
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  return { url, qr, address: a, addresses: list, ...transfer.info(), files: s.files.length, total: s.files.reduce((x, f) => x + f.size, 0) };
}
async function startTransfer({ mode, paths = [], dir }) {
  if (!transfer) {
    transfer = new TransferServer({ root: DIST, port: Number(process.env.SLIMKIT_PORT ?? settings.data.transfer.port) || 0 });
    for (const ev of ['visit', 'download', 'upload-start', 'upload-progress', 'upload-done', 'upload-failed']) {
      transfer.on(ev, (p) => {
        send('transfer:event', { ev, ...p });
        if (ev === 'upload-done') {
          history.add({ tool: 'receive', title: p.name, count: 1, ops: [{ t: 'create', path: p.path }] });
          if (!win || !win.isFocused()) notify(t('received.title'), t('received.body', { name: p.name, device: p.device }));
        }
      });
    }
    transfer.on('error', (e) => log('transfer', e));
    await transfer.start();
  }
  let files = [];
  let title = '';
  if (mode === 'send') {
    // Ordner werden mit Unterordnern geschickt (im ZIP bleibt die Struktur erhalten)
    for (const p of paths) {
      const st = await statSafe(p);
      if (!st) continue;
      if (st.isDirectory()) {
        for await (const e of walk(p)) if (!e.isDir) files.push({ path: e.path, name: e.name, rel: path.basename(p) + '/' + e.rel, size: e.size, mtimeMs: e.mtimeMs });
      } else files.push({ path: p, name: path.basename(p), size: st.size, mtimeMs: st.mtimeMs });
    }
    title = paths.length === 1 ? splitName(path.basename(paths[0]))[0] : 'SlimKit';
  }
  const target = mode === 'receive' ? dir || settings.data.transfer.inbox || app.getPath('downloads') : '';
  transfer.open({ mode, files, dir: target, title });
  clearInterval(transferIdle);
  // Nach 30 Minuten ohne Zugriff endet die Sitzung von selbst
  transferIdle = setInterval(() => {
    if (transfer?.session && Date.now() - transfer.session.active > 30 * 60000) stopTransfer();
  }, 60000);
  return transferInfo();
}
async function stopTransfer() {
  clearInterval(transferIdle);
  if (transfer) {
    await transfer.stop();
    transfer = null;
  }
  send('transfer:event', { ev: 'stopped' });
}

// ------------------------------------------------------------------ Bilder (Umwandeln passiert in der Oberfläche)
/** Bild als Bytes für die Oberfläche. HEIC am Mac vorher mit "sips" in JPEG umwandeln. */
async function readImage(p) {
  const ext = extOf(p);
  if (['heic', 'heif', 'tif', 'tiff'].includes(ext) && isMac) {
    const out = path.join(os.tmpdir(), `slimkit-${crypto.randomBytes(5).toString('hex')}.jpg`);
    const r = await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', p, '--out', out]);
    if (!r.ok) throw new Error('decode');
    const buf = await fsp.readFile(out);
    fs.rmSync(out, { force: true });
    return { bytes: buf, type: 'image/jpeg' };
  }
  const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
  if (!types[ext]) throw new Error('unsupported');
  return { bytes: await fsp.readFile(p), type: types[ext] };
}

/** Umgewandeltes Bild speichern. output: 'folder' (Unterordner), 'next' (daneben mit Zusatz), 'replace' (Original in Papierkorb) */
async function writeImage({ src, bytes, ext, output, suffix }) {
  const [base] = splitName(path.basename(src));
  const dir = path.dirname(src);
  let to;
  if (output === 'folder') {
    const sub = path.join(dir, t('images.folder'));
    await fsp.mkdir(sub, { recursive: true });
    to = uniquePath(path.join(sub, `${base}.${ext}`));
  } else if (output === 'replace') {
    to = path.join(dir, `${base}.${ext}`);
    if (to.toLowerCase() === src.toLowerCase()) {
      await trash(src);
    } else {
      await trash(src);
      to = uniquePath(to);
    }
  } else to = uniquePath(path.join(dir, `${base}${suffix || '-small'}.${ext}`));
  await fsp.writeFile(to, Buffer.from(bytes), { flag: 'wx' });
  // Datum vom Original übernehmen (damit Fotos-Apps richtig sortieren)
  return to;
}

// ------------------------------------------------------------------ IPC
const handle = (ch, fn) =>
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      log('ipc', ch, e);
      throw e;
    }
  });
const progress = (tool) => (i, total) => send('progress', { tool, i, total });

handle('settings:get', () => settings.public());
handle('settings:set', (partial) => {
  const lang = settings.data.prefs.lang;
  settings.update(partial);
  if (partial && partial.prefs && partial.prefs.lang && partial.prefs.lang !== lang) {
    refreshMenu();
    updateTray();
  }
  if (partial && (partial.background || partial.automations)) {
    updateTray();
    runner.rewatch();
    applyAutostart();
  }
  return settings.public();
});
handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform, locale: app.getLocale(), home: os.homedir(), downloads: app.getPath('downloads'), desktop: app.getPath('desktop'), pictures: app.getPath('pictures'), documents: app.getPath('documents') }));
handle('launch:take', () => launchQueue.splice(0));

handle('fs:info', async (paths) => (await Promise.all(paths.map(fileInfo))).filter(Boolean));
handle('fs:expand', (paths, opts) => expand(paths, opts));
handle('fs:pick', async ({ dirs = false, multi = true, title, defaultPath, filters } = {}) => {
  const r = await dialog.showOpenDialog(win, { title, defaultPath, filters, properties: [dirs ? 'openDirectory' : 'openFile', ...(multi ? ['multiSelections'] : []), 'createDirectory'] });
  return r.canceled ? [] : r.filePaths;
});
handle('fs:reveal', (p) => shell.showItemInFolder(p));
handle('fs:open', (p) => shell.openPath(p));
handle('fs:exists', (p) => exists(p));
handle('fs:trash', async (paths) => {
  let done = 0;
  for (const p of paths) {
    try {
      await trash(p);
      done++;
    } catch (e) {
      log('trash', e);
    }
  }
  return { done };
});
handle('fs:dirSize', (p) => dirSize(p));
// Vorschaubild (Fotos, Videos, PDFs) – über die Vorschau des Systems, sonst selbst verkleinert
handle('fs:thumb', async (p, size = 160) => {
  const s = Math.max(32, Math.min(512, Number(size) || 160));
  try {
    if (isMac || isWin) {
      const img = await nativeImage.createThumbnailFromPath(p, { width: s, height: s });
      if (!img.isEmpty()) return img.toDataURL();
    }
  } catch {
    /* weiter mit dem einfachen Weg */
  }
  if (kindOf(path.basename(p)) !== 'image') return null;
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const k = s / Math.max(width, height);
  return img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' }).toJPEG(80).toString('base64').replace(/^/, 'data:image/jpeg;base64,');
});

// Ordnerstruktur
handle('structure:suggest', async (src) => {
  const subs = [];
  for await (const e of walk(src, { maxDepth: 3 })) if (e.isDir) subs.push(e.name);
  const map = structure.suggestYearMap(path.basename(src), subs, settings.data.structure.step || 1);
  return { map, name: structure.applyMap(path.basename(src), map), parent: path.dirname(src) };
});
handle('structure:plan', async (src, dest, opts) => {
  const plan = await structure.planStructure(src, dest, opts);
  return { dirs: plan.dirs.slice(0, 3000), dirCount: plan.dirs.length, newDirs: plan.dirs.filter((d) => !d.exists).length, files: plan.files.length, skippedFiles: plan.skippedFiles, truncated: plan.truncated, destExists: exists(dest) };
});
handle('structure:apply', async (src, dest, opts, title) => {
  const plan = await structure.planStructure(src, dest, opts);
  const r = await structure.applyStructure(dest, plan, progress('structure'));
  const h = history.add({ tool: 'structure', title: title || path.basename(dest), count: r.created + r.copied, ops: r.ops });
  return { ...r, ops: undefined, historyId: h?.id, dest };
});
// Ordner aus einer Liste anlegen (fertige Vorlagen)
handle('structure:create', async (dest, dirs, title) => {
  const plan = structure.planFromTemplate(dirs, dest, {});
  const r = await structure.applyStructure(dest, plan);
  const h = history.add({ tool: 'structure', title: title || path.basename(dest), count: r.created, ops: r.ops });
  return { ...r, ops: undefined, historyId: h?.id, dest };
});
handle('templates:save', async (src, name) => {
  const dirs = await structure.captureTemplate(src);
  const tpl = { id: crypto.randomUUID(), name: name || path.basename(src), dirs, at: Date.now() };
  settings.update({ templates: [...settings.data.templates, tpl] });
  return tpl;
});
handle('templates:remove', (id) => settings.update({ templates: settings.data.templates.filter((x) => x.id !== id) }).templates);
handle('templates:apply', async (id, destParent, name, map) => {
  const tpl = settings.data.templates.find((x) => x.id === id);
  if (!tpl) throw new Error('template');
  const dest = path.join(destParent, safeName(name || tpl.name));
  const plan = structure.planFromTemplate(tpl.dirs, dest, map || {});
  const r = await structure.applyStructure(dest, plan);
  const h = history.add({ tool: 'structure', title: path.basename(dest), count: r.created, ops: r.ops });
  return { ...r, ops: undefined, historyId: h?.id, dest };
});

// Umbenennen
async function withDates(paths, opts) {
  const needDate = /\{(date|time|year|month|day)\}/.test(opts.template || '') || opts.sortBy === 'date';
  return Promise.all(
    paths.map(async (p) => {
      if (!needDate) return { path: p };
      const st = await statSafe(p);
      const d = opts.dateSource === 'modified' ? null : await dates.takenDate(p);
      return { path: p, date: (d || (st ? new Date(st.mtimeMs) : new Date())).getTime() };
    }),
  );
}
handle('rename:preview', async (paths, opts) => computeRenames(await withDates(paths, opts), opts));
handle('rename:apply', async (paths, opts, title) => {
  const plan = computeRenames(await withDates(paths, opts), opts);
  const r = await applyRenames(plan);
  const h = history.add({ tool: 'rename', title, count: r.done, ops: r.ops });
  return { done: r.done, failed: r.failed, historyId: h?.id, renamed: r.ops.map((o) => o.to) };
});

// Datum
handle('dates:preview', async (paths, opts) => {
  const plan = await dates.planDates(paths, { ...opts, date: opts.date ? new Date(opts.date) : null });
  return plan.map((p) => ({ path: p.path, old: p.old, next: p.next ? p.next.getTime() : null }));
});
handle('dates:apply', async (paths, opts, which, title) => {
  const plan = await dates.planDates(paths, { ...opts, date: opts.date ? new Date(opts.date) : null });
  const r = await dates.applyDates(plan, which);
  const h = history.add({ tool: 'dates', title, count: r.done, ops: r.ops });
  return { done: r.done, failed: r.failed, createdFailed: r.createdFailed, historyId: h?.id };
});
handle('dates:read', async (paths) => Promise.all(paths.slice(0, 2000).map(async (p) => ({ path: p, taken: (await dates.takenDate(p))?.getTime() || null, name: dates.dateFromName(path.basename(p))?.getTime() || null }))));

// Bilder
handle('images:read', (p) => readImage(p));
handle('images:write', (o) => writeImage(o));
handle('images:done', (created, title) => {
  const h = history.add({ tool: 'images', title, count: created.length, ops: created.map((p) => ({ t: 'create', path: p })) });
  return h?.id;
});
handle('images:copyTimes', async (src, to) => {
  const st = await statSafe(src);
  if (st) await fsp.utimes(to, st.atime, st.mtime).catch(() => {});
});

// PDF
handle('pdf:merge', async (items, opts) => {
  const loaded = [];
  for (const it of items) {
    if (it.bytes) loaded.push({ name: it.name, type: 'jpg', bytes: Buffer.from(it.bytes) });
    else {
      const ext = extOf(it.path);
      loaded.push({ name: path.basename(it.path), type: ext === 'pdf' ? 'pdf' : ext === 'png' ? 'png' : 'jpg', bytes: await fsp.readFile(it.path) });
    }
  }
  const r = await mergeToPdf(loaded, opts);
  const first = items[0].path || items[0].src;
  const name = safeName((opts.name || (items.length === 1 ? splitName(path.basename(first))[0] : t('pdf.merged'))) + '.pdf');
  const out = uniquePath(path.join(opts.dir || path.dirname(first), name));
  await fsp.writeFile(out, r.bytes, { flag: 'wx' });
  const h = history.add({ tool: 'pdf', title: path.basename(out), count: 1, ops: [{ t: 'create', path: out }] });
  return { out, pages: r.pages, skipped: r.skipped, historyId: h?.id };
});
handle('pdf:split', async (file) => {
  const dir = uniquePath(path.join(path.dirname(file), `${splitName(path.basename(file))[0]} – ${t('pdf.pages')}`));
  const files = await splitPdf(file, dir);
  const h = history.add({ tool: 'pdf', title: path.basename(dir), count: files.length, ops: [{ t: 'mkdir', path: dir }, ...files.map((f) => ({ t: 'create', path: f }))] });
  return { dir, count: files.length, historyId: h?.id };
});

// Aufräumen
handle('sort:preview', async (paths, opts) => (await organize.planSort(paths, { ...opts, kindNames: kindNames(t) })).map((m) => ({ ...m, folder: m.folder.split(path.sep).join('/') })));
handle('sort:apply', async (paths, opts, title) => {
  const moves = await organize.planSort(paths, { ...opts, kindNames: kindNames(t) });
  const r = await organize.applyMoves(moves, progress('sort'));
  const h = history.add({ tool: 'sort', title, count: r.done, ops: r.ops });
  return { done: r.done, failed: r.failed, historyId: h?.id };
});
handle('flatten:preview', async (root) => (await organize.planFlatten(root)).map((m) => ({ ...m, folder: m.folder.split(path.sep).join('/') })));
handle('flatten:apply', async (root, removeEmpty, title) => {
  const moves = await organize.planFlatten(root);
  const r = await organize.applyMoves(moves, progress('flatten'));
  let removed = 0;
  if (removeEmpty) {
    for (const d of await organize.findEmptyDirs(root)) {
      try {
        await trash(d);
        removed++;
      } catch {
        /* weiter */
      }
    }
  }
  const h = history.add({ tool: 'flatten', title, count: r.done, ops: r.ops });
  return { done: r.done, failed: r.failed, removed, historyId: h?.id };
});
handle('empty:find', async (roots) => {
  const out = [];
  for (const r of roots) out.push(...(await organize.findEmptyDirs(r)));
  return out;
});
handle('dupes:find', async (paths) => organize.findDuplicates(paths, { onProgress: (p) => send('progress', { tool: 'dupes', ...p }) }));
handle('size:report', (p) => organize.sizeReport(p));
handle('list:export', async (root, format) => {
  const text = await organize.fileList(root, { format, labels: { name: t('list.name'), folder: t('list.folder'), size: t('list.size'), modified: t('list.modified'), type: t('list.type') } });
  const out = uniquePath(path.join(root, `${t('list.file')} – ${path.basename(root)}.${format === 'txt' ? 'txt' : 'csv'}`));
  await fsp.writeFile(out, text, { flag: 'wx' });
  history.add({ tool: 'list', title: path.basename(out), count: 1, ops: [{ t: 'create', path: out }] });
  return out;
});
handle('hash:compute', async (paths, algo) => {
  const out = [];
  for (const p of paths) out.push({ path: p, hash: await organize.hashFile(p, 0, algo || 'sha256') });
  return out;
});
handle('quick:newfile', (dir, name) => quickNewFile(dir, name));
handle('quick:newfolder', (paths, name) => quickNewFolder(paths, name));
handle('quick:copypath', (paths) => clipboard.writeText(paths.join(isWin ? '\r\n' : '\n')));

// Übertragung
handle('transfer:start', (o) => startTransfer(o));
handle('transfer:stop', () => stopTransfer());
handle('transfer:info', () => transferInfo());
handle('transfer:setAddress', async (a) => {
  settings.update({ transfer: { address: a } });
  return transferInfo();
});

// Verlauf
handle('history:list', () => history.list());
handle('history:undo', (id) => history.undo(id));
handle('history:clear', () => history.clear());

// Automatik
const runner = new AutomationRunner({
  list: () => settings.data.automations,
  update: (id, patch) => {
    settings.data.automations = settings.data.automations.map((a) => (a.id === id ? { ...a, ...patch } : a));
    settings.save();
    send('settings', settings.public());
  },
  history,
  trash,
  notify,
  kindNames: () => kindNames(t),
  t,
  log,
});
handle('auto:preview', (a) => runner.preview(a));
handle('auto:run', async (id) => {
  const r = await runner.run(id);
  send('settings', settings.public());
  return r;
});

// Rechtsklick-Menü
handle('menu:status', () => menuStatus());
handle('menu:install', () => installMenu());
handle('menu:uninstall', () => uninstallMenu());
handle('menu:openSettings', () => {
  if (isMac) shell.openExternal('x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.services');
});

handle('shell:openExternal', (url) => {
  if (typeof url === 'string' && /^https:\/\/|^mailto:/.test(url)) shell.openExternal(url);
});
handle('clipboard:write', (text) => clipboard.writeText(String(text)));
handle('win:theme', (theme) => {
  if (!win || win.isDestroyed() || isMac) return;
  const c = THEMES[isDark(theme) ? 'dark' : 'light'];
  win.setBackgroundColor(c.bg);
  try {
    win.setTitleBarOverlay({ color: c.header, symbolColor: c.symbols, height: HEADER_H });
  } catch {
    /* ältere Systeme */
  }
});
handle('app:log', (...a) => log('renderer', ...a));

function applyAutostart() {
  if (isTest || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.data.background.autostart, openAsHidden: true, args: ['--hidden'] });
  } catch (e) {
    log('autostart', e);
  }
}

// Test-Zugriff für den End-to-End-Test
if (isTest) {
  global.__slimkit = {
    launch: (argv) => queueLaunch(['x', ...argv]),
    transferUrl: () => (transfer?.session ? `http://127.0.0.1:${transfer.port}/s/${transfer.session.token}/` : null),
    servicesDir,
    settings: () => settings.public(),
    setSettings: (partial) => {
      settings.update(partial);
      runner.rewatch();
      send('settings', settings.public());
    },
    trashDir: () => TEST_TRASH,
  };
}

// ------------------------------------------------------------------ Start
app.on('second-instance', (_e, argv) => queueLaunch(argv));

app.whenReady().then(async () => {
  if (isMac && !isTest) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(null);
  const first = cm.parseLaunch(process.argv, { skip: launcher() });
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings?.().wasOpenedAsHidden;
  if (first.action) queueLaunch(process.argv);
  else if (!hidden || !keepInBackground()) createWindow();
  else if (isMac) app.dock?.hide();
  updateTray();
  runner.start();
  refreshMenu();
  applyAutostart();
});

app.on('activate', () => {
  if (!win) createWindow();
});
app.on('window-all-closed', () => {
  if (!keepInBackground()) app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  runner.stop();
  transfer?.stop();
});
