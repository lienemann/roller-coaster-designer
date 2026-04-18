// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { F_HZ } from '../model/constants.js';
import { EFuncType, SecType, TrackStyle } from '../model/enums.js';
import { createEmptyFunc } from '../model/function.js';
import { type AnchorSection, type StraightSection } from '../model/section.js';
import { createLinearSubFunc } from '../model/subfunction.js';
import { type Track } from '../model/track.js';

import { integrateTrack } from './integrate.js';

function makeHorizontalStraight(length: number, speed = 10): Track {
  const anchor: AnchorSection = {
    type: SecType.Anchor,
    name: 'anchor',
    position: [0, 10, 0],
    pitch: 0,
    yaw: 0,
    roll: 0,
    speed,
  };
  const rollFunc = createEmptyFunc(EFuncType.Roll);
  const straight: StraightSection = {
    type: SecType.Straight,
    name: 'straight',
    length,
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

describe('integrateTrack — anchor only', () => {
  it('writes a single node with the anchor pose and speed', () => {
    const track = makeHorizontalStraight(0, 12.5);
    const { arrays, sectionStartNodes } = integrateTrack(track);
    // With length 0, the Straight section produces no nodes beyond the anchor.
    expect(sectionStartNodes).toEqual([0, 1]);
    expect(arrays.length).toBe(1);
    expect(arrays.posX[0]).toBeCloseTo(0);
    expect(arrays.posY[0]).toBeCloseTo(10);
    expect(arrays.posZ[0]).toBeCloseTo(0);
    expect(arrays.dirX[0]).toBeCloseTo(1);
    expect(arrays.vel[0]).toBeCloseTo(12.5);
  });
});

describe('integrateTrack — horizontal Straight', () => {
  const SPEED = 10;
  const track = makeHorizontalStraight(20, SPEED);
  const { arrays } = integrateTrack(track);
  const nLast = arrays.length - 1;

  it('advances to the end of the straight along +X', () => {
    // Last node sits at the section end within Float32Array precision.
    expect(arrays.posX[nLast]!).toBeCloseTo(20, 2);
    expect(arrays.posY[nLast]!).toBeCloseTo(10, 4);
    expect(arrays.posZ[nLast]!).toBeCloseTo(0, 4);
  });

  it('keeps velocity constant on a frictionless horizontal run', () => {
    // Pick a midpoint node and compare against the anchor.
    const mid = Math.floor(nLast / 2);
    expect(arrays.vel[mid]!).toBeCloseTo(SPEED, 5);
    expect(arrays.vel[nLast]!).toBeCloseTo(SPEED, 5);
  });

  it('emits nodes at the integration rate (~1 ms apart)', () => {
    // Total distance ÷ speed ≈ seconds; × F_HZ ≈ node count. Allow the
    // off-by-one from clipping the final step.
    const expectedNodes = Math.ceil((20 / SPEED) * F_HZ);
    expect(arrays.length).toBeGreaterThanOrEqual(expectedNodes);
    expect(arrays.length).toBeLessThanOrEqual(expectedNodes + 2);
  });

  it('reports ~1g in forceNormal on a horizontal straight with no roll', () => {
    // Gravity is fully absorbed by the seat; lateral is 0.
    const mid = Math.floor(nLast / 2);
    expect(arrays.forceNormal[mid]!).toBeCloseTo(1, 3);
    expect(arrays.forceLateral[mid]!).toBeCloseTo(0, 3);
  });
});

describe('integrateTrack — inclined Straight conserves energy', () => {
  it('slows the train as it climbs, speeds it up as it descends (equivalent by reversal)', () => {
    const up: Track = {
      name: 't',
      style: TrackStyle.Generic,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        {
          type: SecType.Anchor,
          name: 'anchor',
          position: [0, 0, 0],
          pitch: Math.PI / 6, // 30° up
          yaw: 0,
          roll: 0,
          speed: 20,
        },
        {
          type: SecType.Straight,
          name: 'climb',
          length: 10,
          rollFunc: createEmptyFunc(EFuncType.Roll),
        },
      ],
    };
    const { arrays } = integrateTrack(up);
    const last = arrays.length - 1;
    // After climbing ~10 m * sin(30°) = 5 m, velocity should drop per
    //   0.5 v_end² + g·y_end = 0.5 v_start² + g·y_start
    // Height uses 0.9×heart-line y for FVD++ parity; with anchor normal
    // aligned to +Y, the extra offset is 0.9·1.1·sin(60°).
    const heightGain = arrays.posY[last]! - arrays.posY[0]!;
    expect(heightGain).toBeGreaterThan(4.5);
    expect(arrays.vel[last]!).toBeLessThan(20);
    expect(arrays.vel[last]!).toBeGreaterThan(15);
  });
});

describe('integrateTrack — Curved', () => {
  function buildHorizontalTurn(yawRate: number, length: number): Track {
    return {
      name: 't',
      style: TrackStyle.Generic,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        {
          type: SecType.Anchor,
          name: 'a',
          position: [0, 10, 0],
          pitch: 0,
          yaw: 0,
          roll: 0,
          speed: 15,
        },
        {
          type: SecType.Curved,
          name: 'turn',
          length,
          pitchRate: 0,
          yawRate,
          leadIn: 0,
          leadOut: 0,
          rollFunc: createEmptyFunc(EFuncType.Roll),
        },
      ],
      smoothers: [],
    };
  }

  it('horizontal turn curves in the x-z plane without changing height', () => {
    // 90° right turn over 20 m arc length ⇒ yawRate = π/2 / 20 rad/m.
    const { arrays } = integrateTrack(buildHorizontalTurn(Math.PI / 2 / 20, 20));
    const last = arrays.length - 1;
    expect(arrays.posY[last]!).toBeCloseTo(10, 3);
    // Final direction should have rotated ~90° around +Y: started +X, ends +Z (negative since yaw rotates +X toward -Z in our convention).
    const dirEndZ = arrays.dirZ[last]!;
    expect(Math.abs(dirEndZ)).toBeGreaterThan(0.95);
  });

  it('pitch-only turn traces an arc in the y direction', () => {
    const track: Track = {
      name: 't',
      style: TrackStyle.Generic,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        {
          type: SecType.Anchor,
          name: 'a',
          position: [0, 20, 0],
          pitch: 0,
          yaw: 0,
          roll: 0,
          speed: 20,
        },
        {
          type: SecType.Curved,
          name: 'loop-in',
          length: 10,
          pitchRate: Math.PI / 4 / 10, // quarter-loop up over 10 m
          yawRate: 0,
          leadIn: 0,
          leadOut: 0,
          rollFunc: createEmptyFunc(EFuncType.Roll),
        },
      ],
      smoothers: [],
    };
    const { arrays } = integrateTrack(track);
    const last = arrays.length - 1;
    expect(arrays.posY[last]!).toBeGreaterThan(20);
    expect(arrays.dirY[last]!).toBeGreaterThan(0.5);
  });

  it('lead-in produces a smooth onset (direction barely changes in the first handful of steps)', () => {
    const track = buildHorizontalTurn(Math.PI / 2 / 20, 20);
    const sec = track.sections[1]!;
    if (sec.type !== SecType.Curved) throw new Error('unreachable');
    sec.leadIn = 5;
    const { arrays, sectionStartNodes } = integrateTrack(track);
    const start = sectionStartNodes[1] ?? 1;
    const nearZ = Math.abs(arrays.dirZ[start + 10] ?? 0);
    const farZ = Math.abs(arrays.dirZ[start + 500] ?? 0);
    expect(nearZ).toBeLessThan(farZ);
  });
});

describe('integrateTrack — Forced', () => {
  function makeForcedTrack(options: {
    duration: number;
    normalG: number;
    lateralG: number;
    argument?: 0 | 1;
  }): Track {
    const rollFunc = createEmptyFunc(EFuncType.Roll);
    const normalFunc = createEmptyFunc(EFuncType.Normal);
    // Hold the g-value constant across the section by using a flat linear
    // subfunc (startValue === endValue).
    normalFunc.subfuncs.push(
      createLinearSubFunc({
        length: options.duration,
        startValue: options.normalG,
        endValue: options.normalG,
      }),
    );
    const lateralFunc = createEmptyFunc(EFuncType.Lateral);
    lateralFunc.subfuncs.push(
      createLinearSubFunc({
        length: options.duration,
        startValue: options.lateralG,
        endValue: options.lateralG,
      }),
    );
    return {
      name: 't',
      style: TrackStyle.Generic,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        {
          type: SecType.Anchor,
          name: 'a',
          position: [0, 30, 0],
          pitch: 0,
          yaw: 0,
          roll: 0,
          speed: 20,
        },
        {
          type: SecType.Forced,
          name: 'f',
          argument: options.argument ?? 0,
          orientation: 0,
          extent: options.duration,
          rollFunc,
          normalFunc,
          lateralFunc,
        },
      ],
      smoothers: [],
    };
  }

  it('1g normal with zero lateral keeps the train flying horizontally at constant velocity', () => {
    // Normal = 1g exactly cancels gravity on a level track; net vertical
    // force is zero, so the train should hold its height and speed.
    const track = makeForcedTrack({ duration: 2, normalG: 1, lateralG: 0 });
    const { arrays } = integrateTrack(track);
    const last = arrays.length - 1;
    expect(arrays.posY[last]!).toBeCloseTo(30, 1);
    expect(arrays.vel[last]!).toBeCloseTo(20, 1);
  });

  it('positive normal g produces a pitch-up arc (y increases along the path)', () => {
    const track = makeForcedTrack({ duration: 2, normalG: 2, lateralG: 0 });
    const { arrays } = integrateTrack(track);
    const last = arrays.length - 1;
    expect(arrays.posY[last]!).toBeGreaterThan(30);
  });

  it('lateral g bends the path in the horizontal plane', () => {
    const track = makeForcedTrack({ duration: 2, normalG: 1, lateralG: 1 });
    const { arrays } = integrateTrack(track);
    const last = arrays.length - 1;
    expect(Math.abs(arrays.posZ[last]!)).toBeGreaterThan(0.1);
  });
});

describe('integrateTrack — Geometric', () => {
  it('constant pitch-rate func tilts the path upward', () => {
    const rollFunc = createEmptyFunc(EFuncType.Roll);
    const pitchFunc = createEmptyFunc(EFuncType.Pitch);
    // Linear subfunc over 20 m that integrates to 20 × rate_avg. Absolute
    // value at each argument = Linear.startValue → endValue. Derivative
    // (subFuncDerivativeAt) is (end − start) / length. We want a constant
    // pitch rate of ~0.02 rad/m, so pick Linear 0 → 0.4.
    pitchFunc.subfuncs.push(createLinearSubFunc({ length: 20, startValue: 0, endValue: 0.4 }));
    const yawFunc = createEmptyFunc(EFuncType.Yaw);
    yawFunc.subfuncs.push(createLinearSubFunc({ length: 20, startValue: 0, endValue: 0 }));
    const track: Track = {
      name: 't',
      style: TrackStyle.Generic,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        {
          type: SecType.Anchor,
          name: 'a',
          position: [0, 20, 0],
          pitch: 0,
          yaw: 0,
          roll: 0,
          speed: 15,
        },
        {
          type: SecType.Geometric,
          name: 'g',
          argument: 1, // Distance
          extent: 20,
          rollFunc,
          pitchFunc,
          yawFunc,
        },
      ],
      smoothers: [],
    };
    const { arrays } = integrateTrack(track);
    const last = arrays.length - 1;
    expect(arrays.posY[last]!).toBeGreaterThan(20);
    expect(arrays.dirY[last]!).toBeGreaterThan(0);
  });
});

describe('integrateTrack — Straight with a Roll Func', () => {
  it('reaches the prescribed roll at the end of the section', () => {
    const rollFunc = createEmptyFunc(EFuncType.Roll);
    rollFunc.subfuncs.push(createLinearSubFunc({ length: 10, startValue: 0, endValue: Math.PI }));
    const track: Track = {
      name: 't',
      style: TrackStyle.Generic,
      heart: 1.1,
      friction: 0,
      resistance: 0,
      sections: [
        {
          type: SecType.Anchor,
          name: 'a',
          position: [0, 10, 0],
          pitch: 0,
          yaw: 0,
          roll: 0,
          speed: 10,
        },
        { type: SecType.Straight, name: 's', length: 10, rollFunc },
      ],
    };
    const { arrays } = integrateTrack(track);
    const last = arrays.length - 1;
    expect(arrays.roll[last]!).toBeCloseTo(Math.PI, 3);
  });
});
