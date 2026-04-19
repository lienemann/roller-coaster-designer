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
  /** 3·N packed XYZ. positions[3i..3i+2] is node i's world position. */
  readonly positions: Float32Array;
  /** 3·N packed XYZ. Rider's lateral (right) axis. Banking becomes visible
   *  in the 3D viewport once it can draw ±lat offsets off each node. */
  readonly lateralAxis: Float32Array;
  readonly velocity: Float32Array;
  readonly forceNormal: Float32Array;
  readonly forceLateral: Float32Array;
  readonly forceLong: Float32Array;
  /** Banking rate (roll speed) in rad/s. Graph converts to deg/s for display. */
  readonly rollSpeed: Float32Array;
  readonly cumulativeTime: Float32Array;
  /** Uint16 per node naming which section produced it; indexes
   *  sectionStartNodes. Lets the viewport colour and highlight per section
   *  without re-scanning sectionStartNodes on every vertex. */
  readonly sectionIndex: Uint16Array;
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
