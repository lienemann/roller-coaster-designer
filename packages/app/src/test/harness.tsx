// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, type RenderResult } from '@testing-library/react';
import { type ReactElement } from 'react';
import { beforeAll, beforeEach } from 'vitest';

import { initI18n } from '../i18n/index.js';
import { useAppStore } from '../state/store.js';

/**
 * Small composition of the repeated boilerplate in app tests:
 *
 *   - Initialise i18next once before the suite (needed for `t()` calls
 *     that run on first render).
 *   - Reset the Zustand store between tests so a test that calls
 *     `newProject()` or `loadDemoProject()` doesn't leak into the next.
 *
 * Tests that need custom store state inside the reset can set it via
 * `act(() => useAppStore.setState(...))`.
 */
export function setupAppSuite(): void {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        project: null,
        projectName: null,
        projectHandle: null,
        isDirty: false,
        tracks: [],
        selectedSection: null,
      });
    });
  });
}

/** render() wrapper that also returns the initialised store for convenience. */
export function renderWithStore(element: ReactElement): RenderResult {
  return render(element);
}
