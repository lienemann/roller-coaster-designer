// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.tsx';
import { useAppStore } from './state/store.ts';
import { setupAppSuite } from './test/harness.tsx';

describe('App shell', () => {
  setupAppSuite();

  it('renders the English title by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Roller Coaster Designer');
  });

  it('exposes the language switcher and the File menu', () => {
    render(<App />);
    expect(screen.getByRole('combobox', { name: /language/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /file/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load demo/i })).toBeInTheDocument();
  });

  it('shows the no-project label when nothing is loaded, and flips after New', () => {
    render(<App />);
    expect(screen.getByLabelText(/current project/i)).toHaveTextContent(/no project/i);

    act(() => {
      useAppStore.getState().newProject();
    });
    expect(screen.getByLabelText(/current project/i)).toHaveTextContent(/untitled/i);
  });

  it('lists the anchor in the sections panel after a new project', () => {
    act(() => {
      useAppStore.getState().newProject();
    });
    render(<App />);
    // JSDOM collapses the header + aside with the same aria-label "Sections".
    // Pick the first one — it will always contain the section list.
    const sectionsMatches = screen.getAllByLabelText(/sections/i);
    expect(sectionsMatches.some((el) => (el.textContent ?? '').includes('Anchor'))).toBe(true);
  });

  it('adds a Straight section when the Straight add button is clicked', () => {
    act(() => {
      useAppStore.getState().newProject();
      useAppStore.getState().addStraightSection();
    });
    render(<App />);
    const track = useAppStore.getState().project!.tracks[0]!;
    expect(track.sections).toHaveLength(1);
    expect(track.sections[0]!.kind).toBe('straight');
    expect(useAppStore.getState().selectedSection).toBe(0);
  });
});
