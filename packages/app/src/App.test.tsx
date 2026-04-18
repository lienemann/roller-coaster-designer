// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { App } from './App.tsx';
import { initI18n } from './i18n/index.ts';
import { useAppStore } from './state/store.ts';

describe('App shell', () => {
  beforeAll(async () => {
    await initI18n();
  });

  it('renders the English title by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Roller Coaster Designer');
  });

  it('exposes the language switcher and the File menu', () => {
    render(<App />);
    expect(screen.getByRole('combobox', { name: /language/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /file/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load demo/i })).toBeInTheDocument();
  });

  it('shows the no-project label when nothing is loaded, and flips after New', () => {
    act(() => {
      useAppStore.setState({
        project: null,
        projectName: null,
        projectHandle: null,
        isDirty: false,
        tracks: [],
      });
    });
    render(<App />);
    expect(screen.getByLabelText(/current project/i)).toHaveTextContent(/no project/i);

    act(() => {
      useAppStore.getState().newProject();
    });
    expect(screen.getByLabelText(/current project/i)).toHaveTextContent(/untitled/i);
  });

  it('lists the anchor in the sections panel after a new project', () => {
    act(() => {
      useAppStore.setState({ project: null, tracks: [] });
      useAppStore.getState().newProject();
    });
    render(<App />);
    const panel = screen.getByLabelText(/sections/i);
    // The panel shows name and section type; both read "Anchor".
    expect(panel.textContent).toMatch(/Anchor/);
  });

  it('adds a Straight section when the Straight add button is clicked', () => {
    act(() => {
      useAppStore.setState({ project: null, tracks: [] });
      useAppStore.getState().newProject();
      useAppStore.getState().addStraightSection();
    });
    render(<App />);
    const track = useAppStore.getState().project!.tracks[0]!;
    expect(track.sections).toHaveLength(2);
    expect(track.sections[1]!.type).toBe(1); // SecType.Straight
  });
});
