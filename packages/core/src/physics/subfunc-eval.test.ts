// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EDegree } from '../model/enums.js';
import { createFreeformSubFunc, createLinearSubFunc } from '../model/subfunction.js';

import { getSubFuncValue, subFuncDerivativeAt } from './subfunc-eval.js';

function shape(degree: EDegree, arg1 = 0) {
  return { ...createLinearSubFunc({ length: 1, startValue: 0, endValue: 1 }), degree, arg1 };
}

describe('getSubFuncValue — endpoints', () => {
  const degrees = [
    EDegree.Linear,
    EDegree.Quadratic,
    EDegree.Cubic,
    EDegree.Quartic,
    EDegree.Quintic,
    EDegree.Sinusoidal,
    EDegree.ToZero,
  ];
  for (const degree of degrees) {
    it(`${EDegree[degree]} returns startValue at t=0 and endValue at t=1`, () => {
      const sf = shape(degree);
      expect(getSubFuncValue(sf, 0)).toBeCloseTo(0, 10);
      expect(getSubFuncValue(sf, 1)).toBeCloseTo(1, 10);
    });
  }
});

describe('getSubFuncValue — midpoints', () => {
  it('Linear midpoint = 0.5', () => {
    expect(getSubFuncValue(shape(EDegree.Linear), 0.5)).toBeCloseTo(0.5, 10);
  });

  it('Cubic midpoint = 0.5 (smoothstep is symmetric)', () => {
    expect(getSubFuncValue(shape(EDegree.Cubic), 0.5)).toBeCloseTo(0.5, 10);
  });

  it('Quintic midpoint = 0.5 (smootherstep is symmetric)', () => {
    expect(getSubFuncValue(shape(EDegree.Quintic), 0.5)).toBeCloseTo(0.5, 10);
  });

  it('Sinusoidal midpoint = 0.5', () => {
    expect(getSubFuncValue(shape(EDegree.Sinusoidal), 0.5)).toBeCloseTo(0.5, 10);
  });

  it('Quartic is monotonic between its endpoints', () => {
    // No real quartic simultaneously lands at midpoint 0.5 *and* zeros both
    // endpoint derivatives — that over-constrains degree 4 to a cubic. FVD++'s
    // quartic is asymmetric on purpose; assert monotonicity instead.
    const sf = shape(EDegree.Quartic);
    let prev = getSubFuncValue(sf, 0);
    for (let step = 1; step <= 20; step += 1) {
      const v = getSubFuncValue(sf, step / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('getSubFuncValue — Plateau', () => {
  it('arg1=0.5 holds a flat 0.5 in the middle third', () => {
    const sf = shape(EDegree.Plateau, 0.5);
    expect(getSubFuncValue(sf, 0.4)).toBeCloseTo(0.5, 6);
    expect(getSubFuncValue(sf, 0.5)).toBeCloseTo(0.5, 6);
    expect(getSubFuncValue(sf, 0.6)).toBeCloseTo(0.5, 6);
  });

  it('hits the endpoints regardless of plateau width', () => {
    const sf = shape(EDegree.Plateau, 0.8);
    expect(getSubFuncValue(sf, 0)).toBeCloseTo(0, 10);
    expect(getSubFuncValue(sf, 1)).toBeCloseTo(1, 10);
  });
});

describe('getSubFuncValue — ToZero', () => {
  it('starts at startValue and reaches endValue', () => {
    const sf = { ...shape(EDegree.ToZero), startValue: 1.5, endValue: 0 };
    expect(getSubFuncValue(sf, 0)).toBeCloseTo(1.5, 10);
    expect(getSubFuncValue(sf, 1)).toBeCloseTo(0, 10);
  });

  it('has zero derivative at the ends', () => {
    const sf = { ...shape(EDegree.ToZero), startValue: 1, endValue: 0 };
    expect(subFuncDerivativeAt(sf, 0)).toBeCloseTo(0, 6);
    expect(subFuncDerivativeAt(sf, 1)).toBeCloseTo(0, 6);
  });
});

describe('getSubFuncValue — Freeform', () => {
  it('passes through both control-point-implied endpoints', () => {
    const sf = createFreeformSubFunc({
      length: 1,
      startValue: 0,
      endValue: 1,
      control0: [0.33, 0.0],
      control1: [0.66, 1.0],
    });
    expect(getSubFuncValue(sf, 0)).toBeCloseTo(0, 10);
    expect(getSubFuncValue(sf, 1)).toBeCloseTo(1, 10);
  });

  it('a linear-equivalent control setup matches linear', () => {
    // control points on the diagonal → identity cubic Bezier → linear output.
    const sf = createFreeformSubFunc({
      length: 1,
      startValue: 0,
      endValue: 1,
      control0: [1 / 3, 1 / 3],
      control1: [2 / 3, 2 / 3],
    });
    expect(getSubFuncValue(sf, 0.25)).toBeCloseTo(0.25, 4);
    expect(getSubFuncValue(sf, 0.5)).toBeCloseTo(0.5, 4);
    expect(getSubFuncValue(sf, 0.75)).toBeCloseTo(0.75, 4);
  });
});

describe('subFuncDerivativeAt — sanity', () => {
  it('Linear is constant and equals (end - start) / length', () => {
    const sf = createLinearSubFunc({ length: 5, startValue: 0, endValue: 10 });
    expect(subFuncDerivativeAt(sf, 0)).toBeCloseTo(2, 10);
    expect(subFuncDerivativeAt(sf, 3)).toBeCloseTo(2, 10);
  });

  it('Cubic has zero derivative at both endpoints', () => {
    const sf = shape(EDegree.Cubic);
    expect(subFuncDerivativeAt(sf, 0)).toBeCloseTo(0, 10);
    expect(subFuncDerivativeAt(sf, 1)).toBeCloseTo(0, 10);
  });

  it('Quintic has zero first derivative at both endpoints', () => {
    const sf = shape(EDegree.Quintic);
    expect(subFuncDerivativeAt(sf, 0)).toBeCloseTo(0, 10);
    expect(subFuncDerivativeAt(sf, 1)).toBeCloseTo(0, 10);
  });
});
