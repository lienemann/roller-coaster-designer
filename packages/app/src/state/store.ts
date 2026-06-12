// SPDX-License-Identifier: AGPL-3.0-only

import {
  EDegree,
  createEmptyProject,
  type FuncDoc,
  type ProjectDoc,
  type SectionDoc,
  type SubfuncDoc,
  type TrackDoc,
} from '@roller-coaster-designer/core';
import { type TrackStream } from '@roller-coaster-designer/worker';
import { create } from 'zustand';

import { createDemoProject } from '../data/demo-project.js';
import { type OpaqueFileHandle } from '../io/file-system.js';

import { EMPTY_COMMAND_LOG, type CommandLog } from './command-log.types.js';

// Root application state. The project is a ProjectDoc — the plain-JSON
// document the worker materialises into fvd.Track instances. The anchor
// is TRACK-level data (FVD semantics), so section selection has a
// distinct 'anchor' value alongside numeric section indices.

export type Selection = number | 'anchor' | null;

export interface AppState {
  readonly ready: boolean;
  readonly markReady: () => void;

  readonly commandLog: CommandLog;

  readonly project: ProjectDoc | null;
  readonly projectName: string | null;
  readonly projectHandle: OpaqueFileHandle | null;
  readonly isDirty: boolean;

  /** Latest recompute output per track. Empty when no project is loaded. */
  readonly tracks: readonly TrackStream[];
  readonly setTracks: (tracks: readonly TrackStream[]) => void;

  readonly newProject: () => void;
  readonly loadDemoProject: () => void;
  readonly loadProject: (payload: {
    project: ProjectDoc;
    name: string;
    handle: OpaqueFileHandle | null;
  }) => void;
  readonly markSaved: (payload: { name: string; handle: OpaqueFileHandle | null }) => void;
  readonly markDirty: () => void;

  /** Append a Closure section that auto-joins the track end to the anchor. */
  readonly closeCurrentTrack: () => void;

  readonly addStraightSection: () => void;
  readonly addCurvedSection: () => void;
  readonly addLoopSection: () => void;
  readonly addGeometricSection: () => void;
  readonly addForcedSection: () => void;
  readonly addBezierSection: () => void;

  readonly insertAfterSelection: boolean;
  readonly setInsertAfterSelection: (flag: boolean) => void;

  readonly removeSection: (index: number) => void;

  readonly selectedSection: Selection;
  readonly selectSection: (sel: Selection) => void;

  /** Shallow merge patch onto the selected (numeric-index) section. */
  readonly patchSelectedSection: (patch: Partial<SectionDoc>) => void;
  /** Patch track-level fields (anchor pose, heart, friction, …). */
  readonly patchTrack: (patch: Partial<TrackDoc>) => void;

  /** Toggle the project's FVD-compat / precise integrator mode (spec §5.6). */
  readonly setFvdCompatibilityMode: (compat: boolean) => void;

  readonly fitViewEpoch: number;
  readonly requestFitView: () => void;
  readonly resetViewEpoch: number;
  readonly requestResetView: () => void;

  readonly environment: {
    readonly skyDataUri: string | null;
    readonly floorDataUri: string | null;
    readonly floorColor: string;
    readonly floorVisible: boolean;
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
      selectedSection: null,
      fitViewEpoch: state.fitViewEpoch + 1,
    })),
  loadDemoProject: () =>
    set((state) => ({
      project: createDemoProject(),
      projectName: 'demo.webfvd.json',
      projectHandle: null,
      isDirty: true,
      tracks: [],
      selectedSection: null,
      fitViewEpoch: state.fitViewEpoch + 1,
    })),
  loadProject: ({ project, name, handle }) =>
    set((state) => ({
      project,
      projectName: name,
      projectHandle: handle,
      isDirty: false,
      tracks: [],
      selectedSection: null,
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
      const first = state.project.tracks[0]!;
      if (first.sections.some((s) => s.kind === 'closure')) return state;
      const sections: SectionDoc[] = [...first.sections, { kind: 'closure', name: 'Closure' }];
      return {
        project: {
          ...state.project,
          tracks: [{ ...first, sections }, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
      };
    }),

  addStraightSection: () => set((state) => insertSection(state, makeDefaultStraight())),
  addCurvedSection: () => set((state) => insertSection(state, makeDefaultCurved())),
  addLoopSection: () => set((state) => insertSection(state, makeDefaultLoop())),
  addGeometricSection: () => set((state) => insertSection(state, makeDefaultGeometric())),
  addForcedSection: () => set((state) => insertSection(state, makeDefaultForced())),
  addBezierSection: () =>
    set((state) => {
      // Seed the knots from the last computed node's pose so the new
      // bezier starts where the track currently ends.
      const track = state.tracks[0];
      if (!track || track.nodeCount < 2) {
        return insertSection(state, makeDefaultBezier([0, 0, 0], [0, 0, -1]));
      }
      // Stream positions are world-space (worker adds startPos); knots
      // live in integration space, so subtract it back out.
      const sp = state.project?.tracks[0]?.startPos ?? [0, 0, 0];
      const n = track.nodeCount;
      const p: [number, number, number] = [
        track.positions[(n - 1) * 3]! - sp[0],
        track.positions[(n - 1) * 3 + 1]! - sp[1],
        track.positions[(n - 1) * 3 + 2]! - sp[2],
      ];
      const prev: [number, number, number] = [
        track.positions[(n - 2) * 3]!,
        track.positions[(n - 2) * 3 + 1]!,
        track.positions[(n - 2) * 3 + 2]!,
      ];
      const dx = p[0] - prev[0];
      const dy = p[1] - prev[1];
      const dz = p[2] - prev[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      return insertSection(
        state,
        makeDefaultBezier(p, [dx / len, dy / len, dz / len]),
      );
    }),

  insertAfterSelection: false,
  setInsertAfterSelection: (flag) => set({ insertAfterSelection: flag }),

  removeSection: (index) =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      const track = state.project.tracks[0]!;
      if (index < 0 || index >= track.sections.length) return state;
      const sections = [...track.sections];
      sections.splice(index, 1);
      const sel = state.selectedSection;
      const nextSelected: Selection =
        sel === index
          ? null
          : typeof sel === 'number' && sel > index
            ? sel - 1
            : sel;
      return {
        project: {
          ...state.project,
          tracks: [{ ...track, sections }, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
        selectedSection: nextSelected,
      };
    }),

  selectedSection: null,
  selectSection: (sel) => set({ selectedSection: sel }),
  patchSelectedSection: (patch) =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      const idx = state.selectedSection;
      if (typeof idx !== 'number') return state;
      const track = state.project.tracks[0]!;
      const current = track.sections[idx];
      if (!current) return state;
      const merged = { ...current, ...patch } as SectionDoc;
      const sections = [...track.sections];
      sections[idx] = merged;
      return {
        project: {
          ...state.project,
          tracks: [{ ...track, sections }, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
      };
    }),
  patchTrack: (patch) =>
    set((state) => {
      if (!state.project || state.project.tracks.length === 0) return state;
      const track = state.project.tracks[0]!;
      return {
        project: {
          ...state.project,
          tracks: [{ ...track, ...patch }, ...state.project.tracks.slice(1)],
        },
        isDirty: true,
      };
    }),

  setFvdCompatibilityMode: (compat) =>
    set((state) => {
      if (!state.project) return state;
      if (state.project.fvdCompatibilityMode === compat) return state;
      return {
        project: { ...state.project, fvdCompatibilityMode: compat },
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

export function subfunc(
  min: number,
  max: number,
  start: number,
  sym: number,
  degree: EDegree = EDegree.Cubic,
): SubfuncDoc {
  return {
    degree,
    minArgument: min,
    maxArgument: max,
    startValue: start,
    symArg: sym,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
    locked: false,
  };
}

export function singleSubfuncFunc(
  min: number,
  max: number,
  start = 0,
  sym = 0,
  degree: EDegree = EDegree.Cubic,
): FuncDoc {
  return { subfuncs: [subfunc(min, max, start, sym, degree)] };
}

function insertSection(state: AppState, section: SectionDoc): Partial<AppState> {
  if (!state.project) return state;
  const tracks = state.project.tracks.length === 0 ? [makeStarterTrack()] : state.project.tracks;
  const first = tracks[0]!;
  // Invariant: a Closure stays last; new sections go before it.
  const closureIdx = first.sections.findIndex((s) => s.kind === 'closure');
  if (section.kind === 'closure' && closureIdx !== -1) return state;
  const sel = state.selectedSection;
  const endIdx = closureIdx === -1 ? first.sections.length : closureIdx;
  const insertAt =
    state.insertAfterSelection && typeof sel === 'number' && sel >= 0 && sel < endIdx
      ? Math.min(sel + 1, endIdx)
      : endIdx;
  const nextSections = [
    ...first.sections.slice(0, insertAt),
    section,
    ...first.sections.slice(insertAt),
  ];
  return {
    project: {
      ...state.project,
      tracks: [{ ...first, sections: nextSections }, ...tracks.slice(1)],
    },
    isDirty: true,
    selectedSection: insertAt,
  };
}

function withStarterTrack(project: ProjectDoc): ProjectDoc {
  if (project.tracks.length > 0) return project;
  return { ...project, tracks: [makeStarterTrack()] };
}

function makeStarterTrack(): TrackDoc {
  return {
    name: 'Main',
    startPos: [0, 10, 0],
    startYaw: 0,
    startPitch: 0,
    anchor: { roll: 0, vel: 15, normal: 1, lateral: 0 },
    heart: 1.1,
    friction: 0,
    resistance: 0,
    style: 0,
    sections: [],
    smoothers: [],
  };
}

function makeDefaultStraight(): SectionDoc {
  return {
    kind: 'straight',
    name: 'Straight',
    bSpeed: false,
    fVel: 15,
    fHLength: 20,
    rollFunc: singleSubfuncFunc(0, 20),
  };
}

function makeDefaultCurved(): SectionDoc {
  return {
    kind: 'curved',
    name: 'Curve',
    bSpeed: false,
    fVel: 15,
    bOrientation: false,
    fAngle: 45,
    fRadius: 20,
    fDirection: 90, // 90 = level turn; 0 = vertical loop
    fLeadIn: 10,
    fLeadOut: 10,
    rollFunc: singleSubfuncFunc(0, 45),
  };
}

/** A full 360° vertical loop, tilted 12° off pure-lateral so the exit
 *  clears the entry sideways instead of overlapping it. */
function makeDefaultLoop(): SectionDoc {
  return {
    kind: 'curved',
    name: 'Loop',
    bSpeed: false,
    fVel: 15,
    bOrientation: false,
    fAngle: 360,
    fRadius: 8,
    fDirection: 12,
    fLeadIn: 30,
    fLeadOut: 30,
    rollFunc: singleSubfuncFunc(0, 360),
  };
}

function makeDefaultGeometric(): SectionDoc {
  return {
    kind: 'geometric',
    name: 'Geometric',
    bSpeed: false,
    fVel: 15,
    iTime: 1500,
    bOrientation: false,
    bArgument: false,
    rollFunc: singleSubfuncFunc(0, 1.5),
    normForce: singleSubfuncFunc(0, 1.5),
    latForce: singleSubfuncFunc(0, 1.5),
  };
}

function makeDefaultForced(): SectionDoc {
  return {
    kind: 'forced',
    name: 'Forced',
    bSpeed: false,
    fVel: 15,
    iTime: 1500,
    bOrientation: false,
    bArgument: false,
    rollFunc: singleSubfuncFunc(0, 1.5),
    normForce: singleSubfuncFunc(0, 1.5, 1, 0),
    latForce: singleSubfuncFunc(0, 1.5),
  };
}

function makeDefaultBezier(
  start: [number, number, number],
  dir: [number, number, number],
): SectionDoc {
  const at = (d: number): [number, number, number] => [
    start[0] + dir[0] * d,
    start[1] + dir[1] * d,
    start[2] + dir[2] * d,
  ];
  const knot = (
    pos: [number, number, number],
    handle: number,
  ): { P1: [number, number, number]; Kp1: [number, number, number]; Kp2: [number, number, number]; roll: number; contRoll: boolean; relRoll: boolean } => ({
    P1: pos,
    Kp1: [pos[0] - dir[0] * handle, pos[1] - dir[1] * handle, pos[2] - dir[2] * handle],
    Kp2: [pos[0] + dir[0] * handle, pos[1] + dir[1] * handle, pos[2] + dir[2] * handle],
    roll: 0,
    contRoll: false,
    relRoll: false,
  });
  return {
    kind: 'bezier',
    name: 'Bezier',
    knots: [knot(at(0), 5), knot(at(20), 5)],
  };
}
