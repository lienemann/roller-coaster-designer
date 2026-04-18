// SPDX-License-Identifier: GPL-3.0-only

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
