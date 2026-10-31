import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Oberfläche für Tauri: Einstellungsfenster (index.html) und die kleine Anzeige beim Diktieren (overlay.html)
export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html'),
      },
    },
  },
  server: { port: 5299, strictPort: true },
});
