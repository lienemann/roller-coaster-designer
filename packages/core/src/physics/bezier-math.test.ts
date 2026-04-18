// SPDX-License-Identifier: AGPL-3.0-only

import { vec3 } from 'gl-matrix';
import { describe, expect, it } from 'vitest';

import {
  arcLengthToParameter,
  cubicBezier,
  cubicBezierDerivative,
  sampleArcLengthTable,
} from './bezier-math.js';

describe('cubic Bezier', () => {
  const p0: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [1, 0, 0];
  const p2: [number, number, number] = [2, 0, 0];
  const p3: [number, number, number] = [3, 0, 0];

  it('evaluates the endpoints exactly', () => {
    const out = vec3.create();
    cubicBezier(out, 0, p0, p1, p2, p3);
    expect(Array.from(out)).toEqual([0, 0, 0]);
    cubicBezier(out, 1, p0, p1, p2, p3);
    expect(Array.from(out)).toEqual([3, 0, 0]);
  });

  it('collapses to the straight-line midpoint when the control points are collinear', () => {
    const out = vec3.create();
    cubicBezier(out, 0.5, p0, p1, p2, p3);
    expect(out[0]).toBeCloseTo(1.5, 10);
  });

  it('derivative points forward for the monotone curve', () => {
    const out = vec3.create();
    cubicBezierDerivative(out, 0.5, p0, p1, p2, p3);
    expect(out[0]).toBeGreaterThan(0);
  });
});

describe('arc-length parameterization', () => {
  const p0: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [3, 0, 0];
  const p2: [number, number, number] = [6, 0, 0];
  const p3: [number, number, number] = [9, 0, 0];

  it('total length of a straight-line Bezier equals the endpoint distance', () => {
    const table = sampleArcLengthTable(p0, p1, p2, p3, 64);
    expect(table[table.length - 1]).toBeCloseTo(9, 6);
  });

  it('inverts arc length monotonically', () => {
    const table = sampleArcLengthTable(p0, p1, p2, p3, 64);
    const total = table[table.length - 1]!;
    const quarter = arcLengthToParameter(table, total * 0.25);
    const half = arcLengthToParameter(table, total * 0.5);
    const threeQuarters = arcLengthToParameter(table, total * 0.75);
    expect(quarter).toBeLessThan(half);
    expect(half).toBeLessThan(threeQuarters);
    expect(half).toBeCloseTo(0.5, 2);
  });
});
