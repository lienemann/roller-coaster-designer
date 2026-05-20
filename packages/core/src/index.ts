// SPDX-License-Identifier: AGPL-3.0-only

// Package version surfaced to consumers (kept in sync with package.json by release tooling at M10).
export const CORE_VERSION = '0.0.0';

// Package boundary is runtime-checked too: core must not touch the DOM.
// The ESLint `no-restricted-imports` rule enforces this at build time, but we
// keep the invariant here so a future test can assert it in Node.
export const PACKAGE_BOUNDARY = Object.freeze({
  name: '@roller-coaster-designer/core',
  forbiddenGlobals: ['window', 'document', 'navigator'] as const,
});

export * from './errors.js';
export * from './io/index.js';
export * from './model/index.js';
export * from './ops/index.js';
export * from './physics/index.js';
export * from './smoothing/index.js';

// Integrator precision toggle (spec §5.5). Callers — typically the
// worker — flip this based on `Project.fvdCompatibilityMode` before
// running the integrator. `'float32'` (default) emulates FVD++ 0.79
// bit-for-bit; `'float64'` ("precise") trades that bit parity for
// closer-to-truth long-range accuracy.
export {
  setFloatPrecision,
  getFloatPrecision,
  type Precision,
} from './fvd/fvec.js';
