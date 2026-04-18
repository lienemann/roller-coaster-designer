// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EDegree } from '../model/enums.js';
import { createLinearSubFunc } from '../model/subfunction.js';

import { getSubFuncValue, subFuncDerivativeAt } from './subfunc-eval.js';

describe('getSubFuncValue — Linear', () => {
  const linear = createLinearSubFunc({ length: 10, startValue: 0, endValue: 2 });

  it('returns startValue at x = 0', () => {
    expect(getSubFuncValue(linear, 0)).toBeCloseTo(0, 10);
  });

  it('returns endValue at x = length', () => {
    expect(getSubFuncValue(linear, 10)).toBeCloseTo(2, 10);
  });

  it('interpolates linearly at the midpoint', () => {
    expect(getSubFuncValue(linear, 5)).toBeCloseTo(1, 10);
  });

  it('clamps x below 0 to startValue and above length to endValue', () => {
    expect(getSubFuncValue(linear, -4)).toBeCloseTo(0, 10);
    expect(getSubFuncValue(linear, 999)).toBeCloseTo(2, 10);
  });

  it('has a constant derivative of (end - start) / length', () => {
    expect(subFuncDerivativeAt(linear, 3)).toBeCloseTo(0.2, 10);
  });
});

describe('getSubFuncValue — unimplemented degrees throw', () => {
  it('throws for Cubic until M3', () => {
    const cubic = {
      ...createLinearSubFunc({ length: 1, startValue: 0, endValue: 1 }),
      degree: EDegree.Cubic,
    };
    expect(() => getSubFuncValue(cubic, 0.5)).toThrow(/Cubic/);
  });
});
