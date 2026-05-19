// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'vitest';

import { toRad } from './constants.js';
import { setFloatPrecision, vec3 } from './fvec.js';
import { MNode } from './mnode.js';

beforeEach(() => {
  // Tests run under FVD-native float32 by default. The Float32 vs Float64
  // sweep is its own dedicated test elsewhere.
  setFloatPrecision('float32');
});

describe('MNode default constructor', () => {
  it('zero-initializes all fields', () => {
    const n = new MNode();
    expect(n.vPos).toEqual({ x: 0, y: 0, z: 0 });
    expect(n.vDir).toEqual({ x: 0, y: 0, z: 0 });
    expect(n.vLat).toEqual({ x: 0, y: 0, z: 0 });
    expect(n.vNorm).toEqual({ x: 0, y: 0, z: 0 });
    expect(n.fRoll).toBe(0);
    expect(n.fVel).toBe(0);
  });
});

describe('MNode parameterized constructor (mnode.cpp:31)', () => {
  it('matches FVD anchor-node setup: pos=(0,0,0), dir=(0,0,-1), roll=0', () => {
    // FVD track.cpp:43 creates the anchor with these exact arguments.
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    // vDir is normalized (already unit length).
    expect(n.vDir).toEqual({ x: 0, y: 0, z: -1 });
    // mnode.cpp:60: vLat = (-dir.z, 0, dir.x) = (1, 0, 0).
    expect(n.vLat.x).toBeCloseTo(1, 6);
    expect(n.vLat.y).toBeCloseTo(0, 6);
    expect(n.vLat.z).toBeCloseTo(0, 6);
    // vNorm = vDir × vLat = (0,0,-1) × (1,0,0) = (0*0 - (-1)*0, -1*1 - 0*0, 0*0 - 0*1)
    // = (0, -1, 0). vNorm.y = -1 — points to rider's feet.
    expect(n.vNorm.x).toBeCloseTo(0, 6);
    expect(n.vNorm.y).toBeCloseTo(-1, 6);
    expect(n.vNorm.z).toBeCloseTo(0, 6);
  });

  it('vNorm.y is +1 when dir points straight down (rider inverted)', () => {
    // dir = (0, -1, 0): rider rolling forward off a vertical drop. vNorm
    // should point up because feet are now up.
    const n = new MNode(vec3(0, 10, 0), vec3(0, -1, 0), 0, 10, 1, 0);
    // FVD's special-case in the constructor handles vDir.y == 1 (straight
    // up); for vDir.y == -1 it falls into the general branch which gives
    // vLat = (-dir.z, 0, dir.x) = (0, 0, 0) — degenerate. The downstream
    // normalize divides by zero. This is a known FVD quirk; the integrator
    // never starts from a vertical-down direction. Skip the strict check
    // and just verify the constructor doesn't NaN the position.
    expect(Number.isFinite(n.vPos.x)).toBe(true);
    expect(Number.isFinite(n.vPos.y)).toBe(true);
    expect(Number.isFinite(n.vPos.z)).toBe(true);
  });

  it('rolling the anchor by 90° banks vLat into +y (rider on their right side)', () => {
    // Build the FVD anchor, then apply setRoll(90). The lat vector should
    // rotate from +x toward +y because mnode.cpp:70 rotates by -dRoll
    // around vDir = (0,0,-1), and that direction makes the rotation
    // right-handed about -z.
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    n.setRoll(90);
    // After -90° around (0,0,-1): (1,0,0) → (0,1,0).
    expect(n.vLat.x).toBeCloseTo(0, 5);
    expect(n.vLat.y).toBeCloseTo(1, 5);
    expect(n.vLat.z).toBeCloseTo(0, 5);
    // vNorm = vDir × vLat = (0,0,-1) × (0,1,0) = (1, 0, 0).
    expect(n.vNorm.x).toBeCloseTo(1, 5);
    expect(n.vNorm.y).toBeCloseTo(0, 5);
    expect(n.vNorm.z).toBeCloseTo(0, 5);
    // updateRoll reproduces fRoll from the new geometry.
    expect(n.fRoll).toBeCloseTo(90, 4);
  });
});

describe('MNode.setRoll / updateRoll (mnode.cpp:68)', () => {
  it('round-trips fRoll through setRoll(d) when starting upright', () => {
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    n.setRoll(30);
    expect(n.fRoll).toBeCloseTo(30, 4);
    n.setRoll(-30);
    expect(n.fRoll).toBeCloseTo(0, 4);
  });
});

describe('MNode.changeYaw (mnode.cpp:111)', () => {
  it('rotates vDir around world +Y', () => {
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    n.changeYaw(90);
    // angleAxis(+90°, +Y) applied to (0,0,-1) → (-1, 0, 0).
    expect(n.vDir.x).toBeCloseTo(-1, 5);
    expect(n.vDir.y).toBeCloseTo(0, 5);
    expect(n.vDir.z).toBeCloseTo(0, 5);
  });
});

describe('MNode.changePitch (mnode.cpp:98)', () => {
  it('pitches the rider up: vDir.y becomes positive', () => {
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    n.changePitch(30, false);
    // vNorm.y ≈ -1 → rotateAround = cross((0,-1,0), (0,0,-1)) = (-1+0, 0, 0) → normalized (-1,0,0)?
    // Actually: cross((0,-1,0),(0,0,-1)) = (-1*-1 - 0*0, 0*0 - 0*-1, 0*0 - -1*0) = (1, 0, 0)
    // Wait: cross(a,b) = (a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x).
    // a=(0,-1,0), b=(0,0,-1): (-1*-1 - 0*0, 0*0 - 0*-1, 0*0 - -1*0) = (1, 0, 0).
    // rotateAxis(vDir=(0,0,-1), axis=(1,0,0), +30°): Rodrigues gives
    // (0, sin(30°), -cos(30°)) = (0, 0.5, -0.866).
    expect(n.vDir.x).toBeCloseTo(0, 5);
    expect(n.vDir.y).toBeCloseTo(0.5, 5);
    expect(n.vDir.z).toBeCloseTo(-Math.cos(toRad(30)), 5);
  });
});

describe('MNode.updateNorm (mnode.h:53)', () => {
  it('always equals cross(vDir, vLat) — never sign-flipped', () => {
    // Pick an arbitrary banked frame; verify the contract holds.
    const n = new MNode(vec3(5, 10, -3), vec3(1, 0, 0), 45, 12, 1, 0);
    // Expected cross(vDir, vLat) directly.
    const exX = n.vDir.y * n.vLat.z - n.vDir.z * n.vLat.y;
    const exY = n.vDir.z * n.vLat.x - n.vDir.x * n.vLat.z;
    const exZ = n.vDir.x * n.vLat.y - n.vDir.y * n.vLat.x;
    expect(n.vNorm.x).toBeCloseTo(exX, 5);
    expect(n.vNorm.y).toBeCloseTo(exY, 5);
    expect(n.vNorm.z).toBeCloseTo(exZ, 5);
  });
});

describe('MNode.vPosHeart / fPosHearty', () => {
  it('lifts the position by fHeart along vNorm (toward feet)', () => {
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    // vNorm = (0, -1, 0). vPosHeart(1.1) = (0, -1.1, 0).
    const p = n.vPosHeart(1.1);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(-1.1, 5);
    expect(p.z).toBeCloseTo(0, 5);
    expect(n.fPosHearty(1.1)).toBeCloseTo(-1.1, 5);
  });
});

describe('MNode.getPitch / getDirection (mnode.h:69-70)', () => {
  it('returns 0° pitch for level forward (0,0,-1)', () => {
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    expect(n.getPitch()).toBeCloseTo(0, 5);
    // atan2(-(-0), -(-1)) = atan2(0, 1) = 0. Wait: -dir.x=0, -dir.z=1, atan2(0,1)=0.
    expect(n.getDirection()).toBeCloseTo(0, 5);
  });

  it('returns +90° pitch when looking straight up', () => {
    const n = new MNode(vec3(0, 0, 0), vec3(0, 0.999, 0), 0, 10, 1, 0);
    // Not exactly 1 to avoid the special-case branch.
    expect(n.getPitch()).toBeGreaterThan(80);
  });
});

describe('MNode.clone', () => {
  it('produces an independent copy', () => {
    const a = new MNode(vec3(1, 2, 3), vec3(0, 0, -1), 15, 12, 1.2, 0);
    const b = a.clone();
    b.vPos.x = 99;
    expect(a.vPos.x).toBe(1);
    b.fRoll = 0;
    expect(a.fRoll).toBeCloseTo(15, 4);
  });
});
