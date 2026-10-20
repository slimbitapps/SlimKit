'use strict';
/**
 * Erzeugt alle Logo-/Symbol-Dateien aus einer Vorlage (SVG) – mit Electron gerendert.
 *   npm run icons
 *
 * Logo-Schema wie alle SlimBit-Apps: abgerundetes Quadrat mit Farbverlauf,
 * dahinter ein halbdurchsichtiges Element, davor ein weißes Motiv.
 * SlimKit: Ordner (hinten, halbdurchsichtig) + weißer Ordner mit Menü-Zeilen und orangem Punkt, Türkis → Blau.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Das Logo (src/assets/logo.svg, 1024×1024). padded = mit Rand (App-Symbol für Mac/Windows). */
function logoSvg({ padded = true } = {}) {
  const svg = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'logo.svg'), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return padded
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(64 64) scale(0.875)">${inner}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${inner}</svg>`;
}

/** Menüleisten-Symbol (Mac: schwarz, wird automatisch hell/dunkel) – Ordner mit Menü-Zeilen */
function traySvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">
    <path d="M2.5 6.2a1.7 1.7 0 0 1 1.7-1.7h3.9l1.6 1.6h8.1a1.7 1.7 0 0 1 1.7 1.7v8.5a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7z" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M6.3 10.4h7.4M6.3 13.4h4.6" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="15.4" cy="13.4" r="1.6" fill="${color}"/>
  </svg>`;
}

function dmgBackground(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${660 * scale}" height="${420 * scale}" viewBox="0 0 660 420">
    <rect width="660" height="420" fill="#f7f7f9"/>
    <text x="330" y="54" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-weight="700" font-size="22" fill="#1c1c1f">SlimKit installieren · Install SlimKit</text>
    <text x="330" y="84" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-size="14" fill="#5f636b">Ziehe das Symbol auf „Programme“ · Drag the icon onto Applications</text>
    <path d="M262 215h120" stroke="#1fa99a" stroke-width="6" stroke-linecap="round"/>
    <path d="M372 199l20 16-20 16" fill="none" stroke="#1fa99a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="330" y="372" text-anchor="middle" font-family="-apple-system, Helvetica, Arial" font-size="12" fill="#8d9098">Danach SlimKit aus „Programme“ starten · Then open it from Applications</text>
  </svg>`;
}

async function render(svg, w, h, out) {
  const win = new BrowserWindow({ width: w, height: h, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`;
  const tmp = path.join(require('node:os').tmpdir(), `slimkit-icon-${w}x${h}.html`);
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 250));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: w, height: h, quality: 'best' }).toPNG());
  win.destroy();
  console.log('✓', path.relative(ROOT, out));
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // zwischen den Bildern nicht beenden
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(ROOT, 'brand'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'brand', 'logo.svg'), logoSvg({ padded: false }));
  fs.writeFileSync(path.join(ROOT, 'brand', 'icon.svg'), logoSvg({ padded: true }));
  await render(logoSvg(), 1024, 1024, path.join(ROOT, 'build', 'icon.png'));
  await render(logoSvg(), 256, 256, path.join(ROOT, 'website', 'icon.png'));
  await render(logoSvg(), 256, 256, path.join(ROOT, 'brand', 'slimkit.png')); // für die Startseite
  await render(traySvg('#000'), 22, 22, path.join(ROOT, 'electron', 'tray', 'trayTemplate.png'));
  await render(traySvg('#000'), 44, 44, path.join(ROOT, 'electron', 'tray', 'trayTemplate@2x.png'));
  await render(logoSvg({ padded: false }), 32, 32, path.join(ROOT, 'electron', 'tray', 'tray.png'));
  await render(logoSvg(), 192, 192, path.join(ROOT, 'public', 'icon.png')); // Handy-Seite
  await render(logoSvg({ padded: false }), 512, 512, path.join(ROOT, 'brand', 'logo-square.png'));
  await render(dmgBackground(1), 660, 420, path.join(ROOT, 'build', 'background.png'));
  await render(dmgBackground(2), 1320, 840, path.join(ROOT, 'build', 'background@2x.png'));
  app.quit();
});
