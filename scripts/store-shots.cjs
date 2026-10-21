'use strict';
/**
 * Beschriftete Screenshots für Store, Download-Portale und Social Media (1920×1080).
 * Nimmt die echten Screenshots aus dem E2E-Test (marketing/raw/<sprache>/) und setzt
 * Überschrift, Laptop- und Handy-Rahmen dazu.
 *
 *   for l in de en; do E2E_LANG=$l node test/e2e/run.cjs marketing/raw/$l; done
 *   npx electron scripts/store-shots.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'marketing', 'screenshots');

// [Dateiname, Laptop-Bild, Handy-Bild, Überschrift DE, Unterzeile DE, Überschrift EN, Unterzeile EN]
const SLIDES = [
  ['1-hero', '10-home', null, 'Die fehlenden Rechtsklick-Werkzeuge', 'Für Finder und Explorer – kostenlos für Mac und Windows.', 'The missing right-click tools', 'For Finder and Explorer – free for Mac and Windows.'],
  ['2-structure', '20-structure', null, 'Ordnerstruktur kopieren – ohne Dateien', '„Fotos 2025“ wird zu „Fotos 2026“. Nur die Ordner, keine Fotos.', 'Copy a folder structure – without files', '“Photos 2025” becomes “Photos 2026”. Only folders, no photos.'],
  ['3-yearly', '21-structure-done', null, 'Jedes Jahr von selbst', 'Am 1. Januar ist die neue Ordnung schon da.', 'Every year by itself', 'On 1 January your new folders are already there.'],
  ['4-rightclick', '11-home-selection', null, 'Rechtsklick – und los', 'SlimKit zeigt die passenden Werkzeuge für deine Auswahl.', 'Right-click – and go', 'SlimKit shows the right tools for your selection.'],
  ['5-images', '50-images', null, 'Fotos kleiner machen', 'Für E-Mail, WhatsApp oder Formulare. Die Originale bleiben.', 'Make photos smaller', 'For email, WhatsApp or forms. The originals stay.'],
  ['6-send', '62-send-connected', '61-phone-send', 'Aufs Handy – ohne App', 'QR-Code scannen und laden. Kein Kabel, keine Cloud.', 'To your phone – no app', 'Scan the QR code and download. No cable, no cloud.'],
  ['7-receive', '65-receive', '64-phone-received', 'Fotos vom Handy holen', 'Am Handy auswählen – sie landen direkt im Ordner.', 'Get photos from your phone', 'Pick them on the phone – they land right in the folder.'],
  ['8-rename', '30-rename', null, 'Viele Dateien umbenennen', 'Aus IMG_4821 wird „Urlaub 01“ – mit Vorschau.', 'Rename many files', 'IMG_4821 becomes “Holiday 01” – with a preview.'],
  ['9-sort', '56-sort', null, 'Fotos nach Datum ordnen', 'Automatisch in Ordner nach Monat oder Jahr.', 'Sort photos by date', 'Automatically into folders by month or year.'],
  ['10-auto', '70-auto', null, 'Automatik', 'Downloads aufräumen, neue Jahres-Ordner – von selbst.', 'Automations', 'Tidy Downloads, new year folders – by itself.'],
  ['11-history', '75-history', null, 'Alles rückgängig', 'Jede Änderung steht im Verlauf – ein Klick zurück.', 'Undo everything', 'Every change is in the history – one click back.'],
  ['12-dark', '86-structure-dark', null, 'Hell oder dunkel', 'Einfach- und Expertenmodus, Deutsch und Englisch.', 'Light or dark', 'Simple and expert mode, English and German.'],
];

function html(lang, [, laptop, phone, hDe, sDe, hEn, sEn]) {
  const raw = (n) => 'file://' + path.join(ROOT, 'marketing', 'raw', lang, n + '.png');
  const h = lang === 'de' ? hDe : hEn;
  const s = lang === 'de' ? sDe : sEn;
  const landscape = phone && phone.includes('landscape');
  const phoneOnly = phone && !laptop;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; font-family: -apple-system, 'SF Pro Display', 'Segoe UI', Helvetica, Arial, sans-serif;
    background: radial-gradient(1100px 700px at 85% -10%, rgba(45,212,191,.40), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(59,130,246,.35), transparent 60%), #111216; color: #fff; }
  .head { position: absolute; left: 110px; top: 90px; width: ${phoneOnly ? 760 : 1700}px; }
  .brand { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 28px; color: rgba(255,255,255,.85); margin-bottom: 30px; }
  .brand img { width: 52px; height: 52px; }
  h1 { font-size: ${phoneOnly ? 76 : 68}px; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 22px; }
  p { font-size: 32px; line-height: 1.35; color: rgba(255,255,255,.72); margin: 0; max-width: ${phoneOnly ? 720 : 1400}px; }
  .laptop { position: absolute; left: 110px; top: ${phoneOnly ? 0 : 380}px; width: ${phone ? 1250 : 1460}px; border-radius: 22px; overflow: hidden;
    box-shadow: 0 40px 120px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.08); }
  .laptop img { display: block; width: 100%; }
  .phone { position: absolute; border-radius: 54px; padding: 14px; background: #050506; box-shadow: 0 40px 120px rgba(0,0,0,.6), 0 0 0 3px #2a2b31; }
  .phone img { display: block; border-radius: 42px; width: 100%; }
  .phone.p { right: ${phoneOnly ? 260 : 120}px; top: ${phoneOnly ? 90 : 300}px; width: ${phoneOnly ? 470 : 380}px; }
  .phone.l { right: 90px; top: 520px; width: 760px; border-radius: 44px; }
  .phone.l img { border-radius: 32px; }
  .phone.p.crop { height: ${phoneOnly ? 900 : 760}px; overflow: hidden; }
  </style></head><body>
  <div class="head"><div class="brand"><img src="file://${path.join(ROOT, 'brand', 'slimkit.png')}">SlimKit</div><h1>${h}</h1><p>${s}</p></div>
  ${laptop ? `<div class="laptop"><img src="${raw(laptop)}"></div>` : ''}
  ${phone ? `<div class="phone ${landscape ? 'l' : 'p crop'}"><img src="${raw(phone)}"></div>` : ''}
  </body></html>`;
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  for (const lang of ['de', 'en']) {
    for (const slide of SLIDES) {
      const tmp = path.join(os.tmpdir(), `slimkit-shot-${lang}-${slide[0]}.html`);
      fs.writeFileSync(tmp, html(lang, slide));
      await win.loadFile(tmp);
      await new Promise((r) => setTimeout(r, 400));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1920, height: 1080 });
      const out = path.join(OUT, `${lang}-${slide[0]}.png`);
      fs.writeFileSync(out, img.resize({ width: 1920, height: 1080, quality: 'best' }).toPNG());
      console.log('✓', path.relative(ROOT, out));
    }
  }
  app.quit();
});
