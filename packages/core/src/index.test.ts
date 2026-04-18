// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { CORE_VERSION, PACKAGE_BOUNDARY } from './index.js';

describe('core package surface', () => {
  it('exposes a version string', () => {
    expect(typeof CORE_VERSION).toBe('string');
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('declares its DOM-free invariant', () => {
    expect(PACKAGE_BOUNDARY.name).toBe('@roller-coaster-designer/core');
    expect(PACKAGE_BOUNDARY.forbiddenGlobals).toContain('document');
  });

  it('runs in a DOM-free environment', () => {
    // When this test is run under Vitest's node environment (configured in
    // vitest.config.ts), `document` must be undefined. If someone flips the
    // environment to jsdom, this test fails loudly.
    const g = globalThis as Record<string, unknown>;
    expect(typeof g.document).toBe('undefined');
  });
});
