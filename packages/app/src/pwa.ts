// SPDX-License-Identifier: AGPL-3.0-only

// Service-worker registration. Only runs in production: HMR + a SW that
// caches everything is a recipe for stale dev builds. The SW source itself
// lives in public/sw.js and ships verbatim — no Vite transform, no env
// substitution — so any change to it is a hard cache bust on the next
// page load (CACHE_VERSION in the SW handles that).

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Defer registration until after the page has fully loaded so the SW
  // doesn't compete with the first-paint critical path.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err: unknown) => {
      // Don't surface to the user — a missing SW just means the app
      // doesn't work offline; everything else still works.
      console.warn('Service worker registration failed:', err);
    });
  });
}
