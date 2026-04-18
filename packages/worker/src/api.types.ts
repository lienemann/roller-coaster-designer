// SPDX-License-Identifier: AGPL-3.0-only

import { type Project } from '@roller-coaster-designer/core';

/**
 * Per-track result of a recompute. Every Float32Array is `nodeCount` long
 * except `positions`, which is `3 * nodeCount` (packed XYZ). Buffers travel
 * as transferable `ArrayBuffer`s — the worker relinquishes ownership on
 * postMessage and the main thread reads the views directly.
 */
export interface TrackStream {
  readonly nodeCount: number;
  readonly positions: Float32Array;
  readonly velocity: Float32Array;
  readonly forceNormal: Float32Array;
  readonly forceLateral: Float32Array;
  readonly cumulativeTime: Float32Array;
  readonly sectionStartNodes: number[];
}

export interface RecomputeResult {
  readonly tracks: TrackStream[];
}

export interface PhysicsWorkerApi {
  /** Identity check; returns the input. Kept from M0 for sanity. */
  ping(value: number): Promise<number>;

  /** Runs the integrator on every track in the project. */
  recompute(project: Project): Promise<RecomputeResult>;
}
