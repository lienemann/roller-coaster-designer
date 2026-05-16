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

/**
 * Velocity-mode parameters carried by Straight / Curved / Forced /
 * Geometric sections so a `.fvd` import / export is lossless. FVD++'s
 * `bSpeed` flag toggles between:
 *   - `bSpeed = true` (default): velocity is energy-driven (current
 *     integration). `fVel` is recomputed.
 *   - `bSpeed = false`: velocity is held at `fVel` regardless of energy
 *     (used for brake-run / station / launch-section workarounds).
 *
 * Today our integrators always run the energy-driven path; the held-
 * velocity branch is the obvious next port but the fields round-trip
 * regardless so the user's brake sections survive a load/save.
 */
export interface FvdSpeedFields {
  /** FVD++'s `bSpeed`. When set:
   *   - `true` = energy-driven (current integrator behaviour).
   *   - `false` = velocity held at `fVel` regardless of energy
   *     (FVD++'s "constant velocity" mode for brake runs / stations /
   *     launches).
   *  Optional — when missing, treated as `true` (energy-driven). */
  bSpeed?: boolean | undefined;
  /** Held velocity when `bSpeed = false`, m/s. Ignored when `bSpeed = true`
   *  or missing. */
  fVel?: number | undefined;
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
export interface StraightSection extends SectionBase, FvdSpeedFields {
  type: SecType.Straight;
  length: number;
  rollFunc: Func;
}

// Curved — constant-radius arc through a chosen rotation axis. Direct port
// of FVD++'s `seccurved`. The rotation axis is parameterised by
// `fDirection`: 0° = vertical loop (pitch-up), 90° = level turn (yaw),
// intermediate = helix / diving turn. A 360° loop is `fAngle=360, fRadius=R,
// fDirection=0`.
//
// Field names match FVD++ exactly so the on-disk `.fvd` round-trip is
// near-identity. `fAngle`, `fLeadIn`, `fLeadOut`, `fDirection` are stored
// in degrees; `fRadius` in metres; `rollFunc` is parameterised by ridden
// angle in degrees (so `rollFunc.subfuncs[k].length` is degrees, not
// metres). The integrator is `physics/integrate.ts:integrateCurved`.
export interface CurvedSection extends SectionBase, FvdSpeedFields {
  type: SecType.Curved;
  /** EULER inserts a yaw-from-up roll correction so the rider stays upright
   *  relative to world up; QUATERNION leaves the orientation alone.
   *  Matches FVD++'s `bOrientation` on Curved sections.
   *  Optional — defaults to EULER when missing. */
  orientation?: Orientation | undefined;
  /** Total angle ridden, degrees. Equals the sum of rollFunc subfunc
   *  lengths (matching FVD++'s `getMaxArgument()`). */
  fAngle: number;
  /** Arc radius, metres. */
  fRadius: number;
  /** Tilt axis direction in degrees. 0 = vertical loop, 90 = level turn,
   *  intermediate = helix / diving turn. */
  fDirection: number;
  /** Lead-in (smoothstep ease-in) in degrees of ridden angle. */
  fLeadIn: number;
  /** Lead-out in degrees of ridden angle. */
  fLeadOut: number;
  /** Roll function over ridden angle [0, fAngle] degrees. Returns a
   *  per-tick roll-rate; the integrator divides by F_HZ. */
  rollFunc: Func;
}

// Forced — force-driven. Normal and Lateral funcs shape the geometry; the
// integrator is the reference implementation (spec §5). Integrator: M4.
export interface ForcedSection extends SectionBase, FvdSpeedFields {
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
export interface GeometricSection extends SectionBase, FvdSpeedFields {
  type: SecType.Geometric;
  argument: Argument;
  /** EULER inserts a yaw-from-up roll correction so the rider stays upright
   *  relative to world up; QUATERNION leaves the orientation alone. Matches
   *  FVD++'s `bOrientation` on Geometric sections. */
  orientation: Orientation;
  extent: number;
  rollFunc: Func;
  pitchFunc: Func;
  yawFunc: Func;
}

/**
 * One segment of a Bezier chain. Matches FVD++'s `bezier_t` (mnode.h)
 * one-to-one:
 *   - `P1` is the segment's anchor (positional knot).
 *   - `Kp1` is the OUTGOING handle from the previous anchor.
 *   - `Kp2` is the INCOMING handle to this anchor.
 * The cubic that interpolates segment[i−1] → segment[i] uses
 * (segment[i−1].P1, segment[i].Kp1, segment[i].Kp2, segment[i].P1).
 * `contRoll` / `relRoll` / `roll` are FVD-rendering annotations we
 * preserve verbatim but don't yet use functionally — our integration
 * reads roll from `rollFunc`.
 */
export interface BezierSegment {
  P1: [number, number, number];
  Kp1: [number, number, number];
  Kp2: [number, number, number];
  contRoll?: boolean | undefined;
  relRoll?: boolean | undefined;
  roll?: number | undefined;
}

// Bezier — polyline of cubic segments matching FVD++'s `secbezier` exactly.
// `segments` is the canonical representation; the integrator walks every
// pair (segment[i−1] → segment[i]). A "simple" single-cubic Bezier is two
// segments. There's no separate `controlPoints` field — one source of
// truth so an FVD round-trip can't diverge from what the integrator sees.
export interface BezierSection extends SectionBase {
  type: SecType.Bezier;
  /** ≥ 2 segments. segments[0]'s Kp1/Kp2 are sentinels (no cubic ends
   *  at the chain start); segments[N-1].Kp1/Kp2 carry the incoming
   *  handles for the last cubic. */
  segments: BezierSegment[];
  rollFunc: Func;
  // FVD++ option flags surfaced at the UI: whether the start/end tangents
  // should blend smoothly into neighbouring sections.
  smoothStart: boolean;
  smoothEnd: boolean;
  /** Support points (UI-only "rail wiggle" knots in FVD++); preserved
   *  opaquely for round-trip. Empty/missing on tracks authored in-app. */
  supports?: [number, number, number][] | undefined;
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

/** One node of an embedded NoLimits CSV import (FVD++'s `secnlcsv`
 *  `csvNodes`). Each node is a pose: world position + forward + lateral. */
export interface NoLimitsCSVNode {
  pos: [number, number, number];
  dir: [number, number, number];
  lat: [number, number, number];
}

// NoLimitsCSV — an NL2 track imported as pre-sampled nodes. Full port at M5.
export interface NoLimitsCSVSection extends SectionBase {
  type: SecType.NoLimitsCSV;
  // Relative path or blob identifier for the CSV the user imported.
  csvRef: string;
  /** Inline node array, populated when imported from a `.fvd` file
   *  (FVD++ stores it inside the section record). Preserved on
   *  round-trip; the integrator path lands in the M5 NoLimitsCSV
   *  integrator port. */
  nodes?: NoLimitsCSVNode[] | undefined;
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

/**
 * Convenience: extract the FIRST cubic of a Bezier section as four
 * control points (p0, p1, p2, p3). Use for UI rendering / draggable
 * handles that surface a single cubic to the user. Multi-segment chains
 * lose their later cubics through this view; the underlying
 * `section.segments` is still the source of truth.
 */
export function firstCubicOf(
  section: BezierSection,
): [
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number],
] {
  const seg0 = section.segments[0];
  const seg1 = section.segments[1];
  if (!seg0 || !seg1) {
    return [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
  }
  return [
    [...seg0.P1] as [number, number, number],
    [...seg1.Kp1] as [number, number, number],
    [...seg1.Kp2] as [number, number, number],
    [...seg1.P1] as [number, number, number],
  ];
}

/**
 * Build a 2-segment Bezier chain from four control points (p0..p3).
 * The chain start (segments[0].Kp1/Kp2) gets the sentinel value FVD++
 * uses (= P1 itself) since no cubic ends at the chain start.
 */
export function segmentsFromCubic(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
): BezierSegment[] {
  return [
    { P1: [...p0], Kp1: [...p0], Kp2: [...p0] },
    { P1: [...p3], Kp1: [...p1], Kp2: [...p2] },
  ];
}

/**
 * Replace the first cubic of a section's chain (segments[0] and
 * segments[1]) with new control points. Preserves segments[2..N] for
 * multi-segment chains. Use for UI patches that only edit the first
 * cubic's handles.
 */
export function replaceFirstCubic(
  segments: BezierSegment[],
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
): BezierSegment[] {
  const head = segmentsFromCubic(p0, p1, p2, p3);
  return [...head, ...segments.slice(2)];
}
