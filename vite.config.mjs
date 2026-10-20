import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// App-Fenster: strenge Regeln. Die Handy-Seite (phone.html) bekommt ihre Regeln vom Server.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'";

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html, ctx) =>
        ctx.filename.endsWith('phone.html') ? html : html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        phone: resolve(import.meta.dirname, 'phone.html'),
      },
    },
  },
  server: { port: 5199, strictPort: true },
});
