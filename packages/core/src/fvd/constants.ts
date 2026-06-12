// SPDX-License-Identifier: AGPL-3.0-only
//
// Port of FVD++ physical constants. See reference/openfvd/lenassert.h:25-35
// and reference/openfvd/core/mnode.h:27 (F_HZ).
//
// Don't "modernize" any of these. Spec §21.

export const F_HZ = 1000;

// lenassert.h:35 — F_G is the FLOAT literal (9.80665f). Promoted back to
// double it is 9.806650161743164, NOT 9.80665. Confirmed by the testtrack
// byte oracle: with the float32 value the forceNormal anchor stitched into
// forced-section startValues reproduces FVD++'s saved bits exactly.
export const F_G = Math.fround(9.80665);

// secgeometric.cpp:183/345 and secbezier.cpp:115 write the bare DOUBLE
// literal 9.80665 inside `fVel = sqrt(2.f*(fEnergy - 9.80665*(...)))`,
// unlike every other energy site which uses float F_G. The asymmetry is
// FVD++'s, not ours. NOTE: matches FVD++ 0.79.
export const G_ENERGY = 9.80665;

// lenassert.h:25 — F_PI is the FLOAT literal (3.141592653589793f),
// i.e. 3.1415927410125732 as a double. We keep Math.PI here: flipping
// every F_PI site to the float32 value was measured to REGRESS the
// corpus chaotically (knife-edge integrator branches flip; see
// docs/parity-campaign.md). Revisit only with per-site evidence.
export const F_PI = Math.PI;

// lenassert.h:30/32 — TO_RAD(a) = a * F_RAD with the FLOAT constant
// F_RAD = 0.0174532925199432958f → 0.017453292384743690 as a double.
// This is a different value than Math.PI/180; using it is corpus-measured
// (geo-degree-yaw 68.6 → 66.5 mm on its own, part of the winning set).
// eslint-disable-next-line no-loss-of-precision -- mirrors the C++ literal verbatim
const F_RAD32 = Math.fround(0.0174532925199432958);

export function toRad(deg: number): number {
  return deg * F_RAD32;
}

export function toDeg(rad: number): number {
  return (rad * 180) / F_PI;
}

// `std::numeric_limits<float>::epsilon()` in C++ — the smallest representable
// difference between 1.0f and the next float. JS's `Number.EPSILON` is the
// double-precision equivalent (≈ 2.22e-16), nine orders of magnitude smaller.
// FVD uses the float32 value in several integrator tiebreakers; expose it
// here so ports stay faithful.
export const FLOAT_EPSILON = 1.1920929e-7;
