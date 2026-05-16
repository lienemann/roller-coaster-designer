// SPDX-License-Identifier: AGPL-3.0-only

import {
  EFuncType,
  SecType,
  TrackStyle,
  closeTrack,
  createEmptyFunc,
  createEmptyProject,
  createLinearSubFunc,
  regenerateClosure,
  segmentsFromCubic,
  type AnchorSection,
  type BezierSection,
  type CurvedSection,
  type Project,
  type Section,
  type StraightSection,
  type Track,
} from '@roller-coaster-designer/core';
import { type TrackStream } from '@roller-coaster-designer/worker';
import { create } from 'zustand';

import { createDemoProject } from '../data/demo-project.js';
import { type OpaqueFileHandle } from '../io/file-system.js';

import { EMPTY_COMMAND_LOG, type CommandLog } from './command-log.types.js';

// Root application state. M0 introduced it empty; M1 added the project
// slice; M2 added the recompute output; M3 grows section editors.
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
  readonly loadDemoProject: () => void;
  readonly loadProject: (payload: {
    project: Project;
    name: string;
    handle: OpaqueFileHandle | null;
  }) => void;
  readonly markSaved: (payload: { name: string; handle: OpaqueFileHandle | null }) => void;
  readonly markDirty: () => void;

  /** Smoothly close the first track with a Bezier back to the anchor. */
  readonly closeCurrentTrack: () => void;

  /**
   * Incrementing epoch that signals the viewport to re-fit the camera to
   * the current track. Bumped whenever a project is loaded or created anew
   * (auto-fit once per project) and by the explicit Fit View button.
   * Slider edits intentionally do NOT bump this — the camera stays where
   * the user left it while they tune a parameter.
   */
  readonly fitViewEpoch: number;
  readonly requestFitView: () => void;
  readonly resetViewEpoch: number;
  readonly requestResetView: () => void;

  /** Section editing on the first track. */
  readonly addStraightSection: () => void;
  readonly addCurvedSection: () => void;
  readonly addLoopSection: () => void;
  readonly addBezierSection: () => void;
  readonly removeSection: (index: number) => void;

  /** When true, new sections insert after the currently-selected section
   *  instead of at the end. Mirrors FVD++'s "insert at cursor" affordance —
   *  handy for splicing a curve in the middle of an existing layout. */
  readonly insertAfterSelection: boolean;
  readonly setInsertAfterSelection: (flag: boolean) => void;

  /** Selection drives the properties panel. M4+ also drives viewport handles. */
  readonly selectedSectionIndex: number | null;
  readonly selectSection: (index: number | null) => void;

  /** Shallow merge patch onto the selected section. */
  readonly patchSelectedSection: (patch: Partial<Section>) => void;

  /** Optional scene environment — user-uploaded sky / floor textures and
   *  a fallback floor colour. Data URIs so reload-clear is intentional
   *  (matches the "no persistence until preferences land" policy). */
  readonly environment: {
    readonly skyDataUri: string | null;
    readonly floorDataUri: string | null;
    readonly floorColor: string;
    readonly floorVisible: boolean;
    /** World-metres per floor-texture tile. Unbounded; UI slider clamps
     *  only its own track, direct numeric entry can exceed the slider range. */
    readonly floorTileMeters: number;
  };
  readonly setSkyImage: (dataUri: string | null) => void;
  readonly setFloorImage: (dataUri: string | null) => void;
  readonly setFloorColor: (hex: string) => void;
  readonly setFloorVisible: (visible: boolean) => void;
  readonly setFloorTileMeters: (meters: number) => void;
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
    set((state) => ({
      project: withStarterTrack(createEmptyProject()),
      projectName: null,
      projectHandle: null,
      isDirty: false,
      tracks: [],
      selectedSectionIndex: null,
      fitViewEpoch: state.fitViewEpoch + 1,
    })),
  loadDemoProject: () =>
    set((state) => ({
      project: createDemoProject(),
      projectName: 'demo.webfvd.json',
      projectHandle: null,
      isDirty: true,
      tracks: [],
      selectedSectionIndex: null,
      fitViewEpoch: state.fitViewEpoch + 1,
    })),
  loadProject: ({ project, name, handle }) =>
    set((state) => ({
      project,
      projectName: name,
      projectHandle: handle,
      isDirty: false,
      tracks: [],
      selectedSectionIndex: null,
      fitViewEpoch: state.fitViewEpoch + 1,
    })),
  markSaved: ({ name, handle }) =>
    set({
      projectName: name,
      projectHandle: handle,
      isDirty: false,
    }),
  markDirty: () => set({ isDirty: true }),

  fitViewEpoch: 0,
  requestFitView: () => set((state) => ({ fitViewEpoch: state.fitViewEpoch + 1 })),
  resetViewEpoch: 0,
  requestResetView: () => set((state) => ({ resetViewEpoch: state.resetViewEpoch + 1 })),

  closeCurrentTrack: () =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      const firstTrack = state.project.tracks[0]!;
      // Already closed: no-op. The UI gates the button on `!hasClosure`,
      // and `patchSelectedSection` runs `regenerateClosure` after every
      // edit so the existing closure stays in sync automatically.
      if (firstTrack.sections.some((s) => s.type === SecType.Closure)) return state;
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

  addStraightSection: () => set((state) => insertSection(state, makeDefaultStraight())),
  addCurvedSection: () => set((state) => insertSection(state, makeDefaultCurved())),
  addLoopSection: () => set((state) => insertSection(state, makeDefaultLoop())),
  addBezierSection: () =>
    set((state) => {
      // Take the last computed node's pose so the new bezier starts where
      // the previous section ended and points forward along its direction.
      // Falls back to the hardcoded default if no geometry exists yet.
      const track = state.tracks[0];
      if (!track || track.nodeCount < 2) {
        return insertSection(state, makeDefaultBezier());
      }
      const n = track.nodeCount;
      const p = [
        track.positions[(n - 1) * 3]!,
        track.positions[(n - 1) * 3 + 1]!,
        track.positions[(n - 1) * 3 + 2]!,
      ] as const;
      const prev = [
        track.positions[(n - 2) * 3]!,
        track.positions[(n - 2) * 3 + 1]!,
        track.positions[(n - 2) * 3 + 2]!,
      ] as const;
      const dx = p[0] - prev[0];
      const dy = p[1] - prev[1];
      const dz = p[2] - prev[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      const sec: BezierSection = {
        type: SecType.Bezier,
        name: 'Bezier',
        segments: segmentsFromCubic(
          [p[0], p[1], p[2]],
          [p[0] + ux * 5, p[1] + uy * 5, p[2] + uz * 5],
          [p[0] + ux * 10, p[1] + uy * 10, p[2] + uz * 10],
          [p[0] + ux * 15, p[1] + uy * 15, p[2] + uz * 15],
        ),
        rollFunc: createEmptyFunc(EFuncType.Roll),
        smoothStart: true,
        smoothEnd: true,
      };
      return insertSection(state, sec);
    }),

  insertAfterSelection: false,
  setInsertAfterSelection: (flag) => set({ insertAfterSelection: flag }),

  removeSection: (index) =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      if (index <= 0) return state; // the Anchor stays put; use New Project to reset.
      const track = state.project.tracks[0]!;
      if (index >= track.sections.length) return state;
      const sections = [...track.sections];
      sections.splice(index, 1);
      const nextSelected =
        state.selectedSectionIndex === index
          ? null
          : state.selectedSectionIndex !== null && state.selectedSectionIndex > index
            ? state.selectedSectionIndex - 1
            : state.selectedSectionIndex;
      return {
        project: {
          ...state.project,
          tracks: [{ ...track, sections }, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
        selectedSectionIndex: nextSelected,
      };
    }),

  selectedSectionIndex: null,
  selectSection: (index) => set({ selectedSectionIndex: index }),
  patchSelectedSection: (patch) =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      const idx = state.selectedSectionIndex;
      if (idx === null) return state;
      const track = state.project.tracks[0]!;
      const current = track.sections[idx];
      if (!current) return state;
      // The patch must preserve the discriminant; Partial<Section> wouldn't
      // permit a type swap anyway because it's still a discriminated union.
      const merged = { ...current, ...patch } as Section;
      const sections = [...track.sections];
      sections[idx] = merged;
      // If a closure still exists at the end of the track, regenerate its
      // control points from the updated upstream geometry so the ring
      // stays continuous after this edit.
      const rebuilt = regenerateClosure({ ...track, sections });
      return {
        project: {
          ...state.project,
          tracks: [rebuilt, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
      };
    }),

  environment: {
    skyDataUri: null,
    floorDataUri: null,
    floorColor: '#0b0b0b',
    floorVisible: true,
    floorTileMeters: 10,
  },
  setSkyImage: (dataUri) =>
    set((state) => ({ environment: { ...state.environment, skyDataUri: dataUri } })),
  setFloorImage: (dataUri) =>
    set((state) => ({ environment: { ...state.environment, floorDataUri: dataUri } })),
  setFloorColor: (hex) =>
    set((state) => ({ environment: { ...state.environment, floorColor: hex } })),
  setFloorVisible: (visible) =>
    set((state) => ({ environment: { ...state.environment, floorVisible: visible } })),
  setFloorTileMeters: (meters) =>
    set((state) => ({
      environment: {
        ...state.environment,
        floorTileMeters:
          Number.isFinite(meters) && meters > 0 ? meters : state.environment.floorTileMeters,
      },
    })),
}));

// --- helpers ---------------------------------------------------------------

function insertSection(state: AppState, section: Section): Partial<AppState> {
  if (!state.project) return state;
  const tracks = state.project.tracks.length === 0 ? [makeStarterTrack()] : state.project.tracks;
  const first = tracks[0]!;
  // Invariant: a Closure must be the last section. New non-closure sections
  // are inserted *before* the closure if one exists, so the closure
  // automatically follows the new geometry. (regenerateClosure below
  // recomputes its handles afterward.) New Closure sections are blocked
  // outright if a closure is already present — at most one per track.
  const closureIdx = first.sections.findIndex((s) => s.type === SecType.Closure);
  if (section.type === SecType.Closure && closureIdx !== -1) {
    return state; // silently no-op; the UI guards against this too.
  }
  // Insert position: when "insert after selection" is on and the user has a
  // section selected (not the anchor — anchor is index 0 and inserting at 1
  // is fine), splice right after it. Otherwise append at the end (still
  // before the closure, if any).
  const sel = state.selectedSectionIndex;
  const endIdx = closureIdx === -1 ? first.sections.length : closureIdx;
  const insertAt =
    state.insertAfterSelection && sel !== null && sel >= 0 && sel < endIdx
      ? Math.min(sel + 1, endIdx)
      : endIdx;
  const nextSections = [
    ...first.sections.slice(0, insertAt),
    section,
    ...first.sections.slice(insertAt),
  ];
  const focusIdx = insertAt;
  // After splicing in front of an existing closure, refresh the closure's
  // handle lengths so it stays aligned with the new upstream end pose.
  const rebuilt = regenerateClosure({ ...first, sections: nextSections });
  return {
    project: {
      ...state.project,
      tracks: [rebuilt, ...tracks.slice(1)],
    },
    isDirty: true,
    selectedSectionIndex: focusIdx,
  };
}

function withStarterTrack(project: Project): Project {
  if (project.tracks.length > 0) return project;
  return { ...project, tracks: [makeStarterTrack()] };
}

function makeStarterTrack(): Track {
  const anchor: AnchorSection = {
    type: SecType.Anchor,
    name: 'Anchor',
    position: [0, 10, 0],
    pitch: 0,
    yaw: 0,
    roll: 0,
    speed: 15,
  };
  return {
    name: 'Main',
    style: TrackStyle.Generic,
    heart: 1.1,
    friction: 0,
    resistance: 0,
    sections: [anchor],
    smoothers: [],
  };
}

function makeDefaultStraight(): StraightSection {
  return {
    type: SecType.Straight,
    name: 'Straight',
    length: 20,
    rollFunc: createEmptyFunc(EFuncType.Roll),
  };
}

function makeDefaultCurved(): CurvedSection {
  // Default to a gentle 45° level turn at 20 m radius.
  const fAngle = 45;
  const rollFunc = createEmptyFunc(EFuncType.Roll);
  rollFunc.subfuncs.push(createLinearSubFunc({ length: fAngle, startValue: 0, endValue: 0 }));
  return {
    type: SecType.Curved,
    name: 'Curve',
    fAngle,
    fRadius: 20,
    fDirection: 90, // 90 = level turn; 0 = vertical loop
    fLeadIn: 10,
    fLeadOut: 10,
    rollFunc,
  };
}

/** A full 360° vertical loop. `fDirection=0` makes the rotation axis
 *  horizontal-lateral, so the train pitches up + over + down. Modest
 *  lead-in/out so the entry is comfortable. */
function makeDefaultLoop(): CurvedSection {
  const fAngle = 360;
  const rollFunc = createEmptyFunc(EFuncType.Roll);
  rollFunc.subfuncs.push(createLinearSubFunc({ length: fAngle, startValue: 0, endValue: 0 }));
  return {
    type: SecType.Curved,
    name: 'Loop',
    fAngle,
    fRadius: 8,
    fDirection: 0,
    fLeadIn: 30,
    fLeadOut: 30,
    rollFunc,
  };
}

function makeDefaultBezier(): BezierSection {
  return {
    type: SecType.Bezier,
    name: 'Bezier',
    segments: segmentsFromCubic([0, 0, 0], [5, 0, 0], [10, 2, 0], [15, 2, 0]),
    rollFunc: createEmptyFunc(EFuncType.Roll),
    smoothStart: true,
    smoothEnd: true,
  };
}
