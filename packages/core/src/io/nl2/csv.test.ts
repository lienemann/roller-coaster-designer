// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EFuncType, SecType, TrackStyle } from '../../model/enums.js';
import { createEmptyFunc } from '../../model/function.js';
import { type AnchorSection, type StraightSection } from '../../model/section.js';
import { createLinearSubFunc } from '../../model/subfunction.js';
import { type Track } from '../../model/track.js';
import { integrateTrack } from '../../physics/integrate.js';

import { writeNl2Csv } from './csv.js';

function horizontalStraight(): Track {
  const anchor: AnchorSection = {
    type: SecType.Anchor,
    name: 'a',
    position: [0, 10, 0],
    pitch: 0,
    yaw: 0,
    roll: 0,
    speed: 10,
  };
  const rollFunc = createEmptyFunc(EFuncType.Roll);
  rollFunc.subfuncs.push(createLinearSubFunc({ length: 20, startValue: 0, endValue: 0 }));
  const straight: StraightSection = {
    type: SecType.Straight,
    name: 'run',
    length: 20,
    rollFunc,
  };
  return {
    name: 't',
    style: TrackStyle.Generic,
    heart: 1.1,
    friction: 0,
    resistance: 0,
    sections: [anchor, straight],
    smoothers: [],
  };
}

describe('writeNl2Csv', () => {
  it('emits the canonical tab-separated header', () => {
    const { arrays } = integrateTrack(horizontalStraight());
    const csv = writeNl2Csv(arrays);
    const header = csv.split('\n', 1)[0]!;
    expect(header).toBe('No.\tPosX\tPosY\tPosZ\tFrontX\tFrontY\tFrontZ\tLeftX\tLeftY\tLeftZ\tUpX\tUpY\tUpZ');
  });

  it('writes the anchor row at index 0 with the anchor pose', () => {
    const { arrays } = integrateTrack(horizontalStraight());
    const lines = writeNl2Csv(arrays).split('\n');
    const row0 = lines[1]!.split('\t');
    expect(row0[0]).toBe('0');
    expect(Number(row0[1])).toBeCloseTo(0, 3); // PosX
    expect(Number(row0[2])).toBeCloseTo(10, 3); // PosY
    expect(Number(row0[3])).toBeCloseTo(0, 3); // PosZ
    expect(Number(row0[4])).toBeCloseTo(1, 3); // FrontX = +1 (anchor faces +X)
    expect(Number(row0[5])).toBeCloseTo(0, 3); // FrontY
    expect(Number(row0[6])).toBeCloseTo(0, 3); // FrontZ
    // Left = -lat; anchor lat=+Z so Left = -Z → LeftZ = -1
    expect(Number(row0[7])).toBeCloseTo(0, 3); // LeftX
    expect(Number(row0[8])).toBeCloseTo(0, 3); // LeftY
    expect(Number(row0[9])).toBeCloseTo(-1, 3); // LeftZ
    expect(Number(row0[10])).toBeCloseTo(0, 3); // UpX
    expect(Number(row0[11])).toBeCloseTo(1, 3); // UpY
    expect(Number(row0[12])).toBeCloseTo(0, 3); // UpZ
  });

  it('respects stride and always emits the last node', () => {
    const { arrays } = integrateTrack(horizontalStraight());
    const csv = writeNl2Csv(arrays, { stride: 500 });
    const lines = csv.split('\n').filter((l) => l.length > 0);
    // Header + ~(arrays.length / 500) sampled rows + the final-node row
    // (if it's not already on a stride boundary). For a 2-second straight
    // at 1 kHz integration that's roughly 2000/500 = 4 sampled rows + tail.
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBeLessThan(10);
    const lastRow = lines[lines.length - 1]!.split('\t');
    // Last row should be near posX = 20 (the run is 20 m of +X).
    expect(Number(lastRow[1])).toBeCloseTo(20, 1);
  });

  it('produces a finite, well-formed file (no NaN/Infinity)', () => {
    const { arrays } = integrateTrack(horizontalStraight());
    const csv = writeNl2Csv(arrays);
    expect(csv).not.toMatch(/NaN|Infinity/);
    expect(csv.endsWith('\n')).toBe(true);
  });
});
