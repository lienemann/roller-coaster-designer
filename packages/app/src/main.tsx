// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { initI18n } from './i18n/index.ts';
import { registerServiceWorker } from './pwa.ts';
import { useAppStore } from './state/store.ts';
import './styles/tailwind.css';

async function boot(): Promise<void> {
  await initI18n();
  useAppStore.getState().markReady();

  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Missing #root element in index.html');
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Service-worker registration runs only in production builds. Vite's HMR
  // dev server doesn't play well with SW caching, and the SW source itself
  // (public/sw.js) ships verbatim — no bundling, no env substitution.
  registerServiceWorker();
}

void boot();
