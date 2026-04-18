// SPDX-License-Identifier: AGPL-3.0-only

import { EDegree } from '../model/enums.js';
import { type SubFunc } from '../model/subfunction.js';

// Port target: core/subfunction.cpp. `getValue(x)` runs inside the physics
// hot loop (millions of times per recompute), so every branch below stays
// allocation-free and branch-predictable.
//
// Units are whatever the owning Func carries — this function only knows t ∈
// [0, 1], shape controls, and endpoints. M3 leaves applyCenter / applyTension
// as identity transforms; the cleanest port of FVD++'s formula lives at M4
// alongside the Forced integrator (they share analytical derivatives). We
// flag this explicitly rather than hide it under a partially-working curve.

/**
 * Evaluates a SubFunc at arc position x ∈ [0, length] and returns the scalar
 * value along the transition.
 */
export function getSubFuncValue(subFunc: SubFunc, x: number): number {
  if (subFunc.length <= 0) return subFunc.startValue;
  const t = clamp01(x / subFunc.length);
  return evalShape(subFunc, t);
}

/**
 * Arc-length derivative d(value)/dx at position x ∈ [0, length]. Used by the
 * integrator for per-step deltas (rad/s, g/s, …). Closed-form; no numerical
 * finite-difference step in the hot loop.
 */
export function subFuncDerivativeAt(subFunc: SubFunc, x: number): number {
  if (subFunc.length <= 0) return 0;
  const t = clamp01(x / subFunc.length);
  return evalShapeDerivative(subFunc, t) / subFunc.length;
}

// --- shape polynomials ------------------------------------------------------

function evalShape(subFunc: SubFunc, t: number): number {
  const { startValue, endValue } = subFunc;
  const delta = endValue - startValue;

  switch (subFunc.degree) {
    case EDegree.Linear:
      return startValue + delta * t;
    case EDegree.Quadratic:
      return startValue + delta * quadraticShape(t, subFunc.arg1);
    case EDegree.Cubic:
      // Classic smoothstep: zero first derivative at both endpoints.
      return startValue + delta * (t * t * (3 - 2 * t));
    case EDegree.Quartic:
      return startValue + delta * quarticShape(t, subFunc.arg1);
    case EDegree.Quintic:
      return startValue + delta * quinticShape(t, subFunc.arg1);
    case EDegree.Sinusoidal:
      return startValue + delta * 0.5 * (1 - Math.cos(Math.PI * t));
    case EDegree.Plateau:
      return startValue + delta * plateauShape(t, subFunc.arg1);
    case EDegree.ToZero:
      return toZeroShape(t, startValue, endValue);
    case EDegree.Freeform: {
      const pointList = subFunc.pointList;
      if (!pointList) throw new Error('Freeform SubFunc missing pointList.');
      return startValue + delta * freeformShape(t, pointList[0], pointList[1]);
    }
    default:
      throw new Error(`Unhandled SubFunc degree: ${String(subFunc.degree as number)}`);
  }
}

function evalShapeDerivative(subFunc: SubFunc, t: number): number {
  const delta = subFunc.endValue - subFunc.startValue;

  switch (subFunc.degree) {
    case EDegree.Linear:
      return delta;
    case EDegree.Quadratic:
      return delta * quadraticShapeDerivative(t, subFunc.arg1);
    case EDegree.Cubic:
      return delta * (6 * t * (1 - t));
    case EDegree.Quartic:
      return delta * quarticShapeDerivative(t, subFunc.arg1);
    case EDegree.Quintic:
      return delta * quinticShapeDerivative(t, subFunc.arg1);
    case EDegree.Sinusoidal:
      return delta * 0.5 * Math.PI * Math.sin(Math.PI * t);
    case EDegree.Plateau:
      return delta * plateauShapeDerivative(t, subFunc.arg1);
    case EDegree.ToZero:
      return toZeroShapeDerivative(t, subFunc.startValue, subFunc.endValue);
    case EDegree.Freeform: {
      const pointList = subFunc.pointList;
      if (!pointList) throw new Error('Freeform SubFunc missing pointList.');
      return delta * freeformShapeDerivative(t, pointList[0], pointList[1]);
    }
    default:
      throw new Error(`Unhandled SubFunc degree: ${String(subFunc.degree as number)}`);
  }
}

function quadraticShape(t: number, arg1: number): number {
  // arg1 ∈ [−1, 1] blends between start-loaded (2t − t²) and end-loaded (t²)
  // shapes. 0 is start-loaded ease-out, the FVD++ default.
  const b = clamp(-1, 1, arg1);
  const startLoaded = 2 * t - t * t;
  const endLoaded = t * t;
  return (1 - b) * 0.5 * startLoaded + (1 + b) * 0.5 * endLoaded;
}

function quadraticShapeDerivative(t: number, arg1: number): number {
  const b = clamp(-1, 1, arg1);
  const startLoaded = 2 - 2 * t;
  const endLoaded = 2 * t;
  return (1 - b) * 0.5 * startLoaded + (1 + b) * 0.5 * endLoaded;
}

function quarticShape(t: number, arg1: number): number {
  // arg1 = 0 is the symmetric quartic 6t⁴ − 8t³ + 3t² (zero derivative at
  // endpoints). Positive arg1 blends toward end-load (t⁴); negative toward
  // start-load (1 − (1 − t)⁴).
  const b = clamp(-1, 1, arg1);
  const symmetric = 6 * t * t * t * t - 8 * t * t * t + 3 * t * t;
  const endLoad = t * t * t * t;
  const startLoad = 1 - (1 - t) ** 4;
  const asymmetric = b >= 0 ? endLoad : startLoad;
  const k = Math.abs(b);
  return (1 - k) * symmetric + k * asymmetric;
}

function quarticShapeDerivative(t: number, arg1: number): number {
  const b = clamp(-1, 1, arg1);
  const symmetric = 24 * t * t * t - 24 * t * t + 6 * t;
  const endLoad = 4 * t * t * t;
  const startLoad = 4 * (1 - t) ** 3;
  const asymmetric = b >= 0 ? endLoad : startLoad;
  const k = Math.abs(b);
  return (1 - k) * symmetric + k * asymmetric;
}

function quinticShape(t: number, arg1: number): number {
  // Ken Perlin smootherstep at arg1 = 0: 6t⁵ − 15t⁴ + 10t³ (zero first and
  // second derivative at endpoints). arg1 ≠ 0 blends in an asymmetric quintic.
  const b = clamp(-1, 1, arg1);
  const symmetric = 10 * t * t * t - 15 * t * t * t * t + 6 * t * t * t * t * t;
  const asymmetric = b >= 0 ? t * t * t * t * t : 1 - (1 - t) ** 5;
  const k = Math.abs(b);
  return (1 - k) * symmetric + k * asymmetric;
}

function quinticShapeDerivative(t: number, arg1: number): number {
  const b = clamp(-1, 1, arg1);
  const symmetric = 30 * t * t - 60 * t * t * t + 30 * t * t * t * t;
  const asymmetric = b >= 0 ? 5 * t * t * t * t : 5 * (1 - t) ** 4;
  const k = Math.abs(b);
  return (1 - k) * symmetric + k * asymmetric;
}

function plateauShape(t: number, arg1: number): number {
  // arg1 ∈ [0, 1] is the fraction of length on the flat middle. Two
  // cubic-smoothstep ramps flank the plateau.
  const plateau = clamp(0, 0.99, Math.abs(arg1));
  const rampWidth = (1 - plateau) * 0.5;
  if (rampWidth <= 0) return t < 0.5 ? 0 : 1;
  if (t <= rampWidth) {
    const u = t / rampWidth;
    return 0.5 * u * u * (3 - 2 * u);
  }
  if (t >= 1 - rampWidth) {
    const u = (t - (1 - rampWidth)) / rampWidth;
    return 0.5 + 0.5 * u * u * (3 - 2 * u);
  }
  return 0.5;
}

function plateauShapeDerivative(t: number, arg1: number): number {
  const plateau = clamp(0, 0.99, Math.abs(arg1));
  const rampWidth = (1 - plateau) * 0.5;
  if (rampWidth <= 0) return 0;
  if (t <= rampWidth) {
    const u = t / rampWidth;
    return (0.5 * 6 * u * (1 - u)) / rampWidth;
  }
  if (t >= 1 - rampWidth) {
    const u = (t - (1 - rampWidth)) / rampWidth;
    return (0.5 * 6 * u * (1 - u)) / rampWidth;
  }
  return 0;
}

function toZeroShape(t: number, startValue: number, endValue: number): number {
  // Hermite curve with zero tangent at both endpoints, ideal for unwinding
  // forces back to zero at the end of a section.
  const easeOut = (1 - t) * (1 - t) * (1 + 2 * t);
  const easeIn = t * t * (3 - 2 * t);
  return startValue * easeOut + endValue * easeIn;
}

function toZeroShapeDerivative(t: number, startValue: number, endValue: number): number {
  const easeOutPrime = -6 * t * (1 - t);
  const easeInPrime = 6 * t * (1 - t);
  return startValue * easeOutPrime + endValue * easeInPrime;
}

// --- Freeform (cubic Bezier in (t, value) space) ---------------------------

type Vec2 = readonly [number, number];

const FREEFORM_NEWTON_ITERS = 8;
const FREEFORM_NEWTON_EPSILON = 1e-6;

function freeformShape(t: number, p1: Vec2, p2: Vec2): number {
  // Cubic Bezier control points in normalised `(tau, value)` space:
  //   P0 = (0, 0), P1 = p1, P2 = p2, P3 = (1, 1)
  // For input `t` in the x direction, Newton-invert x(tau) = t to find the
  // Bezier parameter, then evaluate y(tau).
  const tau = freeformInvertX(t, p1[0], p2[0]);
  return cubicBezierScalar(tau, 0, p1[1], p2[1], 1);
}

function freeformShapeDerivative(t: number, p1: Vec2, p2: Vec2): number {
  const tau = freeformInvertX(t, p1[0], p2[0]);
  const dx = cubicBezierScalarDerivative(tau, 0, p1[0], p2[0], 1);
  const dy = cubicBezierScalarDerivative(tau, 0, p1[1], p2[1], 1);
  if (Math.abs(dx) < 1e-9) return 0;
  return dy / dx;
}

function freeformInvertX(t: number, p1x: number, p2x: number): number {
  let tau = t;
  for (let i = 0; i < FREEFORM_NEWTON_ITERS; i += 1) {
    const x = cubicBezierScalar(tau, 0, p1x, p2x, 1);
    const xDelta = x - t;
    if (Math.abs(xDelta) < FREEFORM_NEWTON_EPSILON) break;
    const dx = cubicBezierScalarDerivative(tau, 0, p1x, p2x, 1);
    if (Math.abs(dx) < 1e-9) break;
    tau -= xDelta / dx;
    if (tau < 0) tau = 0;
    else if (tau > 1) tau = 1;
  }
  return tau;
}

function cubicBezierScalar(t: number, a: number, b: number, c: number, d: number): number {
  const it = 1 - t;
  return it * it * it * a + 3 * it * it * t * b + 3 * it * t * t * c + t * t * t * d;
}

function cubicBezierScalarDerivative(
  t: number,
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  const it = 1 - t;
  return 3 * it * it * (b - a) + 6 * it * t * (c - b) + 3 * t * t * (d - c);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
