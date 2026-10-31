'use strict';
/** Bündelt den Hauptprozess (inkl. Anthropic-SDK) in dist/main.cjs – node_modules muss nicht mit in die App. */
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
fs.cpSync(path.join(ROOT, 'electron', 'tray'), path.join(DIST, 'tray'), { recursive: true });
console.log('✓ dist/main.cjs', Math.round(fs.statSync(path.join(DIST, 'main.cjs')).size / 1024) + ' KB');
