// SPDX-License-Identifier: AGPL-3.0-only

// Track builders for golden-file tests. Each function produces a Track that
// the harness integrates and snapshots. The goal is a broad catalogue of
// behaviors — basic invariants, advanced section-type coverage, and known
// corner cases — so any math change detectably shifts at least one snapshot.
//
// Conventions:
//   - All anchors sit at y=10 unless a test specifically probes ground-plane
//     behaviour. Stays well clear of the 0.9·heart offset in the energy term.
//   - Default heart = 1.1 m. Frictionless unless noted.
//   - Default anchor speed = 12 m/s — fast enough that 1000 Hz integration
//     produces enough steps per meter to diff reliably, slow enough that a
//     short section doesn't blow past in a handful of nodes.

import { EDegree, EFuncType, Orientation, SecType, TrackStyle, Argument } from '../../src/model/enums.js';
import { createEmptyFunc, type Func } from '../../src/model/function.js';
import { type Section } from '../../src/model/section.js';
import { createLinearSubFunc, type SubFunc } from '../../src/model/subfunction.js';
import { type Track } from '../../src/model/track.js';
import { integrateTrack } from '../../src/physics/integrate.js';

export const DEFAULT_HEART = 1.1;
export const DEFAULT_SPEED = 12;

export function makeTrack(name: string, sections: Section[]): Track {
  return {
    name,
    style: TrackStyle.Generic,
    heart: DEFAULT_HEART,
    friction: 0,
    resistance: 0,
    sections,
    smoothers: [],
  };
}

export function anchorAt(
  position: [number, number, number],
  options: { pitch?: number; yaw?: number; roll?: number; speed?: number } = {},
): Section {
  return {
    type: SecType.Anchor,
    name: 'anchor',
    position,
    pitch: options.pitch ?? 0,
    yaw: options.yaw ?? 0,
    roll: options.roll ?? 0,
    speed: options.speed ?? DEFAULT_SPEED,
  };
}

export function flatRoll(length: number, value = 0): Func {
  const f = createEmptyFunc(EFuncType.Roll, 'Roll');
  f.subfuncs.push(
    createLinearSubFunc({ length, startValue: value, endValue: value }),
  );
  return f;
}

export function linearRoll(length: number, startValue: number, endValue: number): Func {
  const f = createEmptyFunc(EFuncType.Roll, 'Roll');
  f.subfuncs.push(createLinearSubFunc({ length, startValue, endValue }));
  return f;
}

export function multiSubfuncRoll(segments: SubFunc[]): Func {
  const f = createEmptyFunc(EFuncType.Roll, 'Roll');
  f.subfuncs.push(...segments);
  return f;
}

export function cubicSubFunc(options: {
  length: number;
  startValue: number;
  endValue: number;
}): SubFunc {
  return {
    degree: EDegree.Cubic,
    length: options.length,
    startValue: options.startValue,
    endValue: options.endValue,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  };
}

export function straight(length: number, rollFunc?: Func): Section {
  return {
    type: SecType.Straight,
    name: 'straight',
    length,
    rollFunc: rollFunc ?? flatRoll(length, 0),
  };
}

export function curved(options: {
  length: number;
  pitchRate?: number;
  yawRate?: number;
  leadIn?: number;
  leadOut?: number;
  rollFunc?: Func;
  name?: string;
}): Section {
  return {
    type: SecType.Curved,
    name: options.name ?? 'curved',
    length: options.length,
    pitchRate: options.pitchRate ?? 0,
    yawRate: options.yawRate ?? 0,
    leadIn: options.leadIn ?? 0,
    leadOut: options.leadOut ?? 0,
    rollFunc: options.rollFunc ?? flatRoll(options.length, 0),
  };
}

export function bezier(options: {
  controlPoints: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  rollFunc?: Func;
  name?: string;
}): Section {
  // A linear roll over the straight-line gap length is a reasonable default
  // — the integrator samples rollFunc by arc length inside the section.
  const gap = Math.hypot(
    options.controlPoints[3][0] - options.controlPoints[0][0],
    options.controlPoints[3][1] - options.controlPoints[0][1],
    options.controlPoints[3][2] - options.controlPoints[0][2],
  );
  return {
    type: SecType.Bezier,
    name: options.name ?? 'bezier',
    controlPoints: options.controlPoints,
    rollFunc: options.rollFunc ?? flatRoll(Math.max(gap, 0.01), 0),
    smoothStart: false,
    smoothEnd: false,
  };
}

export function forced(options: {
  extent: number;
  normalG?: number;
  lateralG?: number;
  rollFunc?: Func;
}): Section {
  const normalFunc = createEmptyFunc(EFuncType.Normal, 'Normal');
  normalFunc.subfuncs.push(
    createLinearSubFunc({
      length: options.extent,
      startValue: options.normalG ?? 1,
      endValue: options.normalG ?? 1,
    }),
  );
  const lateralFunc = createEmptyFunc(EFuncType.Lateral, 'Lateral');
  lateralFunc.subfuncs.push(
    createLinearSubFunc({
      length: options.extent,
      startValue: options.lateralG ?? 0,
      endValue: options.lateralG ?? 0,
    }),
  );
  return {
    type: SecType.Forced,
    name: 'forced',
    extent: options.extent,
    argument: Argument.Time,
    orientation: Orientation.Euler,
    rollFunc: options.rollFunc ?? flatRoll(options.extent, 0),
    normalFunc,
    lateralFunc,
  };
}

/**
 * Build a Bezier that meets the previous section tangent-continuously.
 *
 * The Bezier integrator samples the cubic verbatim — it does NOT auto-
 * translate or re-orient. So for a mid-track Bezier to land smoothly:
 *
 *   - p0 must equal the previous section's end position
 *   - p1 must lie along the previous section's end direction (a unit vector
 *     × handle distance), because the Bezier's tangent at t=0 is
 *     3·(p1 − p0)
 *
 * `closeTrack` does both of these explicitly. This helper does the same so
 * test cases for mid-track Beziers don't have to recompute the prefix's
 * end pose by hand. p2 and p3 are free choices in absolute world coords.
 */
export function chainedBezier(
  prefix: Section[],
  options: {
    /** Distance along the previous section's end direction for p1. */
    handleLength: number;
    /** Second control point in world coordinates. */
    p2: [number, number, number];
    /** Final control point (where the Bezier section ends). */
    p3: [number, number, number];
    rollFunc?: Func;
    name?: string;
  },
): Section {
  const { arrays } = integrateTrack(makeTrack('chain-prefix', prefix));
  const last = arrays.length - 1;
  if (last < 0) throw new Error('chainedBezier: prefix integrated to nothing');
  const endPos: [number, number, number] = [
    arrays.posX[last]!,
    arrays.posY[last]!,
    arrays.posZ[last]!,
  ];
  const endDir: [number, number, number] = [
    arrays.dirX[last]!,
    arrays.dirY[last]!,
    arrays.dirZ[last]!,
  ];
  const p1: [number, number, number] = [
    endPos[0] + endDir[0] * options.handleLength,
    endPos[1] + endDir[1] * options.handleLength,
    endPos[2] + endDir[2] * options.handleLength,
  ];
  return bezier({
    controlPoints: [endPos, p1, options.p2, options.p3],
    ...(options.rollFunc !== undefined ? { rollFunc: options.rollFunc } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  });
}

export function geometric(options: {
  extent: number;
  pitchRate?: number;
  yawRate?: number;
  rollFunc?: Func;
}): Section {
  // Ramp from 0 → pitchRate*extent over the section length so evalFuncRate
  // (which takes the SubFunc derivative) returns a constant rate.
  const pitchFunc = createEmptyFunc(EFuncType.Pitch, 'Pitch');
  pitchFunc.subfuncs.push(
    createLinearSubFunc({
      length: options.extent,
      startValue: 0,
      endValue: (options.pitchRate ?? 0) * options.extent,
    }),
  );
  const yawFunc = createEmptyFunc(EFuncType.Yaw, 'Yaw');
  yawFunc.subfuncs.push(
    createLinearSubFunc({
      length: options.extent,
      startValue: 0,
      endValue: (options.yawRate ?? 0) * options.extent,
    }),
  );
  return {
    type: SecType.Geometric,
    name: 'geometric',
    extent: options.extent,
    argument: Argument.Distance,
    rollFunc: options.rollFunc ?? flatRoll(options.extent, 0),
    pitchFunc,
    yawFunc,
  };
}
