// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStyle } from './enums.js';
import { type Section } from './section.js';

// Smoothing operator between two sections. Full port lives in
// packages/core/src/smoothing/ at M6; M1 only persists the shape so user
// data (smoother placements, strengths) survives the round-trip.
export interface Smoother {
  // Indices into Track.sections identifying the boundary to smooth.
  fromSection: number;
  toSection: number;
  // Strength in [0, 1]. Detail of the iterative smoother is deferred to M6.
  strength: number;
}

// Mirrors core/track.h. Resistance and friction are per-track because
// multi-track projects (shuttles meeting at a station) may want different
// rolling-resistance profiles (T2). `style` drives rail-spine geometry.
//
// `heart` is the distance from the track's reference curve to the rider's
// heart line — the path the physics integrator follows (spec §5).
export interface Track {
  name: string;
  style: TrackStyle;
  heart: number;
  friction: number;
  resistance: number;
  sections: Section[];
  smoothers: Smoother[];
}
