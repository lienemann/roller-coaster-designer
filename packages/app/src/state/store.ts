// SPDX-License-Identifier: AGPL-3.0-only

import { type Project, closeTrack, createEmptyProject } from '@roller-coaster-designer/core';
import { type TrackStream } from '@roller-coaster-designer/worker';
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

  /** Latest recompute output per track. Empty when no project is loaded. */
  readonly tracks: readonly TrackStream[];
  readonly setTracks: (tracks: readonly TrackStream[]) => void;

  readonly newProject: () => void;
  readonly loadProject: (payload: {
    project: Project;
    name: string;
    handle: OpaqueFileHandle | null;
  }) => void;
  readonly markSaved: (payload: { name: string; handle: OpaqueFileHandle | null }) => void;
  readonly markDirty: () => void;

  /**
   * Smoothly closes the first track in the loaded project by appending a
   * tangent-continuous Bezier section from its current end pose back to the
   * anchor. No-op when no project is loaded or the track has fewer than two
   * sections.
   */
  readonly closeCurrentTrack: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  markReady: () => set({ ready: true }),

  commandLog: EMPTY_COMMAND_LOG,

  project: null,
  projectName: null,
  projectHandle: null,
  isDirty: false,

  tracks: [],
  setTracks: (tracks) => set({ tracks }),

  newProject: () =>
    set({
      project: createEmptyProject(),
      projectName: null,
      projectHandle: null,
      isDirty: false,
      tracks: [],
    }),
  loadProject: ({ project, name, handle }) =>
    set({
      project,
      projectName: name,
      projectHandle: handle,
      isDirty: false,
      tracks: [],
    }),
  markSaved: ({ name, handle }) =>
    set({
      projectName: name,
      projectHandle: handle,
      isDirty: false,
    }),
  markDirty: () => set({ isDirty: true }),

  closeCurrentTrack: () =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      const firstTrack = state.project.tracks[0]!;
      const closedTrack = closeTrack(firstTrack);
      if (closedTrack === firstTrack) return state;
      return {
        project: {
          ...state.project,
          tracks: [closedTrack, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
      };
    }),
}));
