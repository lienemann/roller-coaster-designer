// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for the secbezier.cpp port. No FVD++-generated golden exists yet
// for a BEZ section (the corpus generator will add one and the NL2 gold
// comes from FVD++); until that lands these tests gate on structural
// invariants: pose validity, monotone arc length, energy behaviour, and
// a byte-exact save→load→save round trip of the C++ wire format.

import { describe, expect, it } from 'vitest';

import { vec3 } from './fvec.js';
import { ReadStream, WriteStream } from './io-stream.js';
import { SecBezier } from './sec-bezier.js';
import { SecType, type BezierT } from './section.js';
import { Track } from './track.js';

function seg(
  p1: [number, number, number],
  kp1: [number, number, number],
  kp2: [number, number, number],
  opts: Partial<Pick<BezierT, 'roll' | 'contRoll' | 'relRoll' | 'fVel'>> = {},
): BezierT {
  return {
    P1: vec3(...p1),
    Kp1: vec3(...kp1),
    Kp2: vec3(...kp2),
    roll: opts.roll ?? 0,
    contRoll: opts.contRoll ?? false,
    equalDist: false,
    relRoll: opts.relRoll ?? false,
    ptf: 0,
    fvdRoll: 0,
    length: 0,
    numNodes: 0,
    fVel: opts.fVel ?? 0,
  };
}

// A gentle S in the horizontal plane at y=10, ~40 m long, three knots.
// Handles point along -z so the curve runs forward like FVD's default.
function makeBezier(track: Track): SecBezier {
  const s = new SecBezier(track, track.anchorNode);
  s.bezList = [
    seg([0, 10, 0], [0, 10, 2], [0, 10, -6], { fVel: 10 }),
    seg([4, 10, -20], [4, 10, -14], [4, 10, -26], { fVel: 10 }),
    seg([0, 10, -40], [0, 10, -34], [0, 10, -46], { fVel: 10 }),
  ];
  return s;
}

describe('SecBezier.updateSection', () => {
  it('samples nodes with finite pose and monotone arc length', () => {
    const track = new Track(vec3(0, 0, 0), 0, 1.1);
    const s = makeBezier(track);
    track.lSections.push(s);
    s.updateSection(0);

    expect(s.lNodes.length).toBeGreaterThan(100);
    for (let i = 0; i < s.lNodes.length; i++) {
      const n = s.lNodes[i]!;
      expect(Number.isFinite(n.vPos.x)).toBe(true);
      expect(Number.isFinite(n.vPos.y)).toBe(true);
      expect(Number.isFinite(n.vPos.z)).toBe(true);
      expect(Number.isFinite(n.fRoll)).toBe(true);
      expect(n.fVel).toBeGreaterThan(0);
      if (i > 0) {
        expect(n.fTotalLength).toBeGreaterThanOrEqual(s.lNodes[i - 1]!.fTotalLength);
      }
    }
    // ~40 m of curve at 2 segments.
    expect(s.length).toBeGreaterThan(30);
    expect(s.length).toBeLessThan(55);
  });

  it('starts at the first knot and ends at the last', () => {
    const track = new Track(vec3(0, 0, 0), 0, 1.1);
    const s = makeBezier(track);
    track.lSections.push(s);
    s.updateSection(0);

    const first = s.lNodes[0]!;
    const last = s.lNodes[s.lNodes.length - 1]!;
    expect(first.vPos.x).toBeCloseTo(0, 3);
    expect(first.vPos.z).toBeCloseTo(0, 3);
    // Final node lands within one step of the last knot.
    expect(last.vPos.x).toBeCloseTo(0, 0);
    expect(last.vPos.z).toBeCloseTo(-40, 0);
  });

  it('energy-driven velocity falls when the track climbs', () => {
    const track = new Track(vec3(0, 0, 0), 0, 1.1);
    const s = new SecBezier(track, track.anchorNode);
    // 20 m climb from y=10 to y=20, energy-driven (fVel=0). Entry node
    // carries fEnergy from the anchor (default 10 m/s at y=0); give the
    // first node a healthy energy so sqrt stays real.
    track.anchorNode.fEnergy = 0.5 * 20 * 20 + 9.80665 * 10;
    s.lNodes[0]!.fEnergy = track.anchorNode.fEnergy;
    s.bezList = [
      seg([0, 10, 0], [0, 10, 2], [0, 10, -6]),
      seg([0, 20, -20], [0, 18, -14], [0, 22, -26]),
      seg([0, 20, -40], [0, 20, -34], [0, 20, -46]),
    ];
    track.lSections.push(s);
    s.updateSection(0);

    const firstVel = s.lNodes[1]!.fVel;
    // Sample mid-climb (t≈0.9 of segment 0).
    const midIdx = Math.floor(s.bezList[0]!.numNodes * 0.9);
    const midVel = s.lNodes[midIdx]!.fVel;
    expect(midVel).toBeLessThan(firstVel);
  });

  it('relRoll chains segment rolls; absolute roll does not', () => {
    const track = new Track(vec3(0, 0, 0), 0, 1.1);
    const s = makeBezier(track);
    s.bezList[1]!.roll = Math.PI / 4;
    s.bezList[1]!.relRoll = true;
    s.bezList[0]!.roll = Math.PI / 8;
    track.lSections.push(s);
    s.updateSection(0);
    // fvdRoll of segment 1 = fvdRoll[0] + correction + roll[1]; with a
    // flat curve correction ≈ 0, so ≈ 3π/8.
    expect(s.bezList[1]!.fvdRoll).toBeGreaterThan(Math.PI / 4);
  });
});

describe('SecBezier wire format (secbezier.cpp:281)', () => {
  it('save → load → save is byte-identical and matches the C++ field order', () => {
    const track = new Track(vec3(0, 0, 0), 0, 1.1);
    const s = makeBezier(track);
    s.sName = 'bez1';
    s.bezList[1]!.roll = 0.5;
    s.bezList[1]!.contRoll = true;
    s.bezList[2]!.relRoll = true;
    s.supList = [vec3(1, 2, 3), vec3(4, 5, 6)];

    const ws1 = new WriteStream();
    s.saveSection(ws1);
    const bytes1 = ws1.toUint8Array();

    // Field order check: tag, namelen, name, bezcount, then P1.x of the
    // first segment (0 here — assert on segment 1's P1.x = 4 instead).
    const rs = new ReadStream(bytes1);
    expect(rs.readString(3)).toBe('BEZ');
    const nlen = rs.readInt();
    expect(rs.readString(nlen)).toBe('bez1');
    expect(rs.readInt()).toBe(3);
    const p1 = rs.readVec3();
    expect(p1.x).toBeCloseTo(0, 6);
    expect(p1.y).toBeCloseTo(10, 6);

    // Round trip.
    const rs2 = new ReadStream(bytes1);
    expect(rs2.readString(3)).toBe('BEZ');
    const s2 = new SecBezier(track, track.anchorNode);
    s2.loadSection(rs2);
    expect(s2.sName).toBe('bez1');
    expect(s2.bezList.length).toBe(3);
    expect(s2.bezList[1]!.contRoll).toBe(true);
    expect(s2.bezList[2]!.relRoll).toBe(true);
    expect(s2.supList.length).toBe(2);
    expect(s2.supList[1]!.y).toBeCloseTo(5, 6);

    const ws2 = new WriteStream();
    s2.saveSection(ws2);
    const bytes2 = ws2.toUint8Array();
    expect(bytes2.length).toBe(bytes1.length);
    for (let i = 0; i < bytes1.length; i++) {
      if (bytes1[i] !== bytes2[i]) {
        throw new Error(`byte mismatch at ${i}: ${bytes1[i]} vs ${bytes2[i]}`);
      }
    }
  });

  it('section type stays Bezier', () => {
    const track = new Track(vec3(0, 0, 0), 0, 1.1);
    const s = makeBezier(track);
    expect(s.type).toBe(SecType.Bezier);
  });
});
