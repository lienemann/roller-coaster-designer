// SPDX-License-Identifier: AGPL-3.0-only

// Writer for the FVD++ 0.77 `.fvd` binary format. The byte-for-byte inverse
// of `parseFvd` (`reader.ts`); both follow docs/fvd-binary-format.md.
// Together they round-trip a Project losslessly modulo the places where
// our model intentionally drops information (UI flags, QColor blob,
// smoother node-index ↔ section-index mapping).
//
// The writer emits a fresh v0.77 stream regardless of the source — there
// is no path for round-tripping v0.30 verbatim, and FVD++ itself
// auto-upgrades on the next save.

import { Argument, Orientation, SecType } from '../../model/enums.js';
import { type Func } from '../../model/function.js';
import { type Project } from '../../model/project.js';
import {
  type AnchorSection,
  type BezierSection,
  type ClosureSection,
  type CurvedSection,
  type ForcedSection,
  type GeometricSection,
  type NoLimitsCSVSection,
  type Section,
  type StraightSection,
} from '../../model/section.js';
import { type SubFunc } from '../../model/subfunction.js';
import { type Track } from '../../model/track.js';
import { integrateTrack } from '../../physics/integrate.js';

import { FvdBuilder } from './builder.js';

const RAD = 180 / Math.PI; // model uses radians; FVD++ stores degrees.

/**
 * Serialise a `Project` to legacy `.fvd` bytes (FVD++ 0.77 format).
 *
 * Round-trip caveats (the reader symmetrically drops the same):
 *   - UI state (drawTrack, drawHeartline, isWireframe, povPos) is emitted
 *     as FVD++'s constructor defaults.
 *   - 48-byte QColor blob is emitted as zeros — Qt treats invalid QColors
 *     as black, matching FVD++'s initial state.
 *   - Smoothers are emitted as smootherCount=0 because our
 *     (fromSection, toSection, strength) → FVD++'s node-index tuple
 *     requires re-running the integrator and there's no public reverse.
 *   - Curved sections collapse pitchRate + yawRate to a single
 *     fDirection in {0°, 90°}, the only modes that round-trip exactly.
 *     Combined-pitch-yaw curves lose the minor axis.
 *   - NoLimitsCSV sections are emitted with size=0; our model only stores
 *     a csvRef placeholder, not the inline node array.
 *
 * Closures are materialised as regular `BEZ` sections before write — the
 * integrator's effective control points are baked in so FVD++ sees a
 * normal Bezier.
 */
export function writeFvd(project: Project): Uint8Array {
  const expanded = expandClosures(project);
  const w = new FvdBuilder();
  w.writeTag('FVD');
  w.writeTag('v0.77');
  w.writeLstr(expanded.texturePath);
  for (const track of expanded.tracks) {
    writeTrack(w, track);
  }
  w.writeTag('EOP');
  return w.bytes();
}

/** Replace any `ClosureSection` with a concrete `BezierSection` carrying
 *  the integrator's derived control points. After this transform the
 *  writer never sees `SecType.Closure`. */
function expandClosures(project: Project): Project {
  const tracks: Track[] = project.tracks.map((track) => {
    const closureIdx = track.sections.findIndex((s) => s.type === SecType.Closure);
    if (closureIdx < 0) return track;
    const anchor = track.sections[0];
    if (anchor?.type !== SecType.Anchor) return track;
    const closure = track.sections[closureIdx] as ClosureSection;
    const prefix = track.sections.slice(0, closureIdx);
    const prefixTrack: Track = { ...track, sections: prefix };
    const { arrays } = integrateTrack(prefixTrack);
    const last = arrays.length - 1;
    const prevPos: [number, number, number] = [
      arrays.posX[last]!,
      arrays.posY[last]!,
      arrays.posZ[last]!,
    ];
    const prevDir: [number, number, number] = [
      arrays.dirX[last]!,
      arrays.dirY[last]!,
      arrays.dirZ[last]!,
    ];
    const anchorDir = anchorForward(anchor.yaw, anchor.pitch);
    const p0 = prevPos;
    const p1: [number, number, number] = [
      prevPos[0] + prevDir[0] * closure.entryHandleLength,
      prevPos[1] + prevDir[1] * closure.entryHandleLength,
      prevPos[2] + prevDir[2] * closure.entryHandleLength,
    ];
    const p3: [number, number, number] = [...anchor.position];
    const p2: [number, number, number] = [
      anchor.position[0] - anchorDir[0] * closure.exitHandleLength,
      anchor.position[1] - anchorDir[1] * closure.exitHandleLength,
      anchor.position[2] - anchorDir[2] * closure.exitHandleLength,
    ];
    const bezier: BezierSection = {
      type: SecType.Bezier,
      name: closure.name,
      controlPoints: [p0, p1, p2, p3],
      rollFunc: closure.rollFunc,
      smoothStart: true,
      smoothEnd: true,
    };
    return {
      ...track,
      sections: [...prefix, bezier],
    };
  });
  return { ...project, tracks };
}

function writeTrack(w: FvdBuilder, track: Track): void {
  w.writeTag('TRC');
  w.writeLstr(track.name);
  w.writeZeros(48); // QColor blob — opaque to us; spec §3.1
  const anchor = ensureAnchor(track);
  w.writeReversedVec3(anchor.position[0], anchor.position[1], anchor.position[2]);
  w.writeF32(anchor.roll * RAD);
  w.writeF32(anchor.pitch * RAD);
  w.writeF32(anchor.yaw * RAD);
  w.writeF32(anchor.speed);
  w.writeF32(0); // anchor.forceNormal — display state
  w.writeF32(0); // anchor.forceLateral — display state
  w.writeF32(track.heart);
  w.writeF32(track.friction);
  w.writeF32(track.resistance);
  w.writeBool(true); // drawTrack — UI default
  w.writeI32(0); // drawHeartline — UI default
  w.writeI32(track.style as number);
  w.writeBool(false); // isWireframe — UI default
  w.writeF32(0); // povPos.x — UI default
  w.writeF32(0); // povPos.y — UI default

  // Section count excludes the anchor (which is part of the header on disk).
  const real = track.sections.slice(1);
  w.writeI32(real.length);
  for (const section of real) {
    writeSection(w, section);
  }
  w.writeI32(0); // smootherCount — skipped (see writeFvd doc)
  w.writeTag('EOT');
}

function ensureAnchor(track: Track): AnchorSection {
  const first = track.sections[0];
  if (first?.type !== SecType.Anchor) {
    throw new Error('writeFvd: track must start with an Anchor section.');
  }
  return first;
}

function writeSection(w: FvdBuilder, section: Section): void {
  switch (section.type) {
    case SecType.Straight:
      return writeStraight(w, section);
    case SecType.Curved:
      return writeCurved(w, section);
    case SecType.Forced:
      return writeForced(w, section);
    case SecType.Geometric:
      return writeGeometric(w, section);
    case SecType.Bezier:
      return writeBezier(w, section);
    case SecType.NoLimitsCSV:
      return writeNoLimitsCsv(w, section);
    case SecType.Anchor:
      throw new Error('writeFvd: anchor sections may only appear at index 0.');
    case SecType.Closure:
      throw new Error('writeFvd: closure should have been expanded by expandClosures.');
  }
}

function writeStraight(w: FvdBuilder, section: StraightSection): void {
  w.writeTag('STR');
  w.writeBool(false); // bSpeed — energy-driven
  w.writeLstr(section.name);
  w.writeF32(0); // fVel — ignored on energy-driven load
  w.writeF32(section.length);
  writeFunc(w, section.rollFunc);
}

function writeCurved(w: FvdBuilder, section: CurvedSection): void {
  w.writeTag('CUR');
  w.writeBool(false); // bSpeed
  w.writeLstr(section.name);
  w.writeF32(0); // fVel
  // Pick the dominant axis; collapse the minor one. Pure-yaw → fDirection=90°
  // (level turn); pure-pitch → fDirection=0° (vertical loop). Combined
  // curves lose their minor axis (rare in practice).
  const yawDom = Math.abs(section.yawRate) >= Math.abs(section.pitchRate);
  const rate = yawDom ? section.yawRate : section.pitchRate;
  const fAngleDeg = rate * section.length * RAD;
  const fRadius = rate !== 0 ? 1 / Math.abs(rate) : 0;
  const fDirection = yawDom ? 90 : 0;
  w.writeF32(fAngleDeg);
  w.writeF32(fRadius);
  w.writeF32(fDirection);
  const leadDeg = (metres: number): number =>
    fRadius > 0 ? Math.abs(metres / fRadius) * RAD : 0;
  w.writeF32(leadDeg(section.leadIn));
  w.writeF32(leadDeg(section.leadOut));
  w.writeBool(false); // bOrientation — EULER default
  writeFunc(w, section.rollFunc);
}

function writeForced(w: FvdBuilder, section: ForcedSection): void {
  w.writeTag('FRC');
  w.writeBool(false); // bSpeed
  w.writeLstr(section.name);
  w.writeF32(0); // fVel
  w.writeBool(section.orientation === Orientation.Quaternion);
  w.writeBool(section.argument === Argument.Distance);
  writeFunc(w, section.rollFunc);
  writeFunc(w, section.normalFunc);
  writeFunc(w, section.lateralFunc);
  const iTime =
    section.argument === Argument.Time
      ? Math.round(section.extent * 1000)
      : Math.round(section.extent);
  w.writeI32(iTime);
}

function writeGeometric(w: FvdBuilder, section: GeometricSection): void {
  w.writeTag('GEO');
  w.writeBool(false); // bSpeed
  w.writeLstr(section.name);
  w.writeF32(0); // fVel
  w.writeBool(false); // bOrientation — EULER default
  w.writeBool(section.argument === Argument.Distance);
  writeFunc(w, section.rollFunc);
  writeFunc(w, section.pitchFunc);
  writeFunc(w, section.yawFunc);
  const iTime =
    section.argument === Argument.Time
      ? Math.round(section.extent * 1000)
      : Math.round(section.extent);
  w.writeI32(iTime);
}

// FVD++'s Bezier section is a polyline of cubic segments. The `bezier_t`
// for chain index `i` stores:
//   P1 = anchor at index i (positional knot)
//   Kp1 = OUTGOING handle from anchor i−1 (= prev.P1 + tangent×length)
//   Kp2 = INCOMING handle into anchor i (= P1 − tangent×length)
//
// The cubic that interpolates segment[i−1] → segment[i] therefore uses:
//   C0 = segment[i−1].P1     (start)
//   C1 = segment[i].Kp1      (outgoing from start)
//   C2 = segment[i].Kp2      (incoming to end)
//   C3 = segment[i].P1       (end)
//
// segment[0].Kp1 and segment[0].Kp2 are sentinels because no cubic ends
// at segment[0] — FVD++'s reader skips them when assembling the curve.
// We emit safe defaults (P1 itself) so any other consumer that reads
// them sees something well-formed.
function writeBezier(w: FvdBuilder, section: BezierSection): void {
  w.writeTag('BEZ');
  w.writeLstr(section.name);
  const [p0, p1, p2, p3] = section.controlPoints;
  w.writeI32(2);
  writeBezierEntry(w, p0, p0, p0); // segment[0]: anchor + sentinel handles
  writeBezierEntry(w, p3, p1, p2); // segment[1]: anchor + real handles
  w.writeI32(0); // supList — UI-only, empty
}

function writeBezierEntry(
  w: FvdBuilder,
  p1: readonly [number, number, number],
  kp1: readonly [number, number, number],
  kp2: readonly [number, number, number],
): void {
  w.writeReversedVec3(p1[0], p1[1], p1[2]);
  w.writeReversedVec3(kp1[0], kp1[1], kp1[2]);
  w.writeReversedVec3(kp2[0], kp2[1], kp2[2]);
  w.writeBool(false); // contRoll
  w.writeBool(false); // relRoll
  w.writeF32(0); // roll — our rollFunc lives elsewhere
}

function writeNoLimitsCsv(w: FvdBuilder, section: NoLimitsCSVSection): void {
  w.writeTag('CSV');
  w.writeI32(0);
  void section;
}

function writeFunc(w: FvdBuilder, func: Func): void {
  w.writeTag('FUNC');
  w.writeI32(func.subfuncs.length);
  let offset = 0;
  for (const sf of func.subfuncs) {
    writeSubFunc(w, sf, offset);
    offset += sf.length;
  }
}

function writeSubFunc(w: FvdBuilder, sf: SubFunc, offset: number): void {
  w.writeI32(sf.degree as number);
  w.writeF32(offset);
  w.writeF32(offset + sf.length);
  w.writeF32(sf.startValue);
  w.writeF32(sf.arg1);
  w.writeF32(sf.endValue - sf.startValue); // symArg
  w.writeF32(sf.centerArg);
  w.writeF32(sf.tensionArg);
  w.writeBool(false); // locked — UI flag
}

function anchorForward(yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [cy * cp, sp, -sy * cp];
}
