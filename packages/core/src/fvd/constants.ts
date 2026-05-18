// SPDX-License-Identifier: AGPL-3.0-only
//
// Port of FVD++ physical constants. See reference/openfvd/core/mnode.h:27
// (F_HZ) and the inline literals 9.80665 / 0.9f scattered through the
// section sources (search for "0.9f" across reference/openfvd/core/).
//
// Don't "modernize" any of these. Spec §21.

export const F_HZ = 1000;
export const F_G = 9.80665;
export const F_PI = Math.PI;

export function toRad(deg: number): number {
  return (deg * F_PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / F_PI;
}
