// SPDX-License-Identifier: GPL-3.0-only

import { type Project, createEmptyProject } from '@roller-coaster-designer/core';
import { create } from 'zustand';

import { type OpaqueFileHandle } from '../io/file-system.js';

import { EMPTY_COMMAND_LOG, type CommandLog } from './command-log.types.js';

// Root application state. M0 left this mostly empty; M1 adds the project
// slice that hosts the current loaded document, its file handle (when the
// browser supports the File System Access API), and a dirty flag for the
// window-title indicator.
//
// Intentionally flat. The project lives as a single reference so Zustand's
// default referential equality does the right thing for selectors.
export interface AppState {
  readonly ready: boolean;
  readonly markReady: () => void;

  readonly commandLog: CommandLog;

  readonly project: Project | null;
  readonly projectName: string | null;
  readonly projectHandle: OpaqueFileHandle | null;
  readonly isDirty: boolean;

  readonly newProject: () => void;
  readonly loadProject: (payload: {
    project: Project;
    name: string;
    handle: OpaqueFileHandle | null;
  }) => void;
  readonly markSaved: (payload: { name: string; handle: OpaqueFileHandle | null }) => void;
  readonly markDirty: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  markReady: () => set({ ready: true }),

  commandLog: EMPTY_COMMAND_LOG,

  project: null,
  projectName: null,
  projectHandle: null,
  isDirty: false,

  newProject: () =>
    set({
      project: createEmptyProject(),
      projectName: null,
      projectHandle: null,
      isDirty: false,
    }),
  loadProject: ({ project, name, handle }) =>
    set({
      project,
      projectName: name,
      projectHandle: handle,
      isDirty: false,
    }),
  markSaved: ({ name, handle }) =>
    set({
      projectName: name,
      projectHandle: handle,
      isDirty: false,
    }),
  markDirty: () => set({ isDirty: true }),
}));
