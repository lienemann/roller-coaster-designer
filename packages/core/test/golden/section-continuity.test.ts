// SPDX-License-Identifier: AGPL-3.0-only

// Section-boundary continuity test: when two sections are chained, the last
// node of section N-1 and the first node of section N (one integration step
// later in time) should be C0-continuous in all 6 rigid-body DoFs:
//
//   - position (3 DoF)
//   - forward direction (2 DoF as a unit vector, embedded in 3 components)
//   - roll about the forward direction (1 DoF, equivalently the lateral axis)
//
// Concretely: the change across the boundary must be no larger than what a
// single integration step inside one of the two adjacent sections produces.
// A bug like the old "section forgot to read previous lat" symptom snaps
// dir/lat by hundreds of degrees in one step; a 3× slack on the in-section
// max keeps a sharp Roll function or a tight Curved from false-positiving
// while still catching real snaps.
//
// Each test track packs deliberately wild parameters — non-axis-aligned
// anchor poses, mixed pitch+yaw rates, large roll ramps spanning a section,
// and signs flipped from the "obvious" — so unusual combinations have to
// integrate cleanly across the boundary too.

import { describe, it } from 'vitest';

import { F_HZ } from '../../src/model/constants.js';
import { type MNodeArrays } from '../../src/model/mnode.js';
import { type Track } from '../../src/model/track.js';
import { integrateTrack } from '../../src/physics/integrate.js';

import {
  anchorAt,
  chainedBezier,
  cubicSubFunc,
  curved,
  flatRoll,
  forced,
  geometric,
  linearRoll,
  makeTrack,
  multiSubfuncRoll,
  straight,
} from './fixtures.js';

const BOUNDARY_SLACK = 3;

interface ContinuityCase {
  readonly name: string;
  readonly track: Track;
}

const cases: ContinuityCase[] = [
  {
    name: 'wild-1: tilted anchor → curved with combined pitch+yaw and roll',
    track: makeTrack('wild-1', [
      anchorAt([0.7, 12.3, -1.4], {
        pitch: 0.13,
        yaw: -0.91,
        roll: 0.42,
        speed: 18.7,
      }),
      curved({
        length: 23.5,
        pitchRate: 0.07,
        yawRate: -0.05,
        rollFunc: linearRoll(23.5, 0.42, -1.61),
      }),
    ]),
  },
  {
    name: 'wild-2: bezier sandwiched between two curves',
    track: (() => {
      const anchor = anchorAt([5, 18, 0], { yaw: 0.3, speed: 15 });
      const curve1 = curved({
        length: 12,
        yawRate: 0.21 / 12,
        rollFunc: linearRoll(12, 0, 0.6),
      });
      // The Bezier's first control point MUST equal the previous section's
      // end position — the integrator samples the cubic verbatim and does
      // not auto-translate. `chainedBezier` integrates the prefix, then
      // pins p0 to that end, with the remaining three handles given
      // relative to that pinned origin.
      const bez = chainedBezier([anchor, curve1], {
        handleLength: 4,
        // p2 and p3 are absolute; just pick something that makes a sane
        // curve from the curve1 endpoint forward.
        p2: [22, 18.7, -7],
        p3: [26, 18, -8],
        rollFunc: linearRoll(11, 0, -1),
      });
      return makeTrack('wild-2', [
        anchor,
        curve1,
        bez,
        curved({ length: 8, pitchRate: 0.12 / 8, rollFunc: linearRoll(8, 0, 0.4) }),
      ]);
    })(),
  },
  {
    name: 'wild-3: mix every integrator (Straight → Forced → Geometric → Curved → Bezier → Straight)',
    track: (() => {
      const anchor = anchorAt([0, 25, 0], { pitch: -0.18, speed: 22 });
      const s1 = straight(8, linearRoll(8, 0, 0.7));
      const f = forced({
        extent: 1.5,
        normalG: 1.4,
        lateralG: -0.3,
        rollFunc: linearRoll(1.5, 0, 0.3),
      });
      const g = geometric({
        extent: 6,
        pitchRate: 0.15 / 6,
        yawRate: 0.08 / 6,
        rollFunc: linearRoll(6, 0, -0.7),
      });
      const c = curved({
        length: 9,
        pitchRate: -0.22 / 9,
        yawRate: 0.13 / 9,
        leadIn: 1.5,
        leadOut: 1.5,
        rollFunc: linearRoll(9, 0, -0.8),
      });
      const bez = chainedBezier([anchor, s1, f, g, c], {
        handleLength: 3,
        p2: [60, 33, 7],
        p3: [62, 33, 8],
        rollFunc: linearRoll(7, 0, 0.5),
      });
      return makeTrack('wild-3', [anchor, s1, f, g, c, bez, straight(4)]);
    })(),
  },
  {
    name: 'wild-4: multi-subfunc roll spanning a section boundary',
    track: makeTrack('wild-4', [
      anchorAt([0, 14, 0]),
      straight(
        14,
        multiSubfuncRoll([
          { degree: 0, length: 4, startValue: 0, endValue: 0.5, arg1: 0, centerArg: 0, tensionArg: 0 },
          cubicSubFunc({ length: 6, startValue: 0, endValue: 1.2 }),
          { degree: 0, length: 4, startValue: 0, endValue: -0.4, arg1: 0, centerArg: 0, tensionArg: 0 },
        ]),
      ),
      curved({
        length: 6,
        yawRate: 0.4 / 6,
        // The curved section continues the rotation from where the straight
        // ended — its rollFunc starts from the matching end value via the
        // integrator's rollOffset adjustment. Test must still see no boundary
        // snap.
        rollFunc: linearRoll(6, 0, -0.6),
      }),
    ]),
  },
  {
    name: 'wild-5: short sections (sub-step + length boundaries)',
    track: makeTrack('wild-5', [
      anchorAt([0, 10, 0], { speed: 30 }),
      // 0.04 m at 30 m/s = 1.33 ms → ~2 nodes total in this section.
      straight(0.04, flatRoll(0.04, 0)),
      curved({ length: 0.5, yawRate: 0.1 / 0.5 }),
      straight(2, linearRoll(2, 0, 0.3)),
    ]),
  },
];

describe('section-boundary continuity', () => {
  for (const c of cases) {
    it(c.name, () => {
      const { arrays, sectionStartNodes } = integrateTrack(c.track);
      // Section 0 is the anchor (single node), so begin at section 1.
      for (let n = 1; n < sectionStartNodes.length; n += 1) {
        const start = sectionStartNodes[n]!;
        if (start <= 0 || start >= arrays.length) continue;
        const prev = start - 1;
        const within = withinSectionMaxDelta(arrays, prev, sectionStartNodes, n);
        // Velocity-based floor: a single integration step covers
        // vel/F_HZ metres of arc, so even when the surrounding sections
        // are too short to sample a typical step, that's the smallest
        // distance the boundary step could legitimately have. Use 1.5×
        // for slack on end-of-section clipping.
        const localVel = Math.max(arrays.vel[prev] ?? 0, arrays.vel[start] ?? 0);
        const velFloor = (localVel / F_HZ) * 1.5;
        const withinFloored: StepDelta = {
          pos: Math.max(within.pos, velFloor),
          dirAngle: within.dirAngle,
          latAngle: within.latAngle,
          roll: within.roll,
        };
        const boundary = stepDelta(arrays, prev, start);
        assertContinuity(boundary, withinFloored, c.name, n, prev, start, arrays);
      }
    });
  }
});

interface StepDelta {
  readonly pos: number;
  readonly dirAngle: number;
  readonly latAngle: number;
  readonly roll: number;
}

function stepDelta(arrays: MNodeArrays, a: number, b: number): StepDelta {
  return {
    pos: Math.hypot(
      (arrays.posX[b] ?? 0) - (arrays.posX[a] ?? 0),
      (arrays.posY[b] ?? 0) - (arrays.posY[a] ?? 0),
      (arrays.posZ[b] ?? 0) - (arrays.posZ[a] ?? 0),
    ),
    dirAngle: angleBetween(
      [arrays.dirX[a]!, arrays.dirY[a]!, arrays.dirZ[a]!],
      [arrays.dirX[b]!, arrays.dirY[b]!, arrays.dirZ[b]!],
    ),
    latAngle: angleBetween(
      [arrays.latX[a]!, arrays.latY[a]!, arrays.latZ[a]!],
      [arrays.latX[b]!, arrays.latY[b]!, arrays.latZ[b]!],
    ),
    roll: Math.abs((arrays.roll[b] ?? 0) - (arrays.roll[a] ?? 0)),
  };
}

/** Largest single-step delta seen inside the section that owns `boundaryIdx`
 *  or the section just before it — whichever is bigger. Used as the
 *  in-section reference against which the boundary step is compared. */
function withinSectionMaxDelta(
  arrays: MNodeArrays,
  boundaryPrev: number,
  sectionStartNodes: readonly number[],
  n: number,
): StepDelta {
  // Sample the previous section's last few steps and the new section's
  // early steps. Skip the very boundary itself.
  const ranges: [number, number][] = [];
  const prevSectionStart = n - 1 >= 0 ? sectionStartNodes[n - 1]! : 0;
  ranges.push([Math.max(prevSectionStart + 1, boundaryPrev - 100), boundaryPrev]);
  const nextSectionEnd = n + 1 < sectionStartNodes.length ? sectionStartNodes[n + 1]! : arrays.length;
  ranges.push([sectionStartNodes[n]! + 1, Math.min(nextSectionEnd, sectionStartNodes[n]! + 100)]);

  let maxPos = 0;
  let maxDir = 0;
  let maxLat = 0;
  let maxRoll = 1 / F_HZ; // floor: roll never moves zero per step on a non-flat function
  for (const [lo, hi] of ranges) {
    for (let i = lo + 1; i < hi; i += 1) {
      const d = stepDelta(arrays, i - 1, i);
      if (d.pos > maxPos) maxPos = d.pos;
      if (d.dirAngle > maxDir) maxDir = d.dirAngle;
      if (d.latAngle > maxLat) maxLat = d.latAngle;
      if (d.roll > maxRoll) maxRoll = d.roll;
    }
  }
  return { pos: maxPos, dirAngle: maxDir, latAngle: maxLat, roll: maxRoll };
}

function assertContinuity(
  boundary: StepDelta,
  within: StepDelta,
  caseName: string,
  n: number,
  prev: number,
  start: number,
  arrays: MNodeArrays,
): void {
  const posTol = Math.max(within.pos, 1e-4) * BOUNDARY_SLACK;
  const dirTol = Math.max(within.dirAngle, 1e-4) * BOUNDARY_SLACK;
  const latTol = Math.max(within.latAngle, 1e-4) * BOUNDARY_SLACK;
  const rollTol = Math.max(within.roll, 1e-4) * BOUNDARY_SLACK;

  const fail = (label: string, got: number, tol: number): never => {
    const posPrev = [arrays.posX[prev]!, arrays.posY[prev]!, arrays.posZ[prev]!];
    const posStart = [arrays.posX[start]!, arrays.posY[start]!, arrays.posZ[start]!];
    throw new Error(
      `${caseName} boundary at section ${n} (nodes ${prev}→${start}): ${label} ` +
        `step=${got.toExponential(3)} exceeds tol=${tol.toExponential(3)} ` +
        `(within-section max=${(label === 'pos' ? within.pos : label === 'dirAngle' ? within.dirAngle : label === 'latAngle' ? within.latAngle : within.roll).toExponential(3)}). ` +
        `prev pos=[${posPrev.map((v) => v.toFixed(4)).join(', ')}] ` +
        `start pos=[${posStart.map((v) => v.toFixed(4)).join(', ')}]`,
    );
  };

  if (boundary.pos > posTol) fail('pos', boundary.pos, posTol);
  if (boundary.dirAngle > dirTol) fail('dirAngle', boundary.dirAngle, dirTol);
  if (boundary.latAngle > latTol) fail('latAngle', boundary.latAngle, latTol);
  if (boundary.roll > rollTol) fail('roll', boundary.roll, rollTol);
}

function angleBetween(a: readonly number[], b: readonly number[]): number {
  const d = (a[0]! * b[0]!) + (a[1]! * b[1]!) + (a[2]! * b[2]!);
  // Clamp to the valid acos domain — float32 dot products can overshoot ±1
  // by 1e-7 on parallel unit vectors.
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
