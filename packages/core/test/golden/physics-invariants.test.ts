// SPDX-License-Identifier: AGPL-3.0-only

// Physics invariants that hold regardless of the specific Track. Snapshots
// are NOT used here — the assertions express physical constraints directly.
//
// Each invariant runs against several tracks so an edge condition that
// isn't on the golden curve still gets exercised.

import { describe, expect, it } from 'vitest';

import { F_G, F_HZ, HEART_ENERGY_FACTOR } from '../../src/model/constants.js';
import { integrateTrack } from '../../src/physics/integrate.js';

import { anchorAt, curved, linearRoll, makeTrack, straight } from './fixtures.js';

describe('physics invariants', () => {
  it('energy conservation on frictionless sections (per-node max drift)', () => {
    // Every integrator branch should conserve FVD++'s energy expression:
    //   E = ½v² + F_G·(pos.y − 0.9·heart·norm.y)
    // node-to-node, to within float32 drift (~1e-3).
    const tracks = [
      makeTrack('horizontal', [anchorAt([0, 10, 0], { speed: 15 }), straight(40)]),
      makeTrack('incline-up', [
        anchorAt([0, 10, 0], { pitch: Math.PI / 6, speed: 25 }),
        straight(30),
      ]),
      makeTrack('incline-down', [
        anchorAt([0, 30, 0], { pitch: -Math.PI / 6, speed: 5 }),
        straight(30),
      ]),
      makeTrack('quarter-turn', [
        anchorAt([0, 10, 0], { speed: 15 }),
        curved({ length: 20, yawRate: Math.PI / 2 / 20 }),
      ]),
      makeTrack('pitched-with-bank', [
        anchorAt([0, 10, 0], { speed: 22 }),
        curved({
          length: 20,
          pitchRate: Math.PI / 4 / 20,
          rollFunc: linearRoll(20, 0, Math.PI / 4),
        }),
      ]),
      makeTrack('multi-section', [
        anchorAt([0, 20, 0], { pitch: -Math.PI / 8, speed: 10 }),
        straight(10),
        curved({ length: 10, pitchRate: Math.PI / 4 / 10 }),
        straight(10),
      ]),
    ];

    for (const track of tracks) {
      const { arrays } = integrateTrack(track);
      if (arrays.length === 0) continue;
      const e0 = energyOf(arrays, 0);
      for (let i = 1; i < arrays.length; i += Math.max(1, Math.floor(arrays.length / 40))) {
        if ((arrays.vel[i] ?? 0) === 0) break; // stalled; energy check irrelevant past this
        const ei = energyOf(arrays, i);
        const rel = Math.abs(ei - e0) / Math.max(Math.abs(e0), 1);
        if (rel > 1e-3) {
          throw new Error(
            `${track.name} node ${i}: energy drift rel=${rel.toExponential(2)} ` +
              `(e0=${e0.toFixed(4)}, ei=${ei.toFixed(4)})`,
          );
        }
      }
    }
  });

  it('rollSpeed matches numerical derivative of roll', () => {
    const track = makeTrack('roll-speed', [
      anchorAt([0, 10, 0]),
      straight(20, linearRoll(20, 0, Math.PI)),
    ]);
    const { arrays } = integrateTrack(track);
    for (let i = 1; i < arrays.length; i += 1) {
      const expected = (arrays.roll[i]! - arrays.roll[i - 1]!) * F_HZ;
      const actual = arrays.rollSpeed[i]!;
      expect(Math.abs(expected - actual)).toBeLessThan(1e-3);
    }
  });

  it('heart path of an unbanked Straight is a flat line', () => {
    // With roll=0 the norm vector stays straight up; the heart-path y formula
    // reduces to pos.y − 0.99. On a horizontal Straight this is a constant,
    // so velocity (from energy conservation) is constant.
    const { arrays } = integrateTrack(
      makeTrack('unbanked', [anchorAt([0, 10, 0], { speed: 12 }), straight(40)]),
    );
    for (let i = 0; i < arrays.length; i += 100) {
      expect(Math.abs((arrays.vel[i] ?? 0) - 12)).toBeLessThan(1e-3);
    }
  });

  it('orientation vectors remain orthonormal', () => {
    const { arrays } = integrateTrack(
      makeTrack('ortho-check', [
        anchorAt([0, 10, 0]),
        curved({
          length: 20,
          pitchRate: Math.PI / 4 / 20,
          yawRate: Math.PI / 6 / 20,
          rollFunc: linearRoll(20, 0, Math.PI / 5),
        }),
      ]),
    );
    for (let i = 0; i < arrays.length; i += 100) {
      const dir = [arrays.dirX[i]!, arrays.dirY[i]!, arrays.dirZ[i]!];
      const lat = [arrays.latX[i]!, arrays.latY[i]!, arrays.latZ[i]!];
      const norm = [arrays.normX[i]!, arrays.normY[i]!, arrays.normZ[i]!];
      expect(Math.abs(dot(dir, dir) - 1)).toBeLessThan(1e-3);
      expect(Math.abs(dot(lat, lat) - 1)).toBeLessThan(1e-3);
      expect(Math.abs(dot(norm, norm) - 1)).toBeLessThan(1e-3);
      expect(Math.abs(dot(dir, lat))).toBeLessThan(1e-3);
      expect(Math.abs(dot(dir, norm))).toBeLessThan(1e-3);
      expect(Math.abs(dot(lat, norm))).toBeLessThan(1e-3);
    }
  });

  it('heart path (not rail path) of an unbanked Straight matches pos exactly', () => {
    // With roll=0 throughout, pos is the heart line and the rail is
    // conceptually offset by −heart along norm (−Y). The integrator writes
    // pos = heart position, so pos.y should be constant for a horizontal
    // straight — no drift from accumulated orientation error.
    const { arrays } = integrateTrack(
      makeTrack('horizontal', [anchorAt([0, 10, 0]), straight(60)]),
    );
    for (let i = 0; i < arrays.length; i += 100) {
      expect(Math.abs((arrays.posY[i] ?? 0) - 10)).toBeLessThan(1e-4);
    }
  });

  it('Curved path is banking-independent in position (regression guard)', () => {
    // The previous Curved integrator rotated dir around the banked lateral,
    // which leaked pitch into yaw as banking ramped in. The fix rotates
    // around the horizontal lateral — so a pure-yaw Curved with a roll ramp
    // still lands at the same (X, Z) as the un-rolled version, and y
    // stays near the anchor height (small drift from the heart-body model).
    const a = integrateTrack(
      makeTrack('yaw-flat', [
        anchorAt([0, 10, 0]),
        curved({ length: 20, yawRate: Math.PI / 4 / 20 }),
      ]),
    );
    const b = integrateTrack(
      makeTrack('yaw-banked', [
        anchorAt([0, 10, 0]),
        curved({
          length: 20,
          yawRate: Math.PI / 4 / 20,
          rollFunc: linearRoll(20, 0, Math.PI / 4),
        }),
      ]),
    );
    const last = Math.min(a.arrays.length, b.arrays.length) - 1;
    // The banked run's body swings sideways on roll, so heart-path y and
    // velocity both drift slightly relative to unbanked — tolerances pick up
    // that perturbation without losing the regression catch: the pre-fix
    // integrator produced >1 m XZ drift on this same track.
    for (let i = 0; i < last; i += 100) {
      expect(Math.abs((a.arrays.posX[i] ?? 0) - (b.arrays.posX[i] ?? 0))).toBeLessThan(0.1);
      expect(Math.abs((a.arrays.posZ[i] ?? 0) - (b.arrays.posZ[i] ?? 0))).toBeLessThan(0.1);
      expect(Math.abs((a.arrays.posY[i] ?? 0) - (b.arrays.posY[i] ?? 0))).toBeLessThan(0.2);
    }
  });
});

function heartY(
  arrays: ReturnType<typeof integrateTrack>['arrays'],
  i: number,
): number {
  return (arrays.posY[i] ?? 0) - (arrays.normY[i] ?? 0) * 1.1 * HEART_ENERGY_FACTOR;
}

function energyOf(
  arrays: ReturnType<typeof integrateTrack>['arrays'],
  i: number,
): number {
  const vel = arrays.vel[i] ?? 0;
  return 0.5 * vel * vel + F_G * heartY(arrays, i);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0]! * b[0]!) + (a[1]! * b[1]!) + (a[2]! * b[2]!);
}
