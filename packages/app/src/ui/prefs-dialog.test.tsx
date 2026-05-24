// SPDX-License-Identifier: AGPL-3.0-only
//
// Smoke test for the Preferences dialog: open it from the menu bar,
// toggle the FVD-compat mode, verify the store flips. Anchors the
// behaviour so a future content pass on tooltips can land without
// regressing the wiring.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../App.tsx';
import { useAppStore } from '../state/store.ts';
import { setupAppSuite } from '../test/harness.tsx';

describe('Preferences dialog', () => {
  setupAppSuite();

  it('opens from the File menu and exposes the FVD-compat toggle', () => {
    act(() => {
      useAppStore.getState().newProject();
    });
    render(<App />);
    // Find the Preferences button in the menu bar.
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
    // Dialog should render with the integrator-mode section.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/FVD\+\+ compatibility/i)).toBeInTheDocument();
  });

  it('flipping the FVD-compat checkbox updates the project', () => {
    act(() => {
      useAppStore.getState().newProject();
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));

    expect(useAppStore.getState().project?.fvdCompatibilityMode).toBe(true);
    const checkbox = screen.getByRole('checkbox', { name: /FVD\+\+ compatibility/i });
    fireEvent.click(checkbox);
    expect(useAppStore.getState().project?.fvdCompatibilityMode).toBe(false);
    fireEvent.click(checkbox);
    expect(useAppStore.getState().project?.fvdCompatibilityMode).toBe(true);
  });

  it('does not let the user toggle when no project is loaded', () => {
    // No newProject() — project stays null.
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
    const checkbox = screen.getByRole('checkbox', { name: /FVD\+\+ compatibility/i });
    expect(checkbox).toBeDisabled();
  });
});
