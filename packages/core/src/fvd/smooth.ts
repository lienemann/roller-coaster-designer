// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/ui/smoothui.cpp's roll-speed smoother
// (`applyRollSmoothFilter` + `applyRollSmooth`) and the supporting
// `track::applySmooth` / `track::removeSmooth` pair from
// reference/openfvd/core/track.cpp.
//
// What it does: each `SmoothHandler` describes a node range with a box
// kernel of width `length` and `iterations` passes. We blend the
// `fRollSpeed + fSmoothSpeed` series toward a constant within the
// handler's range — adjusting `fSmoothSpeed` only — so the rider's
// roll rate becomes locally flat across a section boundary. Then
// `applySmooth` re-integrates each node's roll by `temp += fSmoothSpeed`
// and calls `setRoll(temp/F_HZ)` per node, plus refreshes the
// heart-line distance fields.
//
// The reason this lives outside `track.ts` (where FVD keeps its
// `track::applySmooth`) is that FVD's `smoothUi` owns the filter and
// holds a `track*`. Splitting along that boundary keeps `track.ts`
// integrator-focused.

import { F_HZ } from './constants.js';
import { vec3Distance } from './fvec.js';
import { type Track } from './track.js';

// smoothui.cpp:121 — the inner per-handler filter. Mutates
// `fSmoothSpeed` on the nodes between `handler.from` and `handler.to`.
// Returns nothing; caller invokes `applySmooth` afterwards.
export function applyRollSmoothFilter(
  track: Track,
  handler: { from: number; to: number; length: number; iterations: number },
): void {
  const iter = handler.iterations;
  const length = Math.floor(handler.length / iter);
  const fromNode = handler.from;
  const toNode = handler.to;

  // smoothui.cpp:137 — bail if the window doesn't fit.
  if (toNode - fromNode - Math.floor((length / 2) * iter) < 0) return;

  // smoothui.cpp:142-150 — averaged start / end values that the filter
  // anchors to outside the kernel-radius transition zones.
  let lastValue = 0;
  let firstValue = 0;
  const halfLenIter = Math.floor((length / 2) * iter);
  for (let i = 0; i <= halfLenIter; i++) {
    const lastNode = track.getPoint(toNode - i);
    lastValue += lastNode.fRollSpeed + lastNode.fSmoothSpeed;
    const firstNode = track.getPoint(fromNode + i);
    firstValue += firstNode.fRollSpeed + firstNode.fSmoothSpeed;
  }
  lastValue /= halfLenIter + 1;
  firstValue /= halfLenIter + 1;

  // smoothui.cpp:152-204 — build the initial `cur`/`last`/`orig`
  // arrays. Inside the kernel-radius zone we anchor to first/last
  // value; outside we blend per-vertex via the exp(-2t²) lead-in/out.
  const cur: number[] = [];
  const last: number[] = [];
  const orig: number[] = [];
  for (let i = fromNode; i < toNode; i++) {
    if (length === 0) {
      const node = track.getPoint(i);
      const v = node.fRollSpeed + node.fSmoothSpeed;
      cur.push(v);
      last.push(v);
      orig.push(v);
      continue;
    }
    const halfLen = (length / 2) * iter;
    let t1 = (i - fromNode - halfLen) / halfLen;
    let t2 = (toNode - halfLen - i) / halfLen;
    if (t1 < 0) t1 = 1;
    else t1 = Math.exp(-2 * t1 * t1);
    if (t2 < 0) t2 = 1;
    else t2 = Math.exp(-2 * t2 * t2);
    let t = (1 - t1) * (1 - t2);
    if (Number.isNaN(t)) t = 0;

    // smoothui.cpp:169-193 — re-normalise so the three weights still
    // sum to 1 after clamping the largest one. FVD has a sign-of-t1/t2
    // branch tree; preserved verbatim.
    const eps = Number.EPSILON;
    if (t2 > t1) {
      if (t > t2) {
        if (Math.abs(t1 + t2) > eps) {
          t2 = (t2 / (t1 + t2)) * (1 - t);
          t1 = (t1 / (t1 + t2)) * (1 - t);
        }
      } else {
        if (Math.abs(t1 + t) > eps) {
          t = (t / (t1 + t)) * (1 - t2);
          t1 = (t1 / (t1 + t)) * (1 - t2);
        }
      }
    } else {
      if (t > t1) {
        if (Math.abs(t1 + t2) > eps) {
          t2 = (t2 / (t1 + t2)) * (1 - t);
          t1 = (t1 / (t1 + t2)) * (1 - t);
        }
      } else {
        if (Math.abs(t + t2) > eps) {
          t = (t / (t2 + t)) * (1 - t1);
          t2 = (t2 / (t2 + t)) * (1 - t1);
        }
      }
    }

    let value: number;
    if (i < fromNode + halfLen) {
      value = firstValue;
    } else if (i > toNode - halfLen) {
      value = lastValue;
    } else {
      const node = track.getPoint(i);
      value = t * (node.fRollSpeed + node.fSmoothSpeed) + t1 * firstValue + t2 * lastValue;
    }
    cur.push(value);
    last.push(value);
    orig.push(value);
  }

  // smoothui.cpp:206-225 — iterative box filter over the windowed series.
  for (let iterations = 0; iterations < iter; iterations++) {
    // Swap roles: previous `cur` becomes the read buffer for this pass.
    for (let k = 0; k < cur.length; k++) last[k] = cur[k]!;
    for (let i = 0; i < cur.length; i++) {
      let temp = 0;
      let div = 0;
      for (let j = -Math.floor(length / 2); j <= Math.floor(length / 2); j++) {
        const k = i + j;
        if (k < 0) {
          temp += last[0]!;
        } else if (k >= last.length) {
          temp += last[last.length - 1]!;
        } else {
          temp += last[k]!;
        }
        div = Math.floor(length / 2) * 2 + 1;
      }
      cur[i] = temp / (div || 1);
    }
  }

  // smoothui.cpp:227-233 — fold the delta into each node's
  // `fSmoothSpeed`. Note `+= adjustValues` (additive) — multiple
  // handlers overlapping accumulate.
  for (let i = 0; i < cur.length; i++) {
    const adjust = cur[i]! - orig[i]!;
    track.getPoint(i + fromNode).fSmoothSpeed += adjust;
  }
}

// track.cpp:120 — undoes the previous smoothing pass by reversing
// `setRoll(temp/F_HZ)` and clearing each node's `fSmoothSpeed`.
// Called before re-running the filters so `fSmoothSpeed` doesn't
// double-accumulate.
export function removeSmooth(track: Track, fromNode: number): void {
  if (track.smoothedUntil === fromNode) return;
  if (fromNode < 0) fromNode = 0;
  track.smoothedUntil = fromNode;
  let temp = 0;
  let curNode = track.anchorNode;
  let localFromNode = fromNode;
  for (let i = 0; i < track.lSections.length; i++) {
    const curSection = track.lSections[i]!;
    if (localFromNode >= curSection.lNodes.length && curSection.lNodes.length > 1) {
      localFromNode -= curSection.lNodes.length - 1;
      continue;
    }
    if (localFromNode !== 0) curNode = curSection.lNodes[localFromNode - 1]!;
    else if (i !== 0) {
      const prev = track.lSections[i - 1]!;
      curNode = prev.lNodes[prev.lNodes.length - 1]!;
    } else curNode = track.anchorNode;
    for (let j = localFromNode; j < curSection.lNodes.length; j++) {
      const prevNode = curNode;
      curNode = curSection.lNodes[j]!;
      if (Math.abs(curNode.fSmoothSpeed) > 0) {
        temp -= curNode.fSmoothSpeed;
        curNode.setRoll(temp / F_HZ);
        curNode.smoothNormal = 0;
        curNode.smoothLateral = 0;
        curNode.fSmoothSpeed = 0;
        curNode.fDistFromLast = vec3Distance(
          curNode.vPosHeart(track.fHeart),
          prevNode.vPosHeart(track.fHeart),
        );
        curNode.fTotalLength = prevNode.fTotalLength + curNode.fDistFromLast;
      }
    }
    localFromNode = 1;
  }
}

// track.cpp:157 — re-applies previously-deposited `fSmoothSpeed` to
// each node's roll, refreshing distance fields and smoothed-force
// numbers as it goes.
export function applySmooth(track: Track, fromNode: number): void {
  if (fromNode < 0) fromNode = 0;
  if (track.smoothedUntil !== fromNode) return;
  track.smoothedUntil = track.getNumPoints();
  let temp = 0;
  let curNode = track.anchorNode;
  let localFromNode = fromNode;
  for (let i = 0; i < track.lSections.length; i++) {
    const curSection = track.lSections[i]!;
    if (localFromNode >= curSection.lNodes.length && curSection.lNodes.length > 1) {
      localFromNode -= curSection.lNodes.length - 1;
      continue;
    }
    if (localFromNode !== 0) curNode = curSection.lNodes[localFromNode - 1]!;
    else if (i !== 0) {
      const prev = track.lSections[i - 1]!;
      curNode = prev.lNodes[prev.lNodes.length - 1]!;
    } else curNode = track.anchorNode;
    for (let j = localFromNode; j < curSection.lNodes.length; j++) {
      const prevNode = curNode;
      curNode = curSection.lNodes[j]!;
      if (Math.abs(curNode.fSmoothSpeed) > 0) {
        temp += curNode.fSmoothSpeed;
        curNode.setRoll(temp / F_HZ);
        curNode.calcSmoothForces();
        curNode.fDistFromLast = vec3Distance(
          curNode.vPosHeart(track.fHeart),
          prevNode.vPosHeart(track.fHeart),
        );
        curNode.fTotalLength = prevNode.fTotalLength + curNode.fDistFromLast;
      }
    }
    localFromNode = 1;
  }
}

// smoothui.cpp:82 — the public entry point. Clears all `fSmoothSpeed`
// from `fromNode` onward, runs each active handler's filter, then
// re-applies via `applySmooth`. Safe to call whether or not smoothers
// are active — no-op when `smoothHandlers` has no active entry.
export function applyRollSmooth(track: Track, fromNode = 0): void {
  removeSmooth(track, fromNode);
  if (track.anchorNode) track.anchorNode.fRollSpeed = 0;

  // smoothui.cpp:88-102 — zero the `fSmoothSpeed` of every node from
  // `fromNode` onward (defensive — `removeSmooth` already does this,
  // but FVD repeats the loop to be sure).
  let curNode = fromNode < 0 ? 0 : fromNode;
  let secIndex = 0;
  for (; secIndex < track.lSections.length; secIndex++) {
    if (track.lSections[secIndex]!.lNodes.length >= curNode) break;
    curNode -= track.lSections[secIndex]!.lNodes.length - 1;
  }
  for (; secIndex < track.lSections.length; secIndex++) {
    const sec = track.lSections[secIndex]!;
    for (let i = curNode; i < sec.lNodes.length; i++) {
      sec.lNodes[i]!.fSmoothSpeed = 0;
    }
    curNode = 0;
  }

  // smoothui.cpp:104-111 — run each active handler whose window
  // reaches past `fromNode`.
  let anyActive = false;
  for (const h of track.smoothHandlers) {
    if (!h.active) continue;
    if (h.to > fromNode) {
      anyActive = true;
      applyRollSmoothFilter(track, h);
    }
  }

  if (anyActive) {
    applySmooth(track, fromNode);
  }
}
