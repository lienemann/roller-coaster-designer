// SPDX-License-Identifier: GPL-3.0-only

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
  });

  it('shows the no-project label when nothing is loaded, and flips after New', () => {
    act(() => {
      useAppStore.setState({
        project: null,
        projectName: null,
        projectHandle: null,
        isDirty: false,
      });
    });
    render(<App />);
    expect(screen.getByLabelText(/current project/i)).toHaveTextContent(/no project/i);

    act(() => {
      useAppStore.getState().newProject();
    });
    expect(screen.getByLabelText(/current project/i)).toHaveTextContent(/untitled/i);
  });
});
