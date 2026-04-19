// SPDX-License-Identifier: AGPL-3.0-only

import { type MNodeArrays } from '../model/mnode.js';
import { type Smoother } from '../model/track.js';

// Port target: openFVD `core/smoothhandler.cpp`. The original is a
// 200-line iterative smoother that blends force values across section
// boundaries so a transition from one section to the next doesn't step
// sharply. FVD++ runs two passes (normal and lateral force columns),
// each a Gaussian-weighted blur localised around every registered
// Smoother's `fromSection` boundary, repeated until the change falls
// below a tolerance.
//
// This first pass keeps the algorithm deliberately conservative: no
// tolerance-based early exit, no per-section boundary detection beyond
// what the Smoother payload carries. The goal is a shippable smoother
// you can *see* in the forces graph without spending the afternoon
// matching FVD++ 0.79 bit-for-bit — M9's goldens will drive any fine
// tuning.

// Pre-computed Gaussian weights for a window of ±KERNEL_RADIUS samples.
// Standard deviation 0.45 × radius gives a smooth rolloff without
// broadening the transition too much. 1000 Hz integration + ±45 samples
// = a ±45 ms window, which matches FVD++'s default feel.
const KERNEL_RADIUS = 45;
const KERNEL = buildGaussianKernel(KERNEL_RADIUS, 0.45);

function buildGaussianKernel(radius: number, sigmaRatio: number): Float32Array {
  const sigma = radius * sigmaRatio;
  const inv2Sigma2 = 1 / (2 * sigma * sigma);
  const length = radius * 2 + 1;
  const out = new Float32Array(length);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) * inv2Sigma2);
    out[i + radius] = w;
    sum += w;
  }
  // Normalise so Σw = 1; smoothed values share the mean of the input.
  for (let i = 0; i < length; i += 1) {
    out[i] = out[i]! / sum;
  }
  return out;
}

/**
 * Applies every registered smoother to the force columns of an already-
 * integrated MNodeArrays. Writes into `smoothNormal` / `smoothLateral`;
 * `forceNormal` / `forceLateral` stay untouched so the UI can show both
 * raw and smoothed curves.
 *
 * When no smoothers are registered, the smoothed columns are populated
 * as a copy of the raw columns so downstream consumers (graph, export)
 * can read one source of truth.
 */
export function applySmoothers(
  arrays: MNodeArrays,
  smoothers: readonly Smoother[],
  sectionStartNodes: readonly number[],
): void {
  const count = arrays.length;
  if (count === 0) return;

  // Seed with the raw force columns so anywhere outside a smoother's
  // window remains the integrator's original value.
  for (let i = 0; i < count; i += 1) {
    arrays.smoothNormal[i] = arrays.forceNormal[i]!;
    arrays.smoothLateral[i] = arrays.forceLateral[i]!;
    arrays.smoothLong[i] = arrays.forceLong[i]!;
  }

  if (smoothers.length === 0) return;

  for (const smoother of smoothers) {
    if (smoother.strength <= 0) continue;
    const boundaryNode = sectionStartNodes[smoother.toSection];
    if (boundaryNode === undefined) continue;

    // Window centred on the boundary, clipped to the valid range.
    const lo = Math.max(0, boundaryNode - KERNEL_RADIUS);
    const hi = Math.min(count - 1, boundaryNode + KERNEL_RADIUS);
    smoothWindow(arrays, lo, hi, boundaryNode, smoother.strength);
  }
}

function smoothWindow(
  arrays: MNodeArrays,
  lo: number,
  hi: number,
  centre: number,
  strength: number,
): void {
  // Blend raw + Gaussian-blurred by `strength`. strength=0 → identity,
  // strength=1 → fully blurred. Blur reads from the raw columns so the
  // result is independent of the iteration order across smoothers.
  const s = Math.min(1, Math.max(0, strength));
  for (let i = lo; i <= hi; i += 1) {
    let weightedN = 0;
    let weightedL = 0;
    let weightedLong = 0;
    let weightSum = 0;
    for (let k = -KERNEL_RADIUS; k <= KERNEL_RADIUS; k += 1) {
      const j = i + k;
      if (j < 0 || j >= arrays.length) continue;
      const w = KERNEL[k + KERNEL_RADIUS]!;
      weightedN += w * arrays.forceNormal[j]!;
      weightedL += w * arrays.forceLateral[j]!;
      weightedLong += w * arrays.forceLong[j]!;
      weightSum += w;
    }
    if (weightSum <= 0) continue;
    const blurN = weightedN / weightSum;
    const blurL = weightedL / weightSum;
    const blurLong = weightedLong / weightSum;

    // Feather the strength away from the boundary: full strength at
    // `centre`, linear roll-off to 0 at the window edges. Stops the
    // smoother from bleeding its effect into neighbouring regions.
    const d = Math.abs(i - centre);
    const edge = Math.max(hi - centre, centre - lo);
    const feather = edge > 0 ? 1 - d / edge : 1;
    const blend = s * feather;

    arrays.smoothNormal[i] = arrays.forceNormal[i]! * (1 - blend) + blurN * blend;
    arrays.smoothLateral[i] = arrays.forceLateral[i]! * (1 - blend) + blurL * blend;
    arrays.smoothLong[i] = arrays.forceLong[i]! * (1 - blend) + blurLong * blend;
  }
}
