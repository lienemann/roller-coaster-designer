// SPDX-License-Identifier: AGPL-3.0-only

import { type Argument, type Orientation, SecType } from './enums.js';
import { type Func } from './function.js';

// Port target: core/section.h plus the six subclass headers (secstraight,
// seccurved, secforced, secgeometric, secbezier, secnlcsv). Spec §4.3 calls
// for a discriminated union on SecType rather than C++ class inheritance, so
// each variant below is its own interface and `integrate(section, ...)`
// switches on `section.type` instead of virtual dispatch.
//
// M1 fully defines the fields required for JSON round-tripping of the six
// section types. The integrator functions land in the milestones listed next
// to each interface below; this file is pure shape.

interface SectionBase {
  name: string;
  /**
   * Optional UI colour for this section, `#rrggbb`. Used to tint rails in
   * the viewport and mark section boundaries in the graph so the two stay
   * in sync visually. When omitted, the app falls back to a palette-indexed
   * default — nothing physical depends on this field.
   */
  color?: string | undefined;
}

// Anchor — starting pose of a track. Always the first section.
// Integrator: trivial (M2).
export interface AnchorSection extends SectionBase {
  type: SecType.Anchor;
  position: [number, number, number];
  // Heading and bank at the anchor, radians.
  pitch: number;
  yaw: number;
  roll: number;
  // Speed at the anchor (m/s along the heart path).
  speed: number;
}

// Straight — constant direction for `length` meters; roll evolves via rollFunc.
// Integrator: M2 (spec §5.1 Straight row).
export interface StraightSection extends SectionBase {
  type: SecType.Straight;
  length: number;
  rollFunc: Func;
}

// Curved — constant pitch and yaw rates, roll via rollFunc. Integrator: M3.
export interface CurvedSection extends SectionBase {
  type: SecType.Curved;
  length: number;
  pitchRate: number;
  yawRate: number;
  leadIn: number;
  leadOut: number;
  rollFunc: Func;
}

// Forced — force-driven. Normal and Lateral funcs shape the geometry; the
// integrator is the reference implementation (spec §5). Integrator: M4.
export interface ForcedSection extends SectionBase {
  type: SecType.Forced;
  argument: Argument;
  orientation: Orientation;
  // Section duration: seconds when argument=Time, meters when argument=Distance.
  extent: number;
  rollFunc: Func;
  normalFunc: Func;
  lateralFunc: Func;
}

// Geometric — like Forced but pitch/yaw are prescribed directly instead of
// computed from forces. Integrator: M5.
export interface GeometricSection extends SectionBase {
  type: SecType.Geometric;
  argument: Argument;
  extent: number;
  rollFunc: Func;
  pitchFunc: Func;
  yawFunc: Func;
}

// Bezier — a cubic Bezier reparameterized to arc length. Four control points
// in world coordinates plus a roll function. Integrator: M5.
export interface BezierSection extends SectionBase {
  type: SecType.Bezier;
  controlPoints: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  rollFunc: Func;
  // FVD++ option flags surfaced at the UI: whether the start/end tangents
  // should blend smoothly into neighbouring sections.
  smoothStart: boolean;
  smoothEnd: boolean;
}

// Closure — end-of-track segment whose four cubic-Bezier control points are
// fully derived from the previous section's end pose and the track anchor's
// pose. The integrator recomputes p0..p3 every recompute, so an upstream
// edit shifts the closure with the rest of the geometry — no manual fix-up.
//
// Constraints (enforced by `Track`'s zod schema and by `addSection` ops):
//   - At most one Closure per track.
//   - If present, it must be the last section.
//
// On export to legacy `.fvd` (M9 writer) a Closure is materialised as a
// regular `BEZ` section using the effective control points; FVD++ has no
// closure concept.
export interface ClosureSection extends SectionBase {
  type: SecType.Closure;
  /** Distance along the previous section's end direction for the entry
   *  handle (Bezier p1). Default ≈ gap / 3 with a tangent-divergence bonus. */
  entryHandleLength: number;
  /** Distance behind the anchor along the anchor's incoming direction
   *  for the exit handle (Bezier p2). Default ≈ gap / 3. */
  exitHandleLength: number;
  /** Roll ramp from the previous section's end roll back to the anchor
   *  roll, taking the shortest signed path. */
  rollFunc: Func;
}

// NoLimitsCSV — an NL2 track imported as pre-sampled nodes. Full port at M5.
export interface NoLimitsCSVSection extends SectionBase {
  type: SecType.NoLimitsCSV;
  // Relative path or blob identifier for the CSV the user imported.
  csvRef: string;
}

export type Section =
  | AnchorSection
  | StraightSection
  | CurvedSection
  | ForcedSection
  | GeometricSection
  | BezierSection
  | NoLimitsCSVSection
  | ClosureSection;

export function isAnchor(section: Section): section is AnchorSection {
  return section.type === SecType.Anchor;
}

export function isClosure(section: Section): section is ClosureSection {
  return section.type === SecType.Closure;
}
