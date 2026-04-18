// SPDX-License-Identifier: GPL-3.0-only

// Physical constants ported from FVD++ core. Changing any of these changes the
// node stream bit-for-bit, which means goldens break and NL2 export diverges.
// Don't "modernize" (see spec §21).

// Integration rate: 1000 Hz. Every MNode is exactly 1 ms of wall-clock time.
export const F_HZ = 1000.0;

// Gravity. Matches FVD++ and NL2 — both use 9.80665 exactly. Any other value
// drifts the energy integral and breaks byte-for-byte NL2 export.
export const F_G = 9.80665;

export const F_PI = Math.PI;

// Heart offset used inside the energy calculation only: FVD++ uses 0.9×heart
// instead of the full heart line (see track.cpp:50). Intentional; spec §21
// says don't fix it.
export const HEART_ENERGY_FACTOR = 0.9;
