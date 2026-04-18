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

  // Handle length scales with the angle between entry and exit tangents: the
  // classic 1/3-gap rule only looks smooth when the tangents are aligned. As
  // the tangents diverge, the Bezier must curve harder in the same gap, which
  // produces a hairpin (or self-intersection). Stretch the handles out so the
  // curve has room to breathe.
  //
  // dotET  →  +1  aligned  → handle = gap / 3
  //           0   orthogonal → handle ≈ gap * 0.58
  //          −1   opposite → handle ≈ gap * 1.17 (prevents a cusp)
  //
  // Minimum absolute length keeps degenerate near-zero gaps from producing
  // zero-length handles that collapse the curve to a line.
  const dotET =
    endDir[0] * anchorDir[0] + endDir[1] * anchorDir[1] + endDir[2] * anchorDir[2];
  const angleScale = 1 + 2.5 * (1 - Math.max(-1, Math.min(1, dotET))) / 2;
  const handleLen = Math.max((gap / 3) * angleScale, 0.5);
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

  const rollFunc = createEmptyFunc(EFuncType.Roll, 'Closure roll');
  // One linear ramp taking the current roll back to the anchor's roll.
  // `length` is in meters; we use the straight-line gap as a conservative
  // arc-length estimate — the integrator re-derives the true arc length from
  // the curve itself, and a small length mismatch only changes the rate of
  // change of roll, not the endpoints.
  rollFunc.subfuncs.push(
    createLinearSubFunc({
      length: Math.max(gap, 0.01),
      startValue: 0,
      endValue: anchor.roll - endRoll,
    }),
  );

  const closure: BezierSection = {
    type: SecType.Bezier,
    name: 'Closure',
    controlPoints: [endPos, p1, p2, anchor.position],
    rollFunc,
    smoothStart: true,
    smoothEnd: true,
  };

  return {
    ...track,
    sections: [...track.sections, closure],
  };
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
