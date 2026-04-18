// SPDX-License-Identifier: AGPL-3.0-only

import { vec3 } from 'gl-matrix';

// Cubic Bezier math helpers used by the Bezier section integrator
// (packages/core/src/physics/integrate.ts) and by the closeTrack utility
// (packages/core/src/ops/close-track.ts). All functions write into an
// `out` parameter; no allocations in hot paths.
//
// B(t)  = (1-t)³ P0 + 3(1-t)² t P1 + 3(1-t) t² P2 + t³ P3
// B'(t) = 3(1-t)² (P1 - P0) + 6(1-t) t (P2 - P1) + 3 t² (P3 - P2)

export type ReadonlyVec3 = readonly [number, number, number];

export function cubicBezier(
  out: vec3,
  t: number,
  p0: ReadonlyVec3,
  p1: ReadonlyVec3,
  p2: ReadonlyVec3,
  p3: ReadonlyVec3,
): vec3 {
  const it = 1 - t;
  const a = it * it * it;
  const b = 3 * it * it * t;
  const c = 3 * it * t * t;
  const d = t * t * t;
  out[0] = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0];
  out[1] = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
  out[2] = a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2];
  return out;
}

export function cubicBezierDerivative(
  out: vec3,
  t: number,
  p0: ReadonlyVec3,
  p1: ReadonlyVec3,
  p2: ReadonlyVec3,
  p3: ReadonlyVec3,
): vec3 {
  const it = 1 - t;
  const a = 3 * it * it;
  const b = 6 * it * t;
  const c = 3 * t * t;
  out[0] = a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]);
  out[1] = a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]);
  out[2] = a * (p1[2] - p0[2]) + b * (p2[2] - p1[2]) + c * (p3[2] - p2[2]);
  return out;
}

/**
 * Builds a running arc-length table by sampling the curve at `samples` points
 * (including both endpoints). Used to invert from arc length to parameter t
 * via binary search — FVD++'s equivalent of the Bezier reparameterization is
 * a Newton iteration (spec §5.2); M5 brings that over verbatim. For the M2
 * closure visualization a table lookup is enough.
 */
export function sampleArcLengthTable(
  p0: ReadonlyVec3,
  p1: ReadonlyVec3,
  p2: ReadonlyVec3,
  p3: ReadonlyVec3,
  samples: number,
): Float64Array {
  const table = new Float64Array(samples + 1);
  const prev = vec3.create();
  const curr = vec3.create();
  cubicBezier(prev, 0, p0, p1, p2, p3);
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    cubicBezier(curr, t, p0, p1, p2, p3);
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const dz = curr[2] - prev[2];
    table[i] = table[i - 1]! + Math.hypot(dx, dy, dz);
    vec3.copy(prev, curr);
  }
  return table;
}

/**
 * Given a target arc length `s`, returns the parameter t ∈ [0, 1] such that
 * the curve up to t has (approximately) that arc length. Linearly
 * interpolates between sample points in the table built by
 * `sampleArcLengthTable`.
 */
export function arcLengthToParameter(table: Float64Array, s: number): number {
  const last = table.length - 1;
  const total = table[last]!;
  if (s <= 0) return 0;
  if (s >= total) return 1;

  // Binary search for the bracket [lo, hi] with table[lo] ≤ s ≤ table[hi].
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (table[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = table[lo]!;
  const b = table[hi]!;
  const u = b > a ? (s - a) / (b - a) : 0;
  return (lo + u) / last;
}
