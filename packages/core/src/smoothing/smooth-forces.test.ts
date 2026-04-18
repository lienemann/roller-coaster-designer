// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { allocateMNodeArrays } from '../model/mnode.js';
import { type Smoother } from '../model/track.js';

import { applySmoothers } from './smooth-forces.js';

function fakeArrays(count: number, normal: number[], lateral: number[]) {
  const arrays = allocateMNodeArrays(Math.max(count, normal.length));
  arrays.length = count;
  for (let i = 0; i < count; i += 1) {
    arrays.forceNormal[i] = normal[i] ?? 0;
    arrays.forceLateral[i] = lateral[i] ?? 0;
  }
  return arrays;
}

describe('applySmoothers', () => {
  it('no smoothers → smoothed columns equal raw columns', () => {
    const arrays = fakeArrays(
      500,
      Array.from({ length: 500 }, (_, i) => (i < 250 ? 1 : 2)),
      Array.from({ length: 500 }, () => 0),
    );
    applySmoothers(arrays, [], [0, 250]);
    for (let i = 0; i < 500; i += 1) {
      expect(arrays.smoothNormal[i]).toBeCloseTo(arrays.forceNormal[i]!, 6);
    }
  });

  it('one smoother softens a step at the configured boundary', () => {
    // 1000-node track with a step from 1g to 2g at node 500.
    const n = 1000;
    const normal: number[] = Array.from({ length: n }, (_, i) => (i < 500 ? 1 : 2));
    const arrays = fakeArrays(n, normal, new Array<number>(n).fill(0));
    const smoothers: Smoother[] = [{ fromSection: 0, toSection: 1, strength: 1 }];
    applySmoothers(arrays, smoothers, [0, 500]);

    // Away from the boundary, smoothed == raw.
    expect(arrays.smoothNormal[100]).toBeCloseTo(1, 3);
    expect(arrays.smoothNormal[900]).toBeCloseTo(2, 3);

    // At the boundary, smoothed sits between the two levels (Gaussian blur).
    const mid = arrays.smoothNormal[500]!;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
    expect(mid).toBeCloseTo(1.5, 1);
  });

  it('strength 0 leaves the raw signal untouched', () => {
    const n = 200;
    const normal: number[] = Array.from({ length: n }, (_, i) => (i < 100 ? 1 : 3));
    const arrays = fakeArrays(n, normal, new Array<number>(n).fill(0));
    applySmoothers(arrays, [{ fromSection: 0, toSection: 1, strength: 0 }], [0, 100]);
    for (let i = 0; i < n; i += 1) {
      expect(arrays.smoothNormal[i]).toBeCloseTo(arrays.forceNormal[i]!, 6);
    }
  });
});
