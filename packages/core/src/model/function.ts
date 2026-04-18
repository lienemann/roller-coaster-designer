// SPDX-License-Identifier: GPL-3.0-only

import { type EFuncType } from './enums.js';
import { type SubFunc } from './subfunction.js';

// Mirrors core/function.h. A Func is a time- or distance-indexed scalar made
// of contiguous SubFunc transitions. A Straight section carries one Roll
// Func; a Forced section carries three (Roll, Normal, Lateral). A Geometric
// section carries Roll, Pitch, Yaw.
//
// `locked` reproduces FVD++'s lock flag: a locked Func keeps its endpoint
// values when the user edits a neighbouring SubFunc, so rolling one transition
// doesn't cascade through the whole track.

export interface Func {
  kind: EFuncType;
  name: string;
  locked: boolean;
  subfuncs: SubFunc[];
}

export function createEmptyFunc(kind: EFuncType, name?: string): Func {
  return {
    kind,
    name: name ?? '',
    locked: false,
    subfuncs: [],
  };
}

export function totalFuncLength(func: Func): number {
  let total = 0;
  for (const sf of func.subfuncs) {
    total += sf.length;
  }
  return total;
}
