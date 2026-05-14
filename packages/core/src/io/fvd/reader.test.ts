// SPDX-License-Identifier: AGPL-3.0-only

// Reader tests against hand-crafted Uint8Array fixtures. We don't have a
// real FVD++ binary in the repo (yet), so each test composes the exact
// bytes the C++ writer would emit, runs them through `parseFvd`, and
// asserts the resulting Project/Track/Section is what we expect.
//
// The `FvdWriter` here is a *minimal* test-only helper — not a public
// writer. Its job is to make fixture construction readable.

import { describe, expect, it } from 'vitest';

import { WebFvdError } from '../../errors.js';
import { Argument, EDegree, Orientation, SecType } from '../../model/enums.js';

import { parseFvd } from './reader.js';

class FvdWriter {
  private bytes: number[] = [];

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  ascii(s: string): this {
    for (const ch of s) {
      this.bytes.push(ch.charCodeAt(0));
    }
    return this;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  /** Big-endian 4-byte int matching FVD++'s wire format. */
  i32(value: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, value, false);
    this.bytes.push(...b);
    return this;
  }

  /** Big-endian 4-byte float matching FVD++'s wire format. */
  f32(value: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, value, false);
    this.bytes.push(...b);
    return this;
  }

  /** Length-prefixed UTF-8 string. */
  lstr(value: string): this {
    const enc = new TextEncoder().encode(value);
    this.i32(enc.length);
    this.bytes.push(...enc);
    return this;
  }

  /** Three back-to-back BE f32s in (x, y, z) order. Used for section.cpp
   *  call sites. */
  vec3(x: number, y: number, z: number): this {
    return this.f32(x).f32(y).f32(z);
  }

  /** "Whole-blob reversed" vec3: stored as z, y, x on disk with each
   *  component in BE. Mirrors `writeBytes(ptr, 12)`. */
  reversedVec3(x: number, y: number, z: number): this {
    return this.f32(z).f32(y).f32(x);
  }

  /** Fill `n` zero bytes. Used for the QColor blob and any other
   *  "opaque" region. */
  zeros(n: number): this {
    for (let i = 0; i < n; i += 1) this.bytes.push(0);
    return this;
  }

  /** Empty-Func: 4-byte "FUNC" tag + 0 subfuncs. */
  emptyFunc(): this {
    return this.ascii('FUNC').i32(0);
  }

  /** Linear subfunc record (33 bytes). */
  linearSubFunc(min: number, max: number, startValue: number, endValue: number): this {
    return this.i32(EDegree.Linear)
      .f32(min)
      .f32(max)
      .f32(startValue)
      .f32(0) // arg1
      .f32(endValue - startValue) // symArg
      .f32(0) // centerArg
      .f32(0) // tensionArg
      .u8(0); // locked
  }

  /** Track header up to and including sectionCount. */
  trackHeader(options: {
    name: string;
    startPos: [number, number, number];
    rollDeg: number;
    pitchDeg: number;
    yawDeg: number;
    velocity: number;
    heart: number;
    friction: number;
    resistance: number;
    sectionCount: number;
  }): this {
    return this.ascii('TRC')
      .lstr(options.name)
      .zeros(48) // QColor blob
      .reversedVec3(options.startPos[0], options.startPos[1], options.startPos[2])
      .f32(options.rollDeg)
      .f32(options.pitchDeg)
      .f32(options.yawDeg)
      .f32(options.velocity)
      .f32(1) // forceNormal — ignored
      .f32(0) // forceLateral — ignored
      .f32(options.heart)
      .f32(options.friction)
      .f32(options.resistance)
      .u8(1) // drawTrack
      .i32(0) // drawHeartline
      .i32(0) // style = generic
      .u8(0) // isWireframe
      .f32(0) // povPos.x
      .f32(0) // povPos.y
      .i32(options.sectionCount);
  }

  /** Track footer: smoother count = 0, "EOT". */
  trackFooter(): this {
    return this.i32(0).ascii('EOT');
  }

  /** Project preamble: "FVD" + version + texturePath. */
  projectHeader(version: 'v0.77' | 'v0.30' = 'v0.77', texturePath = ''): this {
    return this.ascii('FVD').ascii(version).lstr(texturePath);
  }

  projectFooter(): this {
    return this.ascii('EOP');
  }
}

describe('parseFvd — header validation', () => {
  it('throws on missing magic', () => {
    const bytes = new FvdWriter().ascii('XXX').toUint8Array();
    expect(() => parseFvd(bytes)).toThrow(WebFvdError);
  });

  it('throws on unsupported version', () => {
    const bytes = new FvdWriter().ascii('FVD').ascii('v9.99').lstr('').toUint8Array();
    try {
      parseFvd(bytes);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.versionUnsupported');
    }
  });

  it('parses an empty project (no tracks)', () => {
    const bytes = new FvdWriter().projectHeader().projectFooter().toUint8Array();
    const result = parseFvd(bytes);
    expect(result.version).toBe('v0.77');
    expect(result.project.tracks).toHaveLength(0);
    expect(result.project.texturePath).toBe('');
  });
});

describe('parseFvd — minimal track', () => {
  it('parses a track with anchor + Straight + roll func', () => {
    const w = new FvdWriter()
      .projectHeader()
      .trackHeader({
        name: 'Test track',
        startPos: [10, 20, 30],
        rollDeg: 0,
        pitchDeg: 0,
        yawDeg: 0,
        velocity: 12.5,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sectionCount: 1,
      })
      // Straight section
      .ascii('STR')
      .u8(0) // bSpeed
      .lstr('Straight 1')
      .f32(15) // fVel
      .f32(40) // fHLength
      .ascii('FUNC')
      .i32(1)
      .linearSubFunc(0, 40, 0, 0)
      // smoother count + EOT + EOP
      .trackFooter()
      .projectFooter();

    const result = parseFvd(w.toUint8Array());
    expect(result.warnings).toEqual([]);
    expect(result.project.tracks).toHaveLength(1);

    const track = result.project.tracks[0]!;
    expect(track.name).toBe('Test track');
    expect(track.heart).toBeCloseTo(1.1, 5);
    expect(track.sections).toHaveLength(2); // Anchor synthesised + Straight

    const anchor = track.sections[0]!;
    expect(anchor.type).toBe(SecType.Anchor);
    if (anchor.type !== SecType.Anchor) return;
    expect(anchor.position).toEqual([10, 20, 30]);
    expect(anchor.speed).toBe(12.5);

    const straight = track.sections[1]!;
    expect(straight.type).toBe(SecType.Straight);
    if (straight.type !== SecType.Straight) return;
    expect(straight.length).toBe(40);
    expect(straight.name).toBe('Straight 1');
    expect(straight.rollFunc.subfuncs).toHaveLength(1);
  });

  it('parses a Curved section (angle/radius converted to length+yawRate)', () => {
    const w = new FvdWriter()
      .projectHeader()
      .trackHeader({
        name: 't',
        startPos: [0, 10, 0],
        rollDeg: 0,
        pitchDeg: 0,
        yawDeg: 0,
        velocity: 10,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sectionCount: 1,
      })
      .ascii('CUR')
      .u8(0) // bSpeed
      .lstr('Right turn')
      .f32(10) // fVel
      .f32(90) // fAngle deg → π/2 rad
      .f32(20) // fRadius m
      .f32(90) // fDirection (level turn)
      .f32(0) // fLeadIn deg
      .f32(0) // fLeadOut deg
      .u8(0) // bOrientation
      .ascii('FUNC')
      .i32(1)
      .linearSubFunc(0, 1, 0, 0)
      .trackFooter()
      .projectFooter();

    const result = parseFvd(w.toUint8Array());
    const curved = result.project.tracks[0]!.sections[1]!;
    expect(curved.type).toBe(SecType.Curved);
    if (curved.type !== SecType.Curved) return;
    // Arc length = radius × angle = 20 × π/2 ≈ 31.42
    expect(curved.length).toBeCloseTo(20 * (Math.PI / 2), 3);
    expect(curved.yawRate).toBeCloseTo((Math.PI / 2) / curved.length, 4);
    expect(curved.pitchRate).toBe(0);
  });

  it('parses a Forced section', () => {
    const w = new FvdWriter()
      .projectHeader()
      .trackHeader({
        name: 't',
        startPos: [0, 10, 0],
        rollDeg: 0,
        pitchDeg: 0,
        yawDeg: 0,
        velocity: 10,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sectionCount: 1,
      })
      .ascii('FRC')
      .u8(0) // bSpeed
      .lstr('Force section')
      .f32(10) // fVel
      .u8(0) // bOrientation = Euler
      .u8(0) // bArgument = Time
      .ascii('FUNC')
      .i32(1)
      .linearSubFunc(0, 2, 0, 0) // roll
      .ascii('FUNC')
      .i32(1)
      .linearSubFunc(0, 2, 1, 1) // normal = 1g
      .ascii('FUNC')
      .i32(1)
      .linearSubFunc(0, 2, 0, 0) // lateral
      .i32(2000) // iTime = 2000 ms
      .trackFooter()
      .projectFooter();

    const result = parseFvd(w.toUint8Array());
    const forced = result.project.tracks[0]!.sections[1]!;
    expect(forced.type).toBe(SecType.Forced);
    if (forced.type !== SecType.Forced) return;
    expect(forced.argument).toBe(Argument.Time);
    expect(forced.orientation).toBe(Orientation.Euler);
    expect(forced.extent).toBeCloseTo(2, 3);
    expect(forced.normalFunc.subfuncs[0]?.startValue).toBe(1);
  });

  it('parses a Bezier section (two-segment cubic)', () => {
    const w = new FvdWriter()
      .projectHeader()
      .trackHeader({
        name: 't',
        startPos: [0, 10, 0],
        rollDeg: 0,
        pitchDeg: 0,
        yawDeg: 0,
        velocity: 10,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sectionCount: 1,
      })
      .ascii('BEZ')
      .lstr('Bez')
      .i32(2) // bezCount — two anchors form one cubic
      // segment[0]: anchor = p0; Kp1/Kp2 sentinels (we use anchor itself)
      .reversedVec3(0, 10, 0) // P1
      .reversedVec3(0, 10, 0) // Kp1 sentinel
      .reversedVec3(0, 10, 0) // Kp2 sentinel
      .u8(0) // contRoll
      .u8(0) // relRoll
      .f32(0) // roll
      // segment[1]: anchor = p3; Kp1 = outgoing handle from p0 (= p1);
      // Kp2 = incoming handle into p3 (= p2)
      .reversedVec3(15, 10, 0) // P1 = p3
      .reversedVec3(5, 10, 0) // Kp1 = p1
      .reversedVec3(10, 10, 0) // Kp2 = p2
      .u8(0)
      .u8(0)
      .f32(0)
      .i32(0) // supCount
      .trackFooter()
      .projectFooter();

    const result = parseFvd(w.toUint8Array());
    const bez = result.project.tracks[0]!.sections[1]!;
    expect(bez.type).toBe(SecType.Bezier);
    if (bez.type !== SecType.Bezier) return;
    expect(bez.controlPoints[0]).toEqual([0, 10, 0]);
    expect(bez.controlPoints[1]).toEqual([5, 10, 0]);
    expect(bez.controlPoints[2]).toEqual([10, 10, 0]);
    expect(bez.controlPoints[3]).toEqual([15, 10, 0]);
  });
});

describe('parseFvd — bounds checking', () => {
  it('rejects a string-length-overflow header', () => {
    // texturePathLen = INT32_MAX → readLstr should throw before allocating.
    const w = new FvdWriter().ascii('FVD').ascii('v0.77').i32(0x7fffffff);
    expect(() => parseFvd(w.toUint8Array())).toThrow(WebFvdError);
  });

  it('rejects a negative section count', () => {
    const w = new FvdWriter()
      .projectHeader()
      .trackHeader({
        name: 't',
        startPos: [0, 0, 0],
        rollDeg: 0,
        pitchDeg: 0,
        yawDeg: 0,
        velocity: 0,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sectionCount: -1,
      });
    expect(() => parseFvd(w.toUint8Array())).toThrow(WebFvdError);
  });

  it('rejects an unknown section tag', () => {
    const w = new FvdWriter()
      .projectHeader()
      .trackHeader({
        name: 't',
        startPos: [0, 0, 0],
        rollDeg: 0,
        pitchDeg: 0,
        yawDeg: 0,
        velocity: 0,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sectionCount: 1,
      })
      .ascii('XYZ');
    expect(() => parseFvd(w.toUint8Array())).toThrow(WebFvdError);
  });
});
