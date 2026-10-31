'use strict';
/**
 * Zeichnet die Symbole (Mikrofon) ohne Grafikprogramm: App-Symbol, Infobereich (Windows) und Menüleiste (Mac).
 *   node scripts/make-icons.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');

// ------------------------------------------------------------------ PNG schreiben
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ Formen (Abstandsfunktionen, Koordinaten 0…1)
const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
};
/** Mikrofon: Kapsel, Bügel, Stiel, Fuß */
function micDist(x, y) {
  const capsule = segDist(x, y, 0.5, 0.27, 0.5, 0.47) - 0.13;
  const r = Math.hypot(x - 0.5, y - 0.47);
  let arc = Math.abs(r - 0.235) - 0.035;
  if (y < 0.47) arc = Math.min(segDist(x, y, 0.265, 0.47, 0.265, 0.4), segDist(x, y, 0.735, 0.47, 0.735, 0.4)) - 0.035;
  const stem = segDist(x, y, 0.5, 0.7, 0.5, 0.84) - 0.035;
  const foot = segDist(x, y, 0.37, 0.84, 0.63, 0.84) - 0.035;
  return Math.min(capsule, arc, stem, foot);
}
const roundRect = (x, y, inset, radius) => {
  const qx = Math.abs(x - 0.5) - (0.5 - inset - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - inset - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};

/**
 * layers: [{ dist(x,y), color(x,y) → [r,g,b,a] }] von unten nach oben; 4×4-Überabtastung für glatte Kanten
 */
function render(size, layers) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const l of layers) {
            if (l.dist(x, y) > 0) continue;
            const [lr, lg, lb, la] = l.color(x, y);
            if (la === 0 && l.erase) {
              ca = 0;
              continue;
            }
            const al = la / 255;
            cr = lr * al + cr * (1 - al);
            cg = lg * al + cg * (1 - al);
            cb = lb * al + cb * (1 - al);
            ca = al + ca * (1 - al);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      const n = S * S;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      out[i] = alpha ? Math.round(r / n / alpha) : 0;
      out[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      out[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      out[i + 3] = Math.round(alpha * 255);
    }
  return png(size, out);
}

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const BLUE_A = [111, 140, 255], BLUE_B = [74, 105, 230];
const RED_A = [255, 110, 116], RED_B = [229, 56, 63];
const scaled = (f, s) => (x, y) => f(0.5 + (x - 0.5) / s, 0.5 + (y - 0.5) / s) * s;

/** SlimBit-Logo-Schema: Verlauf, dahinter halbdurchsichtige Sprechblase, davor weißes Mikrofon + Schallwelle */
const VIOLET = [139, 92, 246], BLUE = [59, 130, 246];
function rotBox(x, y, cx, cy, hw, hh, r, deg) {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx, dy = y - cy;
  const rx = dx * Math.cos(a) + dy * Math.sin(a), ry = -dx * Math.sin(a) + dy * Math.cos(a);
  const qx = Math.abs(rx) - (hw - r), qy = Math.abs(ry) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const moved = (f, s, ox, oy) => (x, y) => f(0.5 + (x - ox) / s, 0.5 + (y - oy) / s) * s;
function appIcon(size) {
  const micAt = moved(micDist, 0.56, 0.58, 0.55);
  return render(size, [
    { dist: (x, y) => roundRect(x, y, 0.06, 0.2), color: (x, y) => [...lerp(VIOLET, BLUE, (x + y) / 2), 255] },
    // Sprechblase hinten
    { dist: (x, y) => Math.min(rotBox(x, y, 0.38, 0.38, 0.2, 0.15, 0.07, -10), Math.hypot(x - 0.27, y - 0.55) - 0.045), color: () => [255, 255, 255, 92] },
    // Schallwelle rechts
    { dist: (x, y) => (x < 0.72 ? 1 : Math.abs(Math.hypot(x - 0.58, y - 0.48) - 0.25) - 0.022), color: () => [255, 255, 255, 170] },
    { dist: micAt, color: () => [255, 255, 255, 255] },
  ]);
}
function winTray(size, rec) {
  const [a, b] = rec ? [RED_A, RED_B] : [VIOLET, BLUE];
  return render(size, [
    { dist: (x, y) => Math.hypot(x - 0.5, y - 0.5) - 0.48, color: (x, y) => [...lerp(a, b, (x + y) / 2), 255] },
    { dist: scaled(micDist, 0.72), color: () => [255, 255, 255, 255] },
  ]);
}
function macTray(size, rec) {
  const layers = [{ dist: scaled(micDist, 1.08), color: () => [0, 0, 0, 255] }];
  if (rec) {
    layers.push({ dist: (x, y) => Math.hypot(x - 0.8, y - 0.2) - 0.2, color: () => [0, 0, 0, 0], erase: true });
    layers.push({ dist: (x, y) => Math.hypot(x - 0.8, y - 0.2) - 0.14, color: () => [0, 0, 0, 255] });
  }
  return render(size, layers);
}

const tray = path.join(ROOT, 'src-tauri', 'icons');
fs.mkdirSync(tray, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src-tauri', 'icons', 'icon.png'), appIcon(1024));
fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'logo.png'), appIcon(256));
fs.writeFileSync(path.join(tray, 'tray.png'), winTray(32, false));
fs.writeFileSync(path.join(tray, 'tray-rec.png'), winTray(32, true));
fs.writeFileSync(path.join(tray, 'trayTemplate.png'), macTray(16, false));
fs.writeFileSync(path.join(tray, 'trayTemplate@2x.png'), macTray(32, false));
fs.writeFileSync(path.join(tray, 'trayRecTemplate.png'), macTray(16, true));
fs.writeFileSync(path.join(tray, 'trayRecTemplate@2x.png'), macTray(32, true));
console.log('✓ Symbole geschrieben');
