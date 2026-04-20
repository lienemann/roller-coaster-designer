// SPDX-License-Identifier: AGPL-3.0-only

// Corner-case golden tests: things that have historically broken. A failure
// here typically means the integrator regressed on an edge condition that
// isn't obvious from reading the happy-path code.

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SecType } from '../../src/model/enums.js';
import { closeTrack, regenerateClosure } from '../../src/ops/close-track.js';

import { anchorAt, curved, flatRoll, linearRoll, makeTrack, straight } from './fixtures.js';
import { type GoldenCase, runGolden } from './harness.js';

const GOLDEN_DIR = fileURLToPath(new URL('./data/corner', import.meta.url));

const cases: GoldenCase[] = [
  {
    name: '16-zero-length-straight',
    track: makeTrack('16-zero-length-straight', [
      anchorAt([0, 10, 0]),
      straight(0),
      straight(5),
    ]),
    invariants: [
      [
        'the zero-length Straight emits no nodes past the anchor',
        (snap) => {
          // sectionStartNodes for a zero-length section points at the same
          // index as the next section (empty span).
          const starts = snap.sectionStartNodes;
          if (starts[1] !== starts[2]) {
            throw new Error(`starts=${JSON.stringify([...starts])}`);
          }
        },
      ],
    ],
  },
  {
    name: '17-sub-step-straight',
    track: makeTrack('17-sub-step-straight', [
      anchorAt([0, 10, 0], { speed: 20 }),
      // One integration step at 20 m/s = 0.02 m. Section length 0.005 m
      // clips the step and emits exactly one additional node.
      straight(0.005),
      straight(1),
    ]),
    invariants: [
      [
        'sub-step Straight emits a single intermediate node',
        (snap) => {
          if (snap.sectionStartNodes[2]! - snap.sectionStartNodes[1]! !== 1) {
            throw new Error(
              `section 1 produced ${snap.sectionStartNodes[2]! - snap.sectionStartNodes[1]!} nodes`,
            );
          }
        },
      ],
    ],
  },
  {
    name: '18-leadin-dominates',
    track: makeTrack('18-leadin-dominates', [
      anchorAt([0, 10, 0]),
      // leadIn + leadOut > length: the integrator clamps them to length/2.
      curved({ length: 6, yawRate: Math.PI / 4 / 6, leadIn: 10, leadOut: 10 }),
    ]),
    invariants: [
      [
        'still reaches the section end without blowing up',
        (snap) => {
          if (snap.last.i === 0) throw new Error('no nodes emitted');
          // dir should have rotated by some positive amount.
          const yaw = Math.atan2(-snap.last.dir[2], snap.last.dir[0]);
          if (!(yaw > 0 && yaw < Math.PI / 2)) {
            throw new Error(`final yaw=${yaw}`);
          }
        },
      ],
    ],
  },
  {
    name: '19-train-stalls-on-steep-climb',
    track: makeTrack('19-train-stalls-on-steep-climb', [
      anchorAt([0, 10, 0], { pitch: Math.PI / 2.05, speed: 4 }),
      straight(20),
    ]),
    invariants: [
      [
        'velocity clamps to 0 before the section ends',
        (_snap, arrays) => {
          // Walk the vel column and make sure we see a zero.
          let sawZero = false;
          for (let i = 0; i < arrays.length; i += 1) {
            if ((arrays.vel[i] ?? 1) === 0) {
              sawZero = true;
              break;
            }
          }
          if (!sawZero) throw new Error('vel never reached 0');
        },
      ],
    ],
  },
];

describe('golden — corner cases', () => {
  for (const c of cases) {
    it(c.name, () => {
      runGolden(GOLDEN_DIR, c);
    });
  }

  it('20-closeTrack idempotent on an already-closed track', () => {
    const start = makeTrack('already-closed', [
      anchorAt([0, 10, 0]),
      straight(1, flatRoll(1, 0)),
    ]);
    // Manually splice in a closure.
    const closed = closeTrack(start);
    const twice = closeTrack(closed);
    // closeTrack returns the input by reference when already closed.
    expect(twice).toBe(closed);
  });

  it('21-regenerateClosure preserves isClosure flag', () => {
    const start = makeTrack('start', [
      anchorAt([0, 10, 0]),
      straight(10, linearRoll(10, 0, Math.PI / 3)),
    ]);
    const closed = closeTrack(start);
    const last = closed.sections[closed.sections.length - 1];
    expect(last?.type).toBe(SecType.Bezier);
    if (last?.type !== SecType.Bezier) return;
    expect(last.isClosure).toBe(true);

    const regen = regenerateClosure(closed);
    const regenLast = regen.sections[regen.sections.length - 1];
    if (regenLast?.type !== SecType.Bezier) throw new Error('regen last not Bezier');
    expect(regenLast.isClosure).toBe(true);
  });
});
