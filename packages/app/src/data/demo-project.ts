// SPDX-License-Identifier: AGPL-3.0-only

import {
  EDegree,
  EFuncType,
  SecType,
  TrackStyle,
  closeTrack,
  createEmptyFunc,
  type AnchorSection,
  type CurvedSection,
  type Project,
  type StraightSection,
  type Track,
} from '@roller-coaster-designer/core';

/**
 * Handcrafted demo track that shows off banking + a vertical loop. The
 * geometry:
 *   - Anchor 28 m up, nose-down ~25°.
 *   - Drop straight, 18 m.
 *   - Banking 90° level turn (R = 18 m). The rollFunc ramps banking up
 *     to a hold value, holds across the body of the turn, then ramps
 *     back to zero before the exit so the rider is upright again.
 *   - Lead-in straight (10 m).
 *   - Vertical-ish loop (R = 8 m, fDirection = 12°). The 12° tilt
 *     offsets the exit a few meters laterally from the entry so the
 *     two segments don't visually overlap — that's the known wart of
 *     the bare `Loop` tool, papered over here by tilting the loop
 *     plane.
 *   - Lead-out straight (8 m).
 *   - Closure Bezier back to the anchor (closeTrack).
 *
 * Roll-func value units are degrees-per-(F_HZ ticks of angle for
 * Curved, F_HZ ticks of arc length for Straight). The banking-hold
 * value (0.6) was tuned by eye against the 90° turn at v = 15 m/s,
 * which produces roughly a 45° peak bank.
 */
export function createDemoProject(): Project {
  const dropRoll = createEmptyFunc(EFuncType.Roll, 'Drop roll');
  dropRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 18,
    startValue: 0,
    endValue: 0,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });

  // Three-piece roll func for the banked turn: bank up (30° of turn),
  // hold (30°), unbank (30°). Cubic so the rate is smooth at the
  // joins. Aims for a clearly-visible bank without going inverted.
  const turnRoll = createEmptyFunc(EFuncType.Roll, 'Turn roll');
  turnRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 30,
    startValue: 0,
    endValue: 0.6,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });
  turnRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 30,
    startValue: 0.6,
    endValue: 0.6,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });
  turnRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 30,
    startValue: 0.6,
    endValue: 0,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });

  const leadInRoll = createEmptyFunc(EFuncType.Roll, 'Lead-in roll');
  leadInRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 10,
    startValue: 0,
    endValue: 0,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });

  // Loop roll func — no banking change through the inversion; the
  // Curved's own pitch-up axis carries the rider over.
  const loopRoll = createEmptyFunc(EFuncType.Roll, 'Loop roll');
  loopRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 360,
    startValue: 0,
    endValue: 0,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });

  const leadOutRoll = createEmptyFunc(EFuncType.Roll, 'Lead-out roll');
  leadOutRoll.subfuncs.push({
    degree: EDegree.Cubic,
    length: 8,
    startValue: 0,
    endValue: 0,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  });

  const anchor: AnchorSection = {
    type: SecType.Anchor,
    name: 'Start',
    position: [0, 28, 0],
    pitch: -0.44, // ~−25°
    yaw: 0,
    roll: 0,
    speed: 15,
  };
  const drop: StraightSection = {
    type: SecType.Straight,
    name: 'Drop',
    length: 18,
    rollFunc: dropRoll,
  };
  const turn: CurvedSection = {
    type: SecType.Curved,
    name: 'Banked turn',
    fAngle: 90,
    fRadius: 18,
    fDirection: 90, // 90° = level turn (rotation axis vertical)
    fLeadIn: 12,
    fLeadOut: 12,
    rollFunc: turnRoll,
  };
  const leadIn: StraightSection = {
    type: SecType.Straight,
    name: 'Loop lead-in',
    length: 10,
    rollFunc: leadInRoll,
  };
  // Vertical-ish loop. fDirection=12° tilts the rotation axis off
  // pure-lateral by 12° so the loop's plane leans by that much; the
  // exit point sits ~2 R · sin(12°) ≈ 3.3 m to the side of the
  // entry, so the two segments don't visually overlap.
  const loop: CurvedSection = {
    type: SecType.Curved,
    name: 'Loop',
    fAngle: 360,
    fRadius: 8,
    fDirection: 12,
    fLeadIn: 25,
    fLeadOut: 25,
    rollFunc: loopRoll,
  };
  const leadOut: StraightSection = {
    type: SecType.Straight,
    name: 'Loop lead-out',
    length: 8,
    rollFunc: leadOutRoll,
  };

  const openTrack: Track = {
    name: 'Demo',
    style: TrackStyle.Generic,
    heart: 1.1,
    friction: 0,
    resistance: 0,
    smoothers: [],
    sections: [anchor, drop, turn, leadIn, loop, leadOut],
  };

  const closed = closeTrack(openTrack);
  return { texturePath: '', tracks: [closed], fvdCompatibilityMode: true };
}
