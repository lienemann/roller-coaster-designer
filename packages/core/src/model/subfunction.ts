// SPDX-License-Identifier: AGPL-3.0-only

import { EDegree } from './enums.js';

// Mirrors core/subfunction.h. A SubFunc describes one transition segment of a
// Func: a span of arc-length or time over which some scalar (roll, normal
// g-load, pitch rate, …) moves from startValue to endValue along a chosen
// polynomial shape.
//
// Flat shape intentional — FVD++ uses one struct with conditional fields by
// degree, and keeping the TypeScript shape identical simplifies both the
// .fvd round-trip (M9) and getValue(x) (M3). Schema validation enforces which
// fields are required per degree.
//
// Units: `length` is seconds for TIME-argument sections and meters for
// DISTANCE-argument ones; the containing Section.argument field decides
// (spec §4.5). `startValue`, `endValue`, `arg1`, `pointList` Y components
// carry the function's native unit (g-force for Normal/Lateral, rad/s for
// Pitch/Yaw/Roll, radians for Roll).

export interface SubFunc {
  degree: EDegree;

  // Domain.
  length: number;

  // Endpoints.
  startValue: number;
  endValue: number;

  // Polynomial shape controls — interpreted per degree (see spec §5.2):
  //   Linear:      unused (0 by default).
  //   Quadratic:   unused.
  //   Cubic:       unused (default smoothstep = 3x² − 2x³).
  //   Quartic:     arg1 controls asymmetric/symmetric branch.
  //   Quintic:     arg1 controls shape.
  //   Sinusoidal:  unused.
  //   Plateau:     arg1 is the flat-middle width as a fraction of length.
  //   ToZero:      unused (uses centerArg/tensionArg instead).
  //   Freeform:    unused (uses pointList).
  arg1: number;

  // Timewarp (applied before the polynomial).
  centerArg: number;
  tensionArg: number;

  // Freeform degree only: two control-point offsets forming a cubic Bezier
  // in (normalized-x, value) space. Missing for every other degree; the Zod
  // schema requires it exactly when degree === Freeform.
  pointList?: [[number, number], [number, number]] | undefined;
}

export function createLinearSubFunc(options: {
  length: number;
  startValue: number;
  endValue: number;
}): SubFunc {
  return {
    degree: EDegree.Linear,
    length: options.length,
    startValue: options.startValue,
    endValue: options.endValue,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
  };
}

export function createFreeformSubFunc(options: {
  length: number;
  startValue: number;
  endValue: number;
  control0: [number, number];
  control1: [number, number];
}): SubFunc {
  return {
    degree: EDegree.Freeform,
    length: options.length,
    startValue: options.startValue,
    endValue: options.endValue,
    arg1: 0,
    centerArg: 0,
    tensionArg: 0,
    pointList: [options.control0, options.control1],
  };
}
