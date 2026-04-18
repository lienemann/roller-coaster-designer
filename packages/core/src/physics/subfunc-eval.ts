// SPDX-License-Identifier: GPL-3.0-only

import { EDegree } from '../model/enums.js';
import { type SubFunc } from '../model/subfunction.js';

// Port target: core/subfunction.cpp applyCenter/applyTension + the per-degree
// polynomial switch in getValue(x) (spec §5.2). M2 needs only the Linear
// branch to make Straight sections work; the remaining eight degrees are
// filled in at M3 when transitions gain a real UI.

/**
 * Evaluates a SubFunc at normalised position x ∈ [0, length].
 * Returns the scalar value along the transition (roll radians, g-force,
 * pitch rate, … — depends on the owning Func).
 *
 * Throws for degrees not yet ported so the caller fails loudly instead of
 * silently returning the start value.
 */
export function getSubFuncValue(subFunc: SubFunc, x: number): number {
  if (subFunc.length <= 0) return subFunc.startValue;

  const tWarped = applyTimewarp(clamp01(x / subFunc.length), subFunc.centerArg, subFunc.tensionArg);
  const delta = subFunc.endValue - subFunc.startValue;

  switch (subFunc.degree) {
    case EDegree.Linear:
      return subFunc.startValue + delta * tWarped;
    default:
      throw new Error(`SubFunc degree not yet implemented: ${EDegree[subFunc.degree]}`);
  }
}

export function subFuncDerivativeAt(subFunc: SubFunc, _x: number): number {
  if (subFunc.length <= 0) return 0;
  const delta = subFunc.endValue - subFunc.startValue;
  switch (subFunc.degree) {
    case EDegree.Linear:
      return delta / subFunc.length;
    default:
      throw new Error(`SubFunc derivative not yet implemented: ${EDegree[subFunc.degree]}`);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// applyCenter + applyTension — FVD++ calls these before the polynomial to
// let the user skew the transition's shape. M2 leaves them as identities so
// Linear transitions behave textbook-classically; they'll be properly ported
// at M3 alongside the other degrees.
function applyTimewarp(t: number, _centerArg: number, _tensionArg: number): number {
  return t;
}
