// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';

import {
  vec3,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3RotateAxis,
  vec3Sub,
  vec3UnsignedAngle,
  setFloatPrecision,
  getFloatPrecision,
} from './fvec.js';

describe('vec3 ops', () => {
  it('cross matches the right-hand rule for canonical basis vectors', () => {
    const x = vec3(1, 0, 0);
    const y = vec3(0, 1, 0);
    const z = vec3Cross(x, y);
    expect(z.x).toBeCloseTo(0, 6);
    expect(z.y).toBeCloseTo(0, 6);
    expect(z.z).toBeCloseTo(1, 6);
  });

  it('dot equals component-wise product sum', () => {
    expect(vec3Dot(vec3(1, 2, 3), vec3(4, -5, 6))).toBeCloseTo(4 - 10 + 18, 5);
  });

  it('add / sub are vector ops', () => {
    const s = vec3Add(vec3(1, 2, 3), vec3(10, 20, 30));
    expect(s).toMatchObject({ x: 11, y: 22, z: 33 });
    const d = vec3Sub(vec3(10, 20, 30), vec3(1, 2, 3));
    expect(d).toMatchObject({ x: 9, y: 18, z: 27 });
  });

  it('length / normalize behave', () => {
    const v = vec3(3, 0, 4);
    expect(vec3Length(v)).toBeCloseTo(5, 5);
    const n = vec3Normalize(v);
    expect(vec3Length(n)).toBeCloseTo(1, 5);
  });
});

describe('vec3RotateAxis (Rodrigues)', () => {
  it('rotates +X by 90° around +Z to +Y', () => {
    const out = vec3RotateAxis(vec3(1, 0, 0), vec3(0, 0, 1), Math.PI / 2);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('matches FVD setRoll convention: rotate (1,0,0) by -90° around (0,0,-1) gives (0,1,0)', () => {
    // mnode.cpp:70: vLat = angleAxis(-dRoll, vDir) * vLat.
    // With vDir=(0,0,-1) and dRoll=90, the angle is -90° about -Z, which
    // is equivalent to +90° about +Z, sending (1,0,0)→(0,1,0).
    const out = vec3RotateAxis(vec3(1, 0, 0), vec3(0, 0, -1), -Math.PI / 2);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('rotates in place when out === input', () => {
    const v = vec3(1, 0, 0);
    vec3RotateAxis(v, vec3(0, 0, 1), Math.PI / 2, v);
    expect(v.y).toBeCloseTo(1, 5);
  });
});

describe('vec3UnsignedAngle', () => {
  it('returns 0 for identical vectors and π for opposites', () => {
    expect(vec3UnsignedAngle(vec3(1, 2, 3), vec3(1, 2, 3))).toBeCloseTo(0, 5);
    expect(vec3UnsignedAngle(vec3(1, 0, 0), vec3(-1, 0, 0))).toBeCloseTo(Math.PI, 5);
  });
});

describe('precision toggle', () => {
  it('round-trips a float32-representable value identically in both modes', () => {
    setFloatPrecision('float32');
    expect(vec3(0.5, 0.25, 0.125)).toEqual({ x: 0.5, y: 0.25, z: 0.125 });
    setFloatPrecision('float64');
    expect(vec3(0.5, 0.25, 0.125)).toEqual({ x: 0.5, y: 0.25, z: 0.125 });
  });

  it('rounds a non-representable value under float32 but not under float64', () => {
    setFloatPrecision('float32');
    const a = vec3(0.1, 0, 0);
    expect(a.x).toBe(Math.fround(0.1));
    expect(a.x).not.toBe(0.1);
    setFloatPrecision('float64');
    const b = vec3(0.1, 0, 0);
    expect(b.x).toBe(0.1);
  });

  it('getFloatPrecision reflects the current mode', () => {
    setFloatPrecision('float64');
    expect(getFloatPrecision()).toBe('float64');
    setFloatPrecision('float32');
    expect(getFloatPrecision()).toBe('float32');
  });
});
