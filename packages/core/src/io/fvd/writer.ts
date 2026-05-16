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
import { type Smoother, type Track } from '../../model/track.js';
import { integrateTrack } from '../../physics/integrate.js';

import { FvdBuilder } from './builder.js';

const RAD = 180 / Math.PI; // model uses radians; FVD++ stores degrees.

/**
 * Serialise a `Project` to legacy `.fvd` bytes (FVD++ 0.77 format).
 *
 * Lossless round-trip surface:
 *   - All section fields (including `bSpeed`, `fVel`, `orientation`,
 *     `fAngle`/`fRadius`/`fDirection`, Bezier multi-segment chains via
 *     `fvdSegments` + `fvdSupports`, NoLimitsCSV inline `nodes`).
 *   - 48-byte QColor blob, smoothers, UI flags (drawTrack, drawHeartline,
 *     isWireframe, povPos), anchor display forces — all preserved via the
 *     `track.fvdDisplay` and `smoother.fvd` opaque round-trip slices that
 *     the reader populates.
 *
 * Closures (our T2 first-class type) are materialised as regular `BEZ`
 * sections before write — FVD++ has no closure concept, so the
 * integrator's effective control points are baked in.
 *
 * For projects authored in-app (no `fvdDisplay`), the writer emits
 * FVD++'s constructor defaults: drawTrack=true, QColor blob = zeros,
 * povPos = (0, 0).
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
    // Materialise the closure as a 2-segment Bezier chain matching
    // FVD++'s shape. The single cubic from p0..p3 becomes:
    //   segments[0]: anchor = p0, Kp1/Kp2 sentinels (set to p0 itself).
    //   segments[1]: anchor = p3, Kp1 = p1 (outgoing handle from p0),
    //                Kp2 = p2 (incoming handle to p3).
    const bezier: BezierSection = {
      type: SecType.Bezier,
      name: closure.name,
      segments: [
        { P1: [...p0], Kp1: [...p0], Kp2: [...p0] },
        { P1: [...p3], Kp1: [...p1], Kp2: [...p2] },
      ],
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
  // QColor blob: hex-decode from `fvdDisplay.colorsHex` when we have it
  // (round-trip path), else 48 zero bytes (in-app authoring).
  writeColorsHex(w, track.fvdDisplay?.colorsHex);
  const anchor = ensureAnchor(track);
  w.writeReversedVec3(anchor.position[0], anchor.position[1], anchor.position[2]);
  w.writeF32(anchor.roll * RAD);
  w.writeF32(anchor.pitch * RAD);
  w.writeF32(anchor.yaw * RAD);
  w.writeF32(anchor.speed);
  w.writeF32(track.fvdDisplay?.anchorForceNormal ?? 0);
  w.writeF32(track.fvdDisplay?.anchorForceLateral ?? 0);
  w.writeF32(track.heart);
  w.writeF32(track.friction);
  w.writeF32(track.resistance);
  w.writeBool(track.fvdDisplay?.drawTrack ?? true);
  w.writeI32(track.fvdDisplay?.drawHeartline ?? 0);
  w.writeI32(track.style as number);
  w.writeBool(track.fvdDisplay?.isWireframe ?? false);
  w.writeF32(track.fvdDisplay?.povPos?.[0] ?? 0);
  w.writeF32(track.fvdDisplay?.povPos?.[1] ?? 0);

  // Section count excludes the anchor (which is part of the header on disk).
  const real = track.sections.slice(1);
  w.writeI32(real.length);
  for (const section of real) {
    writeSection(w, section);
  }
  // Smoothers: write the FVD bytes verbatim when present; skip when we
  // have no preserved data (the user-authored side hasn't been mapped
  // back to FVD node indices yet — that lands with the on-write
  // sectionStartNodes lookup once we wire it).
  const fvdSmoothers = track.smoothers.filter((s) => s.fvd !== undefined);
  w.writeI32(fvdSmoothers.length);
  for (const s of fvdSmoothers) {
    writeSmoother(w, s);
  }
  w.writeTag('EOT');
}

function writeColorsHex(w: FvdBuilder, hex: string | undefined): void {
  if (hex?.length !== 96) {
    w.writeZeros(48);
    return;
  }
  for (let i = 0; i < 48; i += 1) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    w.writeU8(Number.isFinite(byte) ? byte : 0);
  }
}

function writeSmoother(w: FvdBuilder, s: Smoother): void {
  const fvd = s.fvd;
  if (!fvd) throw new Error('writeSmoother: missing fvd round-trip data');
  w.writeLstr(fvd.name);
  w.writeI32(fvd.fromNode);
  w.writeI32(fvd.toNode);
  w.writeI32(fvd.length);
  w.writeI32(fvd.iterations);
  w.writeBool(fvd.active);
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
  w.writeBool(section.bSpeed ?? true); // FVD++'s default for new sections is true (energy-driven)
  w.writeLstr(section.name);
  w.writeF32(section.fVel ?? 0);
  w.writeF32(section.length);
  writeFunc(w, section.rollFunc);
}

function writeCurved(w: FvdBuilder, section: CurvedSection): void {
  w.writeTag('CUR');
  w.writeBool(section.bSpeed ?? true);
  w.writeLstr(section.name);
  w.writeF32(section.fVel ?? 0);
  w.writeF32(section.fAngle);
  w.writeF32(section.fRadius);
  w.writeF32(section.fDirection);
  w.writeF32(section.fLeadIn);
  w.writeF32(section.fLeadOut);
  w.writeBool((section.orientation ?? Orientation.Euler) === Orientation.Quaternion);
  writeFunc(w, section.rollFunc);
}

function writeForced(w: FvdBuilder, section: ForcedSection): void {
  w.writeTag('FRC');
  w.writeBool(section.bSpeed ?? true);
  w.writeLstr(section.name);
  w.writeF32(section.fVel ?? 0);
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
  w.writeBool(section.bSpeed ?? true);
  w.writeLstr(section.name);
  w.writeF32(section.fVel ?? 0);
  w.writeBool(section.orientation === Orientation.Quaternion);
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
  // Single source of truth: the chain we walked at integrate time is the
  // chain we emit. So the disk file reproduces the same geometry on any
  // FVD-compatible reader.
  w.writeI32(section.segments.length);
  for (const seg of section.segments) {
    w.writeReversedVec3(seg.P1[0], seg.P1[1], seg.P1[2]);
    w.writeReversedVec3(seg.Kp1[0], seg.Kp1[1], seg.Kp1[2]);
    w.writeReversedVec3(seg.Kp2[0], seg.Kp2[1], seg.Kp2[2]);
    w.writeBool(seg.contRoll ?? false);
    w.writeBool(seg.relRoll ?? false);
    w.writeF32(seg.roll ?? 0);
  }
  const sups = section.supports ?? [];
  w.writeI32(sups.length);
  for (const sup of sups) {
    w.writeReversedVec3(sup[0], sup[1], sup[2]);
  }
}

function writeNoLimitsCsv(w: FvdBuilder, section: NoLimitsCSVSection): void {
  w.writeTag('CSV');
  const nodes = section.nodes ?? [];
  w.writeI32(nodes.length);
  for (const n of nodes) {
    w.writeVec3(n.pos[0], n.pos[1], n.pos[2]);
    w.writeVec3(n.dir[0], n.dir[1], n.dir[2]);
    w.writeVec3(n.lat[0], n.lat[1], n.lat[2]);
  }
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
