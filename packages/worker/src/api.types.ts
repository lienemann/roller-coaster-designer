// SPDX-License-Identifier: AGPL-3.0-only

import { type Project } from '@roller-coaster-designer/core';

/**
 * Per-track result of a recompute. `positions` is a flat XYZ stream:
 * positions[3i + 0..2] is node i's world position. `nodeCount` is the number
 * of valid nodes (positions.length / 3 may be larger when the buffer was
 * preallocated).
 *
 * Buffers travel as transferable ArrayBuffers (spec §1.5), so the worker
 * relinquishes ownership when it posts the result and the main thread draws
 * straight out of the returned views.
 */
export interface TrackStream {
  readonly nodeCount: number;
  readonly positions: Float32Array;
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
