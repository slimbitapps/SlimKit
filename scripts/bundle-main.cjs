'use strict';
/**
 * Bündelt den Hauptprozess (inkl. pdf-lib und qrcode) in eine kleine Datei dist/main.cjs.
 * So muss node_modules nicht mit in die App – sie wird kleiner und startet schneller.
 */
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

esbuild.buildSync({
  entryPoints: { main: path.join(ROOT, 'electron', 'main.cjs'), preload: path.join(ROOT, 'electron', 'preload.cjs') },
  outdir: DIST,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
// Symbole für die Menüleiste
fs.cpSync(path.join(ROOT, 'electron', 'tray'), path.join(DIST, 'tray'), { recursive: true });
console.log('✓ dist/main.cjs', Math.round(fs.statSync(path.join(DIST, 'main.cjs')).size / 1024) + ' KB');
