// SPDX-License-Identifier: AGPL-3.0-only

// Basic golden cases: geometry sanity for every core section type without
// exercising any advanced feature (no lead-in/out, no multi-subfunc roll, no
// forced/geometric, no smoothers). A failure in this file means a very
// fundamental math change moved a number.

import { fileURLToPath } from 'node:url';

import { describe, it } from 'vitest';

import { F_G } from '../../src/model/constants.js';

import { anchorAt, bezier, curved, linearRoll, makeTrack, straight } from './fixtures.js';
import { type GoldenCase, runGolden } from './harness.js';

const GOLDEN_DIR = fileURLToPath(new URL('./data/basic', import.meta.url));

const cases: GoldenCase[] = [
  {
    name: '01-horizontal-straight',
    track: makeTrack('01-horizontal-straight', [anchorAt([0, 10, 0], { speed: 12 }), straight(40)]),
    invariants: [
      [
        'forceNormal ≈ 1g throughout',
        (snap) => {
          for (const row of snap.sampled) {
            if (Math.abs(row.forceNormal - 1) > 1e-3) {
              throw new Error(`node ${row.i}: forceNormal=${row.forceNormal}`);
            }
          }
        },
      ],
      [
        'velocity stays at 12 m/s (frictionless horizontal)',
        (snap) => {
          if (Math.abs(snap.last.vel - 12) > 1e-3) {
            throw new Error(`last.vel=${snap.last.vel}`);
          }
        },
      ],
    ],
  },
  {
    name: '02-inclined-straight-up',
    track: makeTrack('02-inclined-straight-up', [
      anchorAt([0, 10, 0], { pitch: Math.PI / 6, speed: 20 }),
      straight(40),
    ]),
    invariants: [
      [
        'rider slows on climb (energy conservation)',
        (snap) => {
          if (snap.last.vel >= 20) throw new Error(`last.vel=${snap.last.vel}`);
        },
      ],
      [
        'forceLong < 0 on ascent (gravity pulls rider backward)',
        (snap) => {
          if (snap.sampled[1]!.forceLong >= 0) {
            throw new Error(`forceLong=${snap.sampled[1]!.forceLong}`);
          }
        },
      ],
    ],
  },
  {
    name: '03-inclined-straight-down',
    track: makeTrack('03-inclined-straight-down', [
      anchorAt([0, 30, 0], { pitch: -Math.PI / 6, speed: 10 }),
      straight(40),
    ]),
    invariants: [
      [
        'rider speeds up on descent',
        (snap) => {
          if (snap.last.vel <= 10) throw new Error(`last.vel=${snap.last.vel}`);
        },
      ],
      [
        'forceLong > 0 on descent',
        (snap) => {
          if (snap.sampled[1]!.forceLong <= 0) {
            throw new Error(`forceLong=${snap.sampled[1]!.forceLong}`);
          }
        },
      ],
    ],
  },
  {
    name: '04-flat-yaw-quarter-turn',
    track: makeTrack('04-flat-yaw-quarter-turn', [
      anchorAt([0, 10, 0]),
      curved({ fAngle: 90, fRadius: 20, fDirection: 90 }),
    ]),
    invariants: [
      [
        'y stays at anchor height (flat yaw)',
        (snap) => {
          for (const row of snap.sampled) {
            if (Math.abs(row.pos[1] - 10) > 1e-3) {
              throw new Error(`node ${row.i}: y=${row.pos[1]}`);
            }
          }
        },
      ],
      [
        'dir[Y] stays ≈ 0 (no vertical component on a flat turn)',
        (snap) => {
          if (Math.abs(snap.last.dir[1]) > 1e-3) {
            throw new Error(`last.dir[1]=${snap.last.dir[1]}`);
          }
        },
      ],
    ],
  },
  {
    name: '05-pitch-quarter-up',
    track: makeTrack('05-pitch-quarter-up', [
      anchorAt([0, 10, 0], { speed: 25 }),
      curved({ fAngle: 90, fRadius: 20, fDirection: 0 }),
    ]),
    invariants: [
      [
        'dir[Y] → 1 at end (straight up)',
        (snap) => {
          if (Math.abs(snap.last.dir[1] - 1) > 5e-3) {
            throw new Error(`last.dir[1]=${snap.last.dir[1]}`);
          }
        },
      ],
      [
        'y significantly above anchor',
        (snap) => {
          if (snap.last.pos[1] < 15) throw new Error(`last.y=${snap.last.pos[1]}`);
        },
      ],
    ],
  },
  {
    name: '06-bank-only-straight',
    track: makeTrack('06-bank-only-straight', [
      anchorAt([0, 10, 0]),
      straight(30, linearRoll(30, 0, Math.PI / 2)),
    ]),
    invariants: [
      [
        'position identical to un-banked straight (banking is rotation-only)',
        (snap) => {
          // Straight integrator advances pos by dir*step; banking never
          // affects dir. So X must linearly cover the section length.
          if (Math.abs(snap.last.pos[0] - 30) > 1e-2) {
            throw new Error(`last.x=${snap.last.pos[0]}`);
          }
          if (Math.abs(snap.last.pos[1] - 10) > 1e-3) {
            throw new Error(`last.y=${snap.last.pos[1]}`);
          }
        },
      ],
      [
        'roll ends near π/2',
        (snap) => {
          if (Math.abs(snap.last.roll - Math.PI / 2) > 1e-2) {
            throw new Error(`last.roll=${snap.last.roll}`);
          }
        },
      ],
      [
        'forceNormal approaches 0 when banked 90° (gravity projects onto lat)',
        (snap) => {
          if (Math.abs(snap.last.forceNormal) > 1e-2) {
            throw new Error(`last.forceNormal=${snap.last.forceNormal}`);
          }
          // And forceLateral ends near ±1 (gravity fully on lat).
          if (Math.abs(Math.abs(snap.last.forceLateral) - 1) > 1e-2) {
            throw new Error(`last.forceLateral=${snap.last.forceLateral}`);
          }
        },
      ],
    ],
  },
  {
    name: '07-simple-bezier-straight-line',
    track: makeTrack('07-simple-bezier-straight-line', [
      anchorAt([0, 10, 0]),
      bezier({
        controlPoints: [
          [0, 10, 0],
          [10, 10, 0],
          [20, 10, 0],
          [30, 10, 0],
        ],
      }),
    ]),
    invariants: [
      [
        'colinear control points yield a straight-line Bezier',
        (snap) => {
          for (const row of snap.sampled) {
            if (Math.abs(row.pos[1] - 10) > 1e-3) {
              throw new Error(`node ${row.i}: y=${row.pos[1]}`);
            }
            if (Math.abs(row.pos[2]) > 1e-3) {
              throw new Error(`node ${row.i}: z=${row.pos[2]}`);
            }
          }
        },
      ],
    ],
  },
];

describe('golden — basic physics', () => {
  for (const c of cases) {
    it(c.name, () => {
      runGolden(GOLDEN_DIR, c);
    });
  }
});

// Reference F_G so lints don't flag the import if a future case stops using it.
void F_G;
