// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/function.h and function.cpp.
//
// `Func` owns an ordered list of `Subfunc` pieces that tile the parameter
// space [0, maxArgument]. Operations mutate the list (lock/unlock,
// changeLength) and propagate downstream — translate every subsequent piece
// so its startValue matches the previous piece's endValue.

import { r } from './fvec.js';
import type { Section } from './section.js';
import { Subfunc, EFunctype } from './subfunction.js';

export { EFunctype };

export class Func {
  funcList: Subfunc[] = [];
  activeSubfunc = -1;
  readonly type: EFunctype;
  readonly secParent: Section;
  private startValue: number;

  // function.cpp:33
  constructor(min: number, max: number, start: number, end: number, parent: Section, type: EFunctype) {
    this.type = type;
    this.secParent = parent;
    this.startValue = start;
    this.funcList.push(new Subfunc(min, max, start, end - start, this));
  }

  // function.cpp:39 — `float func::getValue(float x)` lives in its own
  // translation unit, so the caller's extended-precision argument rounds
  // to float32 when it's passed on the i686 stack. The `maxArgument >= x`
  // comparison below is a knife-edge that decides which subfunc evaluates
  // near piece boundaries.
  getValue(x: number): number {
    x = r(x);
    let cur: Subfunc | null = null;
    for (const s of this.funcList) {
      cur = s;
      if (s.maxArgument >= x) break;
    }
    if (!cur) {
      throw new Error('Func.getValue: empty funcList');
    }
    return cur.getValue(x);
  }

  getMaxArgument(): number {
    return this.funcList[this.funcList.length - 1]!.maxArgument;
  }

  // function.cpp:57
  appendSubFunction(length: number, i = -1): void {
    let temp: Subfunc;
    if (i === -1) {
      const index = this.funcList.length;
      if (index === 0) {
        temp = new Subfunc(0, 1, this.startValue, 0, this);
      } else {
        const prev = this.funcList[0]!;
        temp = new Subfunc(0, length, prev.startValue, 0, this);
      }
      this.funcList.unshift(temp);
      this.activeSubfunc = index;
    } else {
      const pred = this.funcList[i]!;
      const ns = new Subfunc(pred.maxArgument, pred.maxArgument + length, pred.endValue(), 0, this);
      this.funcList.splice(i + 1, 0, ns);
      this.activeSubfunc = i + 1;
    }
    for (let k = 1; k < this.funcList.length; k++) {
      const prev = this.funcList[k - 1]!;
      const cur = this.funcList[k]!;
      cur.update(prev.maxArgument, prev.maxArgument + cur.maxArgument - cur.minArgument, cur.symArg);
    }
  }

  removeSubFunction(i = -1): void {
    if (this.funcList.length <= 1) return;
    const idx = i === -1 ? this.activeSubfunc : i;
    this.funcList.splice(idx, 1);
    let k = idx;
    if (k === 0) {
      const cur = this.funcList[0]!;
      cur.update(0, cur.maxArgument - cur.minArgument, cur.symArg);
      k = 1;
    }
    for (; k < this.funcList.length; k++) {
      const prev = this.funcList[k - 1]!;
      const cur = this.funcList[k]!;
      this.translateValues(prev);
      cur.update(prev.maxArgument, prev.maxArgument + cur.maxArgument - cur.minArgument, cur.symArg);
    }
  }

  setMaxArgument(newMax: number): void {
    const scale = newMax / this.getMaxArgument();
    for (const cur of this.funcList) {
      cur.update(cur.minArgument * scale, cur.maxArgument * scale, cur.symArg);
    }
  }

  // function.cpp:117 — Stitch subsequent subfuncs so their startValue
  // tracks the previous subfunc's endValue. Called when one piece's
  // shape changes.
  translateValues(caller: Subfunc): void {
    let i = 0;
    let cur: Subfunc | null = null;
    while (i < this.funcList.length) {
      cur = this.funcList[i++]!;
      if (cur === caller) break;
    }
    for (; i < this.funcList.length; i++) {
      const prev = cur!;
      cur = this.funcList[i]!;
      cur.translateValues(prev.endValue());
    }
  }

  // function.cpp:133
  changeLength(newLength: number, index: number): number {
    let cur = this.funcList[index]!;
    cur.update(cur.minArgument, cur.minArgument + newLength, cur.symArg);
    for (let k = index + 1; k < this.funcList.length; k++) {
      const prev = cur;
      cur = this.funcList[k]!;
      if (cur.locked) {
        cur.update(prev.maxArgument, this.secParent.getMaxArgument(), cur.symArg);
      } else {
        cur.update(prev.maxArgument, prev.maxArgument + cur.maxArgument - cur.minArgument, cur.symArg);
      }
    }
    return this.getMaxArgument();
  }

  getSubfuncNumber(s: Subfunc): number {
    const i = this.funcList.indexOf(s);
    if (i < 0) throw new Error('invalid subfunc');
    return i;
  }

  // function.cpp:247 — same float-parameter call boundary as getValue.
  getSubfunc(x: number): Subfunc {
    x = r(x);
    let cur: Subfunc | null = null;
    for (const s of this.funcList) {
      cur = s;
      if (s.maxArgument >= x) break;
    }
    if (!cur) throw new Error('Func.getSubfunc: empty');
    return cur;
  }

  unlock(id: number): boolean {
    this.funcList[id]!.locked = false;
    return true;
  }

  lock(id: number): boolean {
    this.funcList[id]!.locked = true;
    return true;
  }

  lockedFunc(): number {
    for (let i = 0; i < this.funcList.length; i++) {
      if (this.funcList[i]!.locked) return i;
    }
    return -1;
  }
}
