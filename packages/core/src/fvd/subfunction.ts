// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/subfunction.h and subfunction.cpp.
//
// `Subfunc` is a stateful evaluator: when `locked` is set, calling
// `getValue()` mutates its `maxArgument` by calling `parent.changeLength(...)`.
// We preserve that exactly. Parent linkage is by reference (TS objects); FVD
// uses raw pointers and assumes parent != null. Same here.

import { F_HZ, F_PI } from './constants.js';
import type { Func } from './func.js';
import { r } from './fvec.js';
import type { MNode } from './mnode.js';

export enum EDegree {
  Linear = 0,
  Quadratic = 1,
  Cubic = 2,
  Quartic = 3,
  Quintic = 4,
  Sinusoidal = 5,
  Plateau = 6,
  ToZero = 7,
  Freeform = 8,
}

export interface BezPoint {
  x: number;
  y: number;
}

// Free helpers — quadratic/cubic Bézier-style interpolation. Used by Freeform.
function interp2(t: number, x1: number, x2: number, x3: number): number {
  const t1 = 1 - t;
  return t1 * t1 * x1 + 2 * t * t1 * x2 + t * t * x3;
}

function interp3(t: number, x1: number, x2: number, x3: number, x4: number): number {
  const t1 = 1 - t;
  return t1 * t1 * t1 * x1 + 3 * t * t1 * t1 * x2 + 3 * t * t * t1 * x3 + t * t * t * x4;
}

export class Subfunc {
  minArgument = 0;
  maxArgument = 0;
  startValue = 0;
  arg1 = 0;
  symArg = 0;
  centerArg = 0;
  tensionArg = 0;
  locked = false;
  degree: EDegree = EDegree.Cubic;

  // Parent is `Func`; circular type, so we keep it loose at runtime.
  // FVD asserts parent != null in the ctor; same expectation here.
  parent: Func;

  pointList: BezPoint[] = [];
  valueList: number[] = [];

  constructor(min: number, max: number, start: number, diff: number, parent: Func) {
    this.minArgument = r(min);
    this.maxArgument = r(max);
    this.centerArg = 0;
    this.tensionArg = 0;
    this.symArg = r(diff);
    this.startValue = r(start);
    this.parent = parent;

    // subfunction.cpp:64: roll-func subfuncs default to cubic; force/pitch/yaw
    // default to quartic.
    if (parent.type === EFunctype.FuncNormal) {
      this.changeDegree(EDegree.Cubic);
    } else {
      this.changeDegree(EDegree.Quartic);
    }
    this.locked = false;
  }

  // subfunction.cpp:72
  update(min: number, max: number, diff: number): void {
    this.minArgument = r(min);
    this.maxArgument = r(max);
    this.symArg = r(diff);
    this.parent.translateValues(this);
  }

  // subfunction.cpp:82 — bezier prebake for Freeform.
  updateBez(): void {
    this.valueList = [];
    let t = 0;
    let nextT = 0;
    for (let i = 0; i < 100; i++) {
      nextT += 0.01;
      this.valueList.push(interp3(t, 0, this.pointList[0]!.y, this.pointList[1]!.y, 1));
      const gotT = interp3(t, 0, this.pointList[0]!.x, this.pointList[1]!.x, 1);
      t +=
        (nextT - gotT) /
        (3 * interp2(t, this.pointList[0]!.x, this.pointList[1]!.x - this.pointList[0]!.x, 1 - this.pointList[1]!.x));
    }
    this.valueList.push(1);
  }

  // subfunction.cpp:99
  changeDegree(newDegree: EDegree): void {
    this.degree = newDegree;
    switch (newDegree) {
      case EDegree.Linear:
      case EDegree.Quadratic:
      case EDegree.Cubic:
      case EDegree.Sinusoidal:
        break;
      case EDegree.Quartic:
        this.arg1 = -10;
        break;
      case EDegree.Quintic:
        this.arg1 = 0;
        break;
      case EDegree.Plateau:
        this.arg1 = 1;
        break;
      case EDegree.Freeform:
        this.pointList = [
          { x: 0.3, y: 0.0 },
          { x: 0.7, y: 1.0 },
        ];
        this.updateBez();
        break;
      case EDegree.ToZero:
        this.centerArg = 0;
        this.tensionArg = 0;
        this.symArg = -this.startValue;
        break;
      default:
        throw new Error(`unknown degree ${String(newDegree)}`);
    }
  }

  // subfunction.cpp:144 — the hot path. Called millions of times by the
  // integrator. We preserve every quirk including the `locked` side effect
  // and the silent clamp on out-of-range x.
  getValue(x: number): number {
    if (this.locked) {
      // changeLength mutates the parent func chain; this can resize *this*
      // subfunc as well. See function.cpp:133.
      this.parent.changeLength(
        this.parent.secParent.getMaxArgument() - this.minArgument,
        this.parent.getSubfuncNumber(this),
      );
    } else if (x > this.maxArgument) {
      x = this.maxArgument;
    } else if (x < this.minArgument) {
      x = this.minArgument;
    }

    x = (x - this.minArgument) / (this.maxArgument - this.minArgument);
    x = this.applyCenter(x);
    x = this.applyTension(x);

    switch (this.degree) {
      case EDegree.Linear:
        return this.symArg * x + this.startValue;
      case EDegree.Quadratic:
        if (this.isSymmetric()) {
          const xs = 2 * x - 1;
          return this.symArg * (1 - xs * xs) + this.startValue;
        } else if (this.arg1 < 0) {
          return this.symArg * (1 - (1 - x) * (1 - x)) + this.startValue;
        } else {
          return this.symArg * x * x + this.startValue;
        }
      case EDegree.Cubic:
        return this.symArg * x * x * (3 + x * -2) + this.startValue;
      case EDegree.Quartic: {
        if (!this.isSymmetric()) {
          const sym = this.symArg;
          const a1 = this.arg1;
          const denom = 1 - 2 * a1;
          return (
            x *
              x *
              (-(6 * sym * a1) / denom +
                x * ((sym * (4 * a1 + 4)) / denom + x * (-3 * sym / denom))) +
            this.startValue
          );
        } else {
          return this.symArg * x * x * (16 + x * (-32 + x * 16)) + this.startValue;
        }
      }
      case EDegree.Quintic: {
        if (Math.abs(this.arg1) < 0.005) {
          return this.symArg * x * x * x * (10 + x * (-15 + x * 6)) + this.startValue;
        } else if (this.arg1 < 0) {
          const a = Math.abs(this.arg1 / 10);
          const root = -Math.sqrt(9 + a * (-16 + 16 * a));
          const max =
            0.01728 +
            0.00576 * root +
            a *
              (-0.0288 -
                0.00448 * root +
                a *
                  (0.0032 -
                    0.00576 * root +
                    a *
                      (-0.0704 +
                        0.02048 * root +
                        a * (0.1024 - 0.01024 * root + (this.arg1 / 10) * 0.04096))));
          return (this.symArg / max) * x * x * (x - 1) * (x - 1) * (x + this.arg1 / 10) + this.startValue;
        } else {
          const a = this.arg1 / 10;
          const root = Math.sqrt(9 + a * (-16 + 16 * a));
          const max =
            0.01728 +
            0.00576 * root +
            a *
              (-0.0288 -
                0.00448 * root +
                a *
                  (0.0032 -
                    0.00576 * root +
                    a *
                      (-0.0704 +
                        0.02048 * root +
                        a * (0.1024 - 0.01024 * root - a * 0.04096))));
          return (this.symArg / max) * x * x * (x - 1) * (x - 1) * (x - a) + this.startValue;
        }
      }
      case EDegree.Sinusoidal:
        return 0.5 * this.symArg * (1 - Math.cos(F_PI * x)) + this.startValue;
      case EDegree.Plateau: {
        return (
          this.symArg *
            (1 - Math.exp(-this.arg1 * 15 * Math.pow(1 - Math.abs(2 * x - 1), 3))) +
          this.startValue
        );
      }
      case EDegree.Freeform: {
        // FVD's getValue does no bounds check (subfunction.cpp:228). On
        // a freshly-loaded Freeform subfunc valueList is empty (the
        // wire format omits pointList) so every read is QList OOB —
        // QList<float> returns 0 in that case, and the evaluator
        // effectively returns startValue. Match that behavior here:
        // missing valueList entries read as 0.
        let root = x * (this.valueList.length - 2);
        const max = Math.floor(root) + 0.01;
        root = root - Math.floor(root);
        const v0 = this.valueList[max | 0] ?? 0;
        if ((max | 0) === this.valueList.length - 1) {
          return root * this.symArg * v0 + this.startValue;
        } else {
          const v1 = this.valueList[(max | 0) + 1] ?? 0;
          return (1 - root) * this.symArg * v0 + root * this.symArg * v1 + this.startValue;
        }
      }
      case EDegree.ToZero: {
        // subfunction.cpp:242 — this branch reads two adjacent mnodes from
        // the parent track via getPoint(). The polynomial coefficients are
        // derived to land at zero at maxArgument.
        const sec = this.parent.secParent;
        const inTrack = sec.parent;
        const baseIdx = inTrack.getNumPoints(sec) + this.minArgument * 1000;
        const curNode: MNode = inTrack.getPoint(Math.floor(baseIdx - 0.5));
        const prevNode: MNode = inTrack.getPoint(Math.floor(baseIdx - 1.5));
        const isEuler = sec.bOrientation === true; // EULER==true in FVD
        let d: number;
        let e: number;
        if (isEuler) {
          d =
            (curNode.fRollSpeed +
              dotDownY(curNode) * curNode.fYawFromLast -
              prevNode.fRollSpeed -
              dotDownY(prevNode) * prevNode.fYawFromLast) *
            F_HZ;
          e = this.startValue;
        } else {
          d =
            (curNode.fRollSpeed +
              dotDownY(curNode) * curNode.fYawFromLast -
              prevNode.fRollSpeed -
              dotDownY(prevNode) * prevNode.fYawFromLast) *
            F_HZ;
          e = -dotDownY(curNode) * curNode.fYawFromLast * F_HZ;
          e += this.startValue;
        }
        this.arg1 = -curNode.fRoll / (this.maxArgument - this.minArgument);
        const a1 = this.arg1;
        const aPoly = -2.5 * (d + 6 * (e - 2 * a1));
        const bPoly = 6 * d + 32 * e - 60 * a1;
        const cPoly = -d * 4.5 - 18 * e + 30 * a1;
        return x * (d + x * (cPoly + x * (bPoly + x * aPoly))) + e;
      }
      default:
        throw new Error('unknown degree');
    }
  }

  // subfunction.cpp:271
  getMinValue(): number {
    return this.startValue < this.endValue() ? this.startValue : this.endValue();
  }

  // subfunction.cpp:276
  getMaxValue(): number {
    return this.startValue > this.endValue() ? this.startValue : this.endValue();
  }

  // subfunction.cpp:282
  translateValues(newStart: number): void {
    this.startValue = r(newStart);
    if (this.degree === EDegree.ToZero) {
      this.symArg = -this.startValue;
    }
  }

  // subfunction.cpp:290
  isSymmetric(): boolean {
    if (this.degree === EDegree.Quadratic && Math.abs(this.arg1) < 0.5) return true;
    if (this.degree === EDegree.Quartic && this.arg1 < 0) return true;
    if (this.degree === EDegree.Quintic && Math.abs(this.arg1) > 0.005) return true;
    if (this.degree === EDegree.Plateau) return true;
    return false;
  }

  // subfunction.cpp:405
  endValue(): number {
    return this.isSymmetric() ? this.startValue : this.startValue + this.symArg;
  }

  // subfunction.cpp:369
  private applyTension(x: number): number {
    if (Math.abs(this.tensionArg) < 0.0005) {
      return x;
    } else if (this.tensionArg > 0) {
      let v = 2 * this.tensionArg * (x - 0.5);
      v = Math.sinh(v) / Math.sinh(this.tensionArg);
      return 0.5 * (v + 1);
    } else {
      let v = 2 * Math.sinh(this.tensionArg) * (x - 0.5);
      v = Math.asinh(v) / this.tensionArg;
      return 0.5 * (v + 1);
    }
  }

  // subfunction.cpp:390
  private applyCenter(x: number): number {
    if (this.centerArg > 0) {
      return Math.pow(x, Math.pow(2, this.centerArg / 2));
    } else if (this.centerArg < 0) {
      return 1 - Math.pow(1 - x, Math.pow(2, -this.centerArg / 2));
    }
    return x;
  }
}

// Pulled in here because both Subfunc and Func reference the enum.
export enum EFunctype {
  FuncRoll = 0,
  FuncNormal = 1,
  FuncLateral = 2,
  FuncPitch = 3,
  FuncYaw = 4,
}

// Helper: dot(node.vDir, (0,-1,0)) — used in the ToZero branch.
function dotDownY(node: MNode): number {
  return -node.vDir.y;
}
