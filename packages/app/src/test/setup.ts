// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-empty-function */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement Worker. Stub it so components that indirectly
// spawn workers (useRecomputeOnProjectChange) don't crash test setup.
// Real worker behaviour is exercised in the browser via the recompute path.
const noop = (): void => {};

if (typeof globalThis.Worker === 'undefined') {
  class FakeWorker {
    postMessage = noop;
    terminate = noop;
    addEventListener = noop;
    removeEventListener = noop;
    dispatchEvent(): boolean {
      return false;
    }
    onerror = null;
    onmessage = null;
    onmessageerror = null;
  }
  (globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;
}

// uPlot probes `matchMedia` at module init to track device pixel ratio. jsdom
// doesn't ship it; stub the minimum surface uPlot touches so our tests can
// import components that transitively import uPlot.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((): MediaQueryList => {
    return {
      matches: false,
      media: '',
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as unknown as (query: string) => MediaQueryList;
}
