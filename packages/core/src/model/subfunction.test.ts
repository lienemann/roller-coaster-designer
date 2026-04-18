// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EDegree } from './enums.js';
import { createFreeformSubFunc, createLinearSubFunc, type SubFunc } from './subfunction.js';

describe('SubFunc factories', () => {
  it('createLinearSubFunc fills every scalar field and leaves pointList off', () => {
    const sf = createLinearSubFunc({ length: 4, startValue: 0, endValue: 1 });
    expect(sf.degree).toBe(EDegree.Linear);
    expect(sf.length).toBe(4);
    expect(sf.startValue).toBe(0);
    expect(sf.endValue).toBe(1);
    expect(sf.arg1).toBe(0);
    expect(sf.centerArg).toBe(0);
    expect(sf.tensionArg).toBe(0);
    expect(sf.pointList).toBeUndefined();
  });

  it('createFreeformSubFunc carries the two control points', () => {
    const sf: SubFunc = createFreeformSubFunc({
      length: 2,
      startValue: -0.5,
      endValue: 0.5,
      control0: [0.33, -0.2],
      control1: [0.66, 0.3],
    });
    expect(sf.degree).toBe(EDegree.Freeform);
    expect(sf.pointList).toEqual([
      [0.33, -0.2],
      [0.66, 0.3],
    ]);
  });
});
