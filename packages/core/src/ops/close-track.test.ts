// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EFuncType, SecType, TrackStyle } from '../model/enums.js';
import { createEmptyFunc } from '../model/function.js';
import { type AnchorSection, type StraightSection } from '../model/section.js';
import { type Track } from '../model/track.js';
import { integrateTrack } from '../physics/integrate.js';

import { TrackClosureError, closeTrack } from './close-track.js';

function trackWithHalfLoop(): Track {
  const anchor: AnchorSection = {
    type: SecType.Anchor,
    name: 'anchor',
    position: [0, 10, 0],
    pitch: 0,
    yaw: 0,
    roll: 0,
    speed: 12,
  };
  const straight: StraightSection = {
    type: SecType.Straight,
    name: 'out',
    length: 30,
    rollFunc: createEmptyFunc(EFuncType.Roll),
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

describe('closeTrack', () => {
  it('appends a Bezier section whose endpoints are end pose and anchor pose', () => {
    const closed = closeTrack(trackWithHalfLoop());
    expect(closed.sections).toHaveLength(3);
    const closure = closed.sections[2]!;
    expect(closure.type).toBe(SecType.Bezier);
    if (closure.type !== SecType.Bezier) throw new Error('unreachable');

    const [p0, , , p3] = closure.controlPoints;
    // Start of closure = end of straight (30 m along +X from anchor) within
    // Float32Array precision accumulated over 3000 integration steps.
    expect(p0[0]).toBeCloseTo(30, 2);
    expect(p0[1]).toBeCloseTo(10, 2);
    // End of closure = anchor.
    expect(p3).toEqual([0, 10, 0]);
  });

  it('refuses a single-section track', () => {
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
          position: [0, 0, 0],
          pitch: 0,
          yaw: 0,
          roll: 0,
          speed: 10,
        },
      ],
      smoothers: [],
    };
    expect(() => closeTrack(track)).toThrow(TrackClosureError);
  });

  it('produces a track the integrator can walk end to end', () => {
    const closed = closeTrack(trackWithHalfLoop());
    const { arrays, sectionStartNodes } = integrateTrack(closed);
    expect(sectionStartNodes).toHaveLength(3);
    // After closure, the final node must be near the anchor position.
    const last = arrays.length - 1;
    expect(arrays.posX[last]!).toBeCloseTo(0, 1);
    expect(arrays.posY[last]!).toBeCloseTo(10, 1);
    expect(arrays.posZ[last]!).toBeCloseTo(0, 1);
  });
});
