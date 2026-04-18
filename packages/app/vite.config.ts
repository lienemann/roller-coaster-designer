// SPDX-License-Identifier: GPL-3.0-only
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Base path is read at build time so GitHub Pages deploys under
// `/<repo-name>/` work without rebuilding for local dev (default `/`).
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Split vendor chunks so the app shell stays small.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          three: ['three'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
