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

import {
  EDegree,
  EFuncType,
  Orientation,
  SecType,
  TrackStyle,
  Argument,
} from '../../src/model/enums.js';
import { createEmptyFunc, type Func } from '../../src/model/function.js';
import { type Section } from '../../src/model/section.js';
import { createLinearSubFunc, type SubFunc } from '../../src/model/subfunction.js';
import { type Track } from '../../src/model/track.js';

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
  f.subfuncs.push(createLinearSubFunc({ length, startValue: value, endValue: value }));
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

/**
 * Curved section, FVD++ shape. Loop = `{ fAngle: 360, fRadius: R, fDirection: 0 }`.
 * Level turn = `{ fAngle: 90, fRadius: R, fDirection: 90 }`.
 *
 * `rollFunc` is parameterised by ridden angle in degrees (length-units == fAngle),
 * matching FVD++. A `flatRoll(fAngle, 0)` default keeps the rider level.
 */
export function curved(options: {
  fAngle: number;
  fRadius: number;
  fDirection?: number;
  fLeadIn?: number;
  fLeadOut?: number;
  rollFunc?: Func;
  name?: string;
}): Section {
  return {
    type: SecType.Curved,
    name: options.name ?? 'curved',
    fAngle: options.fAngle,
    fRadius: options.fRadius,
    fDirection: options.fDirection ?? 90,
    fLeadIn: options.fLeadIn ?? 0,
    fLeadOut: options.fLeadOut ?? 0,
    rollFunc: options.rollFunc ?? flatRoll(options.fAngle, 0),
  };
}

/**
 * Author a single-cubic Bezier the friendly way: pass 4 control points and
 * the helper builds the 2-segment chain `BezierSection.segments` expects.
 * For multi-segment authoring, build segments by hand.
 */
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
  const [p0, p1, p2, p3] = options.controlPoints;
  const gap = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
  return {
    type: SecType.Bezier,
    name: options.name ?? 'bezier',
    segments: [
      { P1: [...p0], Kp1: [...p0], Kp2: [...p0] },
      { P1: [...p3], Kp1: [...p1], Kp2: [...p2] },
    ],
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

export function geometric(options: {
  extent: number;
  /** Pitch rate in deg/F_HZ-tick at the start; flat rate by default. */
  pitchRate?: number;
  /** Yaw rate in deg/F_HZ-tick at the start; flat rate by default. */
  yawRate?: number;
  rollFunc?: Func;
}): Section {
  // The integrator samples pitchFunc/yawFunc as cumulative-value-at-arg and
  // divides by F_HZ for the per-tick delta. A flat rate ⇒ constant value
  // across the section.
  const pitchFunc = createEmptyFunc(EFuncType.Pitch, 'Pitch');
  pitchFunc.subfuncs.push(
    createLinearSubFunc({
      length: options.extent,
      startValue: options.pitchRate ?? 0,
      endValue: options.pitchRate ?? 0,
    }),
  );
  const yawFunc = createEmptyFunc(EFuncType.Yaw, 'Yaw');
  yawFunc.subfuncs.push(
    createLinearSubFunc({
      length: options.extent,
      startValue: options.yawRate ?? 0,
      endValue: options.yawRate ?? 0,
    }),
  );
  return {
    type: SecType.Geometric,
    name: 'geometric',
    extent: options.extent,
    argument: Argument.Distance,
    orientation: Orientation.Euler,
    rollFunc: options.rollFunc ?? flatRoll(options.extent, 0),
    pitchFunc,
    yawFunc,
  };
}
