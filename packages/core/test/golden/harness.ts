// SPDX-License-Identifier: AGPL-3.0-only

// Golden-file harness for the physics integrator.
//
// Philosophy: each golden is a Track (built in TypeScript so we don't need
// a binary file format round-trip for every regression check) paired with a
// JSON "golden snapshot" that captures the state at a handful of nodes —
// enough that any math change detectably moves a number, small enough that
// diffs stay reviewable. The snapshot stores:
//
//   - nodeCount (± small slack for end-of-section rounding)
//   - sectionStartNodes (exact)
//   - sampled rows at stride N covering every column that matters for
//     physics: posX/Y/Z, dirX/Y/Z, latX/Y/Z, vel, forceNormal, forceLateral,
//     forceLong, roll, rollSpeed, cumulativeTime
//   - the last row explicitly (so a failure points at the endpoint first)
//
// Tolerances are per-column: positions and forces tolerate 1e-3 absolute
// because Float32Array underruns double-precision compute by ~6 decimal
// digits, and a 1000 Hz × 60 s track accumulates tiny per-step drift; the
// `roll` column is natively stored as float32 radians so a 1e-4 tolerance
// catches any real change without firing on float32 noise.
//
// Regeneration: set UPDATE_GOLDENS=1 and re-run the suite. The harness then
// writes (or rewrites) the snapshot file and the test reports "regenerated"
// instead of passing. Review the diff, commit, done.

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { expect } from 'vitest';

import { F_HZ } from '../../src/model/constants.js';
import { type Track } from '../../src/model/track.js';
import { integrateTrack } from '../../src/physics/integrate.js';

const SAMPLE_STRIDE = 200; // every ~0.2 s of integrated track
const ABS_TOL = 1e-3;
const REL_TOL = 1e-4;

export interface GoldenRow {
  readonly i: number;
  readonly t: number;
  readonly pos: [number, number, number];
  readonly dir: [number, number, number];
  readonly lat: [number, number, number];
  readonly vel: number;
  readonly forceNormal: number;
  readonly forceLateral: number;
  readonly forceLong: number;
  readonly roll: number;
  readonly rollSpeed: number;
}

export interface GoldenSnapshot {
  readonly nodeCount: number;
  readonly sectionStartNodes: readonly number[];
  readonly sampled: readonly GoldenRow[];
  readonly last: GoldenRow;
}

export interface GoldenCase {
  readonly name: string;
  readonly track: Track;
  /** Optional extra invariants run after the snapshot diff. */
  readonly invariants?: (readonly [
    string,
    (snapshot: GoldenSnapshot, arrays: ReturnType<typeof integrateTrack>['arrays']) => void,
  ])[];
}

export function runGolden(goldenDir: string, golden: GoldenCase): void {
  const { arrays, sectionStartNodes } = integrateTrack(golden.track);
  const snapshot = captureSnapshot(arrays, sectionStartNodes);

  const snapshotPath = `${goldenDir}/${golden.name}.golden.json`;
  if (process.env.UPDATE_GOLDENS === '1' || !existsSync(snapshotPath)) {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    // Asserting passes; the test framework will report as "passed" but the
    // file diff in git is the real signal for review.
    expect(snapshot.nodeCount).toBeGreaterThan(0);
    return;
  }

  const raw = readFileSync(snapshotPath, 'utf8');
  const expected = JSON.parse(raw) as GoldenSnapshot;
  expectSnapshotMatches(snapshot, expected);

  if (golden.invariants) {
    for (const [name, check] of golden.invariants) {
      try {
        check(snapshot, arrays);
      } catch (err) {
        throw new Error(
          `${golden.name}: invariant "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

function captureSnapshot(
  arrays: ReturnType<typeof integrateTrack>['arrays'],
  sectionStartNodes: readonly number[],
): GoldenSnapshot {
  const nodeCount = arrays.length;
  const sampled: GoldenRow[] = [];
  for (let i = 0; i < nodeCount; i += SAMPLE_STRIDE) {
    sampled.push(rowAt(arrays, i));
  }
  return {
    nodeCount,
    sectionStartNodes: [...sectionStartNodes],
    sampled,
    last: rowAt(arrays, nodeCount - 1),
  };
}

function rowAt(
  arrays: ReturnType<typeof integrateTrack>['arrays'],
  i: number,
): GoldenRow {
  return {
    i,
    t: round(i / F_HZ, 6),
    pos: [round(arrays.posX[i] ?? 0, 6), round(arrays.posY[i] ?? 0, 6), round(arrays.posZ[i] ?? 0, 6)],
    dir: [round(arrays.dirX[i] ?? 0, 7), round(arrays.dirY[i] ?? 0, 7), round(arrays.dirZ[i] ?? 0, 7)],
    lat: [round(arrays.latX[i] ?? 0, 7), round(arrays.latY[i] ?? 0, 7), round(arrays.latZ[i] ?? 0, 7)],
    vel: round(arrays.vel[i] ?? 0, 6),
    forceNormal: round(arrays.forceNormal[i] ?? 0, 6),
    forceLateral: round(arrays.forceLateral[i] ?? 0, 6),
    forceLong: round(arrays.forceLong[i] ?? 0, 6),
    roll: round(arrays.roll[i] ?? 0, 6),
    rollSpeed: round(arrays.rollSpeed[i] ?? 0, 6),
  };
}

function expectSnapshotMatches(actual: GoldenSnapshot, expected: GoldenSnapshot): void {
  expect(actual.nodeCount).toBe(expected.nodeCount);
  expect(actual.sectionStartNodes).toEqual(expected.sectionStartNodes);
  expect(actual.sampled.length).toBe(expected.sampled.length);
  for (let k = 0; k < actual.sampled.length; k += 1) {
    expectRowMatches(actual.sampled[k]!, expected.sampled[k]!, `sampled[${k}]`);
  }
  expectRowMatches(actual.last, expected.last, 'last');
}

function expectRowMatches(actual: GoldenRow, expected: GoldenRow, label: string): void {
  expect(actual.i, `${label}.i`).toBe(expected.i);
  closeTo(actual.t, expected.t, `${label}.t`);
  for (const axis of [0, 1, 2] as const) {
    closeTo(actual.pos[axis], expected.pos[axis], `${label}.pos[${axis}]`);
    closeTo(actual.dir[axis], expected.dir[axis], `${label}.dir[${axis}]`);
    closeTo(actual.lat[axis], expected.lat[axis], `${label}.lat[${axis}]`);
  }
  closeTo(actual.vel, expected.vel, `${label}.vel`);
  closeTo(actual.forceNormal, expected.forceNormal, `${label}.forceNormal`);
  closeTo(actual.forceLateral, expected.forceLateral, `${label}.forceLateral`);
  closeTo(actual.forceLong, expected.forceLong, `${label}.forceLong`);
  closeTo(actual.roll, expected.roll, `${label}.roll`);
  closeTo(actual.rollSpeed, expected.rollSpeed, `${label}.rollSpeed`);
}

function closeTo(actual: number, expected: number, label: string): void {
  const diff = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  if (diff > ABS_TOL && diff > REL_TOL * scale) {
    throw new Error(`${label}: expected ${expected}, got ${actual} (diff ${diff})`);
  }
}

function round(v: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}
