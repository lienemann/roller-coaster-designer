// SPDX-License-Identifier: AGPL-3.0-only

import { type TrackStyle } from './enums.js';
import { type Section } from './section.js';

// Smoothing operator between two sections. Full port lives in
// packages/core/src/smoothing/. Our smoothing pass consumes
// (fromSection, toSection, strength); the `fvd` sub-record preserves
// FVD++'s on-disk shape (name + node indices + iterations + active) so a
// `.fvd` round-trip is lossless even though the apply path is index-driven.
export interface Smoother {
  // Indices into Track.sections identifying the boundary to smooth.
  fromSection: number;
  toSection: number;
  // Strength in [0, 1]. Detail of the iterative smoother is in §5.3.
  strength: number;
  /** Verbatim FVD++ disk fields. Populated by the `.fvd` reader and
   *  written back by the `.fvd` writer; the JSON format also persists
   *  them so the legacy round-trip is lossless even without re-running
   *  the integrator at load time. */
  fvd?:
    | {
        name: string;
        fromNode: number;
        toNode: number;
        length: number;
        iterations: number;
        active: boolean;
      }
    | undefined;
}

/** UI state for the track that FVD++ persists in the file header but we
 *  don't use functionally. Preserved opaquely so a `.fvd` round-trip
 *  doesn't lose the user's drawTrack / wireframe / pov / colour choices.
 *  The 48-byte QColor blob is stored as a lowercase hex string for JSON
 *  compactness. */
export interface FvdTrackDisplay {
  /** 48 bytes of Qt-internal QColor data, hex-encoded (96 chars). */
  colorsHex?: string | undefined;
  drawTrack?: boolean | undefined;
  drawHeartline?: number | undefined;
  isWireframe?: boolean | undefined;
  povPos?: [number, number] | undefined;
  /** FVD++ stores per-section velocity-mode display values on the anchor
   *  (forceNormal, forceLateral) too; these are pure UI hints, but we
   *  keep them so a write-read-write cycle is identical. */
  anchorForceNormal?: number | undefined;
  anchorForceLateral?: number | undefined;
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
  /** FVD++ display state preserved opaquely for `.fvd` round-trip. Empty
   *  on tracks the user authored in-app; populated by the `.fvd` reader. */
  fvdDisplay?: FvdTrackDisplay | undefined;
}
