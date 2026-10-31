import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; media-src 'self' mediastream: blob:";
// Lokale Spracherkennung: Modelle von Hugging Face laden, WebAssembly ausführen
const ENGINE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data:";

const ORT = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html, ctx) =>
        html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${ctx.filename.endsWith('engine.html') ? ENGINE_CSP : CSP}" />`),
    },
    {
      // ONNX-Laufzeit (WebAssembly) mit in die App, damit nichts aus dem Netz nachgeladen wird
      name: 'copy-ort',
      apply: 'build',
      writeBundle() {
        mkdirSync(resolve(import.meta.dirname, 'dist/ort'), { recursive: true });
        for (const f of ORT) cpSync(resolve(import.meta.dirname, 'node_modules/onnxruntime-web/dist', f), resolve(import.meta.dirname, 'dist/ort', f));
        // Vite legt zusätzlich eine Kopie mit Hash-Namen an – wird nicht gebraucht (wasmPaths zeigt auf dist/ort)
        const assets = resolve(import.meta.dirname, 'dist/assets');
        for (const f of readdirSync(assets)) if (/^ort-wasm.*\.wasm$/.test(f)) rmSync(resolve(assets, f));
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html'),
        engine: resolve(import.meta.dirname, 'engine.html'),
      },
    },
  },
  server: { port: 5299, strictPort: true },
});
