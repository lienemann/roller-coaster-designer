// SPDX-License-Identifier: AGPL-3.0-only

import { EFuncType, SecType } from '../model/enums.js';
import { createEmptyFunc } from '../model/function.js';
import { type ClosureSection, isAnchor } from '../model/section.js';
import { createLinearSubFunc } from '../model/subfunction.js';
import { type Track } from '../model/track.js';
import { integrateTrack } from '../physics/integrate.js';

// Tolerance for "already closed" — 1 mm on position, 1° on roll.
const CLOSED_POSITION_EPSILON = 1e-3;
const CLOSED_ROLL_EPSILON = Math.PI / 180;

export class TrackClosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackClosureError';
  }
}

/**
 * Returns a copy of the track with a `Closure` section appended that
 * smoothly joins the current end pose back to the anchor. The closure's
 * control points are not stored — the integrator derives them every
 * recompute from the previous section's end pose and the anchor's pose.
 *
 * What we compute here is just a sensible default for the entry/exit
 * handle lengths and a roll-ramp Func that moves the rider's roll back
 * to the anchor along the shortest signed angle.
 *
 * If the track is already closed (end ≈ anchor on both position and
 * roll) returns the original unchanged.
 *
 * Throws `TrackClosureError` when the track has fewer than two sections,
 * does not start with an Anchor, or already has a Closure.
 */
export function closeTrack(track: Track): Track {
  if (track.sections.length < 2) {
    throw new TrackClosureError(
      'Track needs an Anchor and at least one other section before closing.',
    );
  }
  const anchor = track.sections[0]!;
  if (!isAnchor(anchor)) {
    throw new TrackClosureError('First section must be an Anchor.');
  }
  if (track.sections.some((s) => s.type === SecType.Closure)) {
    throw new TrackClosureError('Track already has a closure section.');
  }

  // Run the integrator to discover the current end state. The closure
  // itself round-trips through this same integrator on the next recompute.
  const { arrays } = integrateTrack(track);
  const last = arrays.length - 1;
  if (last <= 0) {
    throw new TrackClosureError('Track has no integrated end node to close from.');
  }

  const endPos: [number, number, number] = [
    arrays.posX[last]!,
    arrays.posY[last]!,
    arrays.posZ[last]!,
  ];
  const endDir: [number, number, number] = [
    arrays.dirX[last]!,
    arrays.dirY[last]!,
    arrays.dirZ[last]!,
  ];
  const endRoll = arrays.roll[last]!;

  // Anchor forward direction: recompute from yaw/pitch since we can't read
  // a "node 0 dir" and have confidence it wasn't rewritten by roll.
  const anchorDir = anchorForward(anchor.yaw, anchor.pitch);
  const dx = anchor.position[0] - endPos[0];
  const dy = anchor.position[1] - endPos[1];
  const dz = anchor.position[2] - endPos[2];
  const gap = Math.hypot(dx, dy, dz);

  if (gap <= CLOSED_POSITION_EPSILON && Math.abs(endRoll - anchor.roll) <= CLOSED_ROLL_EPSILON) {
    return track;
  }

  // Handle length scales with three things:
  //   1. Tangent divergence: parallel tangents want ≈ gap/3; opposing
  //      tangents want > gap to avoid a cusp.
  //   2. Sideways gap: the component perpendicular to the mean tangent —
  //      a Bezier needs longer handles to arc out of the way.
  //   3. A floor so near-zero gaps still produce a curve.
  const dotET = clamp(
    endDir[0] * anchorDir[0] + endDir[1] * anchorDir[1] + endDir[2] * anchorDir[2],
    -1,
    1,
  );
  const angleScale = 1 + 1.25 * (1 - dotET);
  const meanTx = 0.5 * (endDir[0] + anchorDir[0]);
  const meanTy = 0.5 * (endDir[1] + anchorDir[1]);
  const meanTz = 0.5 * (endDir[2] + anchorDir[2]);
  const meanLen = Math.hypot(meanTx, meanTy, meanTz) || 1;
  const gapAlong = (dx * meanTx + dy * meanTy + dz * meanTz) / meanLen;
  const gapPerpSq = Math.max(0, dx * dx + dy * dy + dz * dz - gapAlong * gapAlong);
  const perpPad = Math.sqrt(gapPerpSq) * 0.4;
  const handleLen = Math.max((gap / 3) * angleScale + perpPad, 0.5);

  // Shortest-path roll unwrap: ±3π/2 endpoints map to a +π/2 ramp
  // through upright, never the long way around through inverted.
  const rollDelta = shortestAngleDelta(endRoll, anchor.roll);
  const rollFunc = createEmptyFunc(EFuncType.Roll, 'Closure roll');
  rollFunc.subfuncs.push(
    createLinearSubFunc({
      length: Math.max(gap, 0.01),
      startValue: 0,
      endValue: rollDelta,
    }),
  );

  const closure: ClosureSection = {
    type: SecType.Closure,
    name: 'Closure',
    entryHandleLength: handleLen,
    exitHandleLength: handleLen,
    rollFunc,
  };

  return {
    ...track,
    sections: [...track.sections, closure],
  };
}

/**
 * If the track ends in a `Closure` section, regenerate its handle lengths
 * and roll ramp from the current upstream geometry. Cheap no-op when the
 * track is open or already in sync. Called after every property edit so
 * the closure follows upstream changes without the user re-running
 * `closeTrack` manually.
 */
export function regenerateClosure(track: Track): Track {
  const n = track.sections.length;
  if (n < 2) return track;
  const last = track.sections[n - 1];
  if (last?.type !== SecType.Closure) return track;
  const openTrack: Track = { ...track, sections: track.sections.slice(0, n - 1) };
  try {
    return closeTrack(openTrack);
  } catch {
    // closeTrack only throws on degenerate inputs (no anchor, < 2 sections,
    // empty integration). In those cases we leave the closure as-is.
    return track;
  }
}

/** Signed delta `b − a` reduced to the range [−π, π]. Picks the shortest
 *  rotation to go from `a` to `b`; doesn't care how many full turns apart
 *  they nominally are. */
function shortestAngleDelta(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function anchorForward(yaw: number, pitch: number): [number, number, number] {
  // Match the integrator's convention: start at +X, yaw around +Y, pitch
  // around the yawed lateral axis (rider's right = +Z at rest).
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [cy * cp, sp, -sy * cp];
}
