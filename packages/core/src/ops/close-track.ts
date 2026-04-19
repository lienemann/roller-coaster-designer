// SPDX-License-Identifier: AGPL-3.0-only

import { EFuncType, SecType } from '../model/enums.js';
import { createEmptyFunc } from '../model/function.js';
import { type BezierSection, isAnchor } from '../model/section.js';
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
 * Returns a copy of the track with a Bezier section appended that smoothly
 * joins the current end pose back to the anchor. Tangent-continuous at both
 * ends: the new section leaves along the last node's forward direction and
 * enters the anchor along the anchor's forward direction.
 *
 * The closure Bezier's control points are the standard cubic-Hermite-style
 * "split the gap" rule:
 *
 *   P0 = end position
 *   P1 = end position + end forward × (L / 3)
 *   P2 = anchor position − anchor forward × (L / 3)
 *   P3 = anchor position
 *
 * where L is the straight-line distance between end and anchor. The one-third
 * offset is the Catmull-Rom-derived choice that gives minimum curvature at
 * tangent-matched endpoints.
 *
 * The returned track's roll function ramps linearly from the end roll back to
 * the anchor roll over the closure section so the rider doesn't flip in one
 * node. If already closed (end ≈ anchor on both position and roll), returns
 * the original track unchanged.
 *
 * Throws `TrackClosureError` when the track has fewer than two sections or
 * does not start with an Anchor.
 */
/**
 * If the track's last section is a `closeTrack`-generated closure (marked
 * `isClosure: true`), regenerates its control points from the current
 * upstream geometry so the closure always meets the anchor tangentially.
 * Cheap no-op when the last section isn't a closure.
 *
 * This is what the app calls after every edit so a user doesn't have to
 * "Close Track" again every time they tweak a section in the middle.
 */
export function regenerateClosure(track: Track): Track {
  const n = track.sections.length;
  if (n < 2) return track;
  const last = track.sections[n - 1];
  if (last?.type !== SecType.Bezier || last.isClosure !== true) return track;
  const openTrack: Track = { ...track, sections: track.sections.slice(0, n - 1) };
  const reclosed = closeTrack(openTrack);
  // closeTrack returns `openTrack` unchanged if already closed — in that
  // case no closure was re-added. Our caller wants isClosure preserved
  // either way; re-mark the last section.
  if (reclosed === openTrack) return track;
  const newLast = reclosed.sections[reclosed.sections.length - 1];
  if (newLast?.type !== SecType.Bezier) return track;
  const markedLast: BezierSection = { ...newLast, isClosure: true };
  return { ...reclosed, sections: [...reclosed.sections.slice(0, -1), markedLast] };
}

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

  // Run the existing integrator to discover the current end state. The
  // closeTrack output still has to round-trip through the same integrator,
  // which is exactly what the viewport does after a close.
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

  // Handle length has to account for three things that push it up:
  //   1. Tangent divergence: parallel tangents want ≈ gap/3; opposing
  //      tangents want > gap/1 to avoid a cusp.
  //   2. Gap geometry: the straight-line gap under-estimates how much curve
  //      a Bezier needs when end and anchor don't point AT each other —
  //      specifically when the two tangents project onto the gap with a
  //      small footprint, the Bezier has to arc sideways a lot. We use the
  //      component of the gap perpendicular to the mean tangent as an extra
  //      "sideways demand" and pad the handles by it.
  //   3. Minimum absolute length so near-zero gaps still produce a curve.
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
  const p1: [number, number, number] = [
    endPos[0] + endDir[0] * handleLen,
    endPos[1] + endDir[1] * handleLen,
    endPos[2] + endDir[2] * handleLen,
  ];
  const p2: [number, number, number] = [
    anchor.position[0] - anchorDir[0] * handleLen,
    anchor.position[1] - anchorDir[1] * handleLen,
    anchor.position[2] - anchorDir[2] * handleLen,
  ];

  // Shortest-path roll unwrap. The ramp is in absolute angle; if the track
  // ends at +3π/2 and the anchor is at 0, the raw delta is −3π/2 which
  // would roll the rider backward through upside-down. Unwrapping to the
  // ±π branch (here: +π/2) keeps the closure upright whenever the two
  // endpoints are already close in angle modulo 2π.
  const rollDelta = shortestAngleDelta(endRoll, anchor.roll);
  const rollFunc = createEmptyFunc(EFuncType.Roll, 'Closure roll');
  // `length` is in meters; we use the straight-line gap as a conservative
  // arc-length estimate — the integrator re-derives the true arc length from
  // the curve itself, and a small length mismatch only changes the rate of
  // change of roll, not the endpoints.
  rollFunc.subfuncs.push(
    createLinearSubFunc({
      length: Math.max(gap, 0.01),
      startValue: 0,
      endValue: rollDelta,
    }),
  );

  const closure: BezierSection = {
    type: SecType.Bezier,
    name: 'Closure',
    controlPoints: [endPos, p1, p2, anchor.position],
    rollFunc,
    smoothStart: true,
    smoothEnd: true,
    isClosure: true,
  };

  return {
    ...track,
    sections: [...track.sections, closure],
  };
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
  // around the yawed lateral axis (rider's right = +Z at rest). Derived by
  // inspection rather than calling the integrator to avoid a cycle.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Yaw only: dir = (cy, 0, -sy). Pitch around lat = (sy, 0, cy) by angle
  // `pitch`: rotate dir upward. Using Rodrigues analytically:
  //   dir_yawed = (cy, 0, -sy)
  //   rotating around lat=(sy, 0, cy) by pitch:
  //     new_y  = +sp (because axis perpendicular to dir raises the y component)
  //     new_xz = cp * dir_yawed
  return [cy * cp, sp, -sy * cp];
}
