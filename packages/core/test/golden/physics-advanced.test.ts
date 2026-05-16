// SPDX-License-Identifier: AGPL-3.0-only

// Advanced golden cases: exercises features that go beyond "anchor + one
// section". Covers lead-in/out blending, Curved with banking (regression
// test for the pitch-axis fix), Forced and Geometric integrators,
// multi-subfunc rolls, and cross-section smoothers.

import { fileURLToPath } from 'node:url';

import { describe, it } from 'vitest';

import {
  anchorAt,
  curved,
  cubicSubFunc,
  forced,
  geometric,
  linearRoll,
  makeTrack,
  multiSubfuncRoll,
  straight,
} from './fixtures.js';
import { type GoldenCase, runGolden } from './harness.js';

const GOLDEN_DIR = fileURLToPath(new URL('./data/advanced', import.meta.url));

const cases: GoldenCase[] = [
  {
    name: '08-curved-leadin-leadout',
    track: makeTrack('08-curved-leadin-leadout', [
      anchorAt([0, 10, 0]),
      curved({
        fAngle: 60,
        fRadius: 30,
        fDirection: 90,
        fLeadIn: 15,
        fLeadOut: 15,
      }),
    ]),
    invariants: [
      [
        'turn rate near start is tiny (lead-in ramp)',
        (_snap, arrays) => {
          // The lead-in smoothstep ramps from 0 across the first leadIn metres.
          // Check that dir[Z] is still near anchor's value a short way in.
          const earlyIdx = 200;
          if (Math.abs(arrays.dirZ[earlyIdx] ?? 0) > 0.05) {
            throw new Error(`dirZ[200]=${arrays.dirZ[earlyIdx]}`);
          }
        },
      ],
    ],
  },
  {
    name: '09-curved-with-banking',
    track: makeTrack('09-curved-with-banking', [
      anchorAt([0, 10, 0]),
      curved({
        fAngle: 45,
        fRadius: 20,
        fDirection: 90,
        rollFunc: linearRoll(45, 0, Math.PI / 4),
      }),
    ]),
    invariants: [
      [
        'y stays flat under banking + yaw (pitch axis is horizontal, not banked)',
        (snap) => {
          for (const row of snap.sampled) {
            if (Math.abs(row.pos[1] - 10) > 1e-2) {
              throw new Error(`node ${row.i}: y=${row.pos[1]}`);
            }
          }
        },
      ],
    ],
  },
  {
    name: '10-forced-2g-turn',
    track: makeTrack('10-forced-2g-turn', [
      anchorAt([0, 10, 0], { speed: 20 }),
      forced({ extent: 3, normalG: 2, lateralG: 0 }),
    ]),
    invariants: [
      [
        'forceNormal tracks the driving 2g',
        (snap) => {
          // Pick a sample well inside the section.
          const row = snap.sampled[Math.floor(snap.sampled.length / 2)]!;
          if (Math.abs(row.forceNormal - 2) > 5e-2) {
            throw new Error(`mid.forceNormal=${row.forceNormal}`);
          }
        },
      ],
    ],
  },
  {
    name: '11-geometric-linear-pitch',
    track: makeTrack('11-geometric-linear-pitch', [
      anchorAt([0, 20, 0], { speed: 15 }),
      // Geometric sections take the pitchFunc as "pitch at arg"; evalFuncRate
      // returns the derivative = rate per unit arg. Linear ramp 0→angle gives
      // a constant rate. Use 30° total pitch over 12 m of arc.
      // ~30° of pitch over 12 m at v=15 m/s ⇒ 12/15 ≈ 0.8 s ⇒ ~37.5°/s.
      // (FVD++'s Geometric pitch rate is degrees per second; matched here.)
      geometric({ extent: 12, pitchRate: 37.5 }),
    ]),
    invariants: [
      [
        'rider pitches up',
        (snap) => {
          if (snap.last.dir[1] < 0.3) throw new Error(`last.dir[1]=${snap.last.dir[1]}`);
        },
      ],
    ],
  },
  {
    name: '12-multi-subfunc-roll',
    track: makeTrack('12-multi-subfunc-roll', [
      anchorAt([0, 10, 0]),
      straight(
        30,
        multiSubfuncRoll([
          // First 10 m: hold level.
          {
            degree: 0,
            length: 10,
            startValue: 0,
            endValue: 0,
            arg1: 0,
            centerArg: 0,
            tensionArg: 0,
          },
          // Next 15 m: cubic ramp to π.
          cubicSubFunc({ length: 15, startValue: 0, endValue: Math.PI }),
          // Final 5 m: hold. Each subfunc contributes via evalRoll(). A
          // "continue at π" hold is `0 → 0` — the second subfunc already
          // contributed π as its running value.
          {
            degree: 0,
            length: 5,
            startValue: 0,
            endValue: 0,
            arg1: 0,
            centerArg: 0,
            tensionArg: 0,
          },
        ]),
      ),
    ]),
    invariants: [
      [
        'roll ends exactly at π',
        (snap) => {
          if (Math.abs(snap.last.roll - Math.PI) > 1e-3) {
            throw new Error(`last.roll=${snap.last.roll}`);
          }
        },
      ],
    ],
  },
  {
    name: '13-smoother-at-boundary',
    track: {
      name: '13-smoother-at-boundary',
      style: 0,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        anchorAt([0, 10, 0], { speed: 15 }),
        forced({ extent: 2, normalG: 1 }),
        forced({ extent: 2, normalG: 2 }),
      ],
      // Smoother spans the 1→2 transition.
      smoothers: [{ fromSection: 1, toSection: 2, strength: 1 }],
    },
    invariants: [
      [
        'smoothed normal near the boundary is strictly between 1 and 2',
        (_snap, arrays) => {
          // The section boundary in time is approximately anchor (1 node)
          // + 2 seconds * 1000 Hz = 2001. Pick a node 20 ms into the second
          // Forced section; raw should be close to 2, but smoothNormal with
          // a ±45 ms Gaussian pulls it back toward the pre-boundary value.
          const idx = 2020;
          const raw = arrays.forceNormal[idx] ?? 0;
          const smooth = arrays.smoothNormal[idx] ?? 0;
          if (!(smooth > 1.1 && smooth < raw)) {
            throw new Error(`idx=${idx} raw=${raw} smooth=${smooth}`);
          }
        },
      ],
    ],
  },
];

describe('golden — advanced physics', () => {
  for (const c of cases) {
    it(c.name, () => {
      runGolden(GOLDEN_DIR, c);
    });
  }
});
