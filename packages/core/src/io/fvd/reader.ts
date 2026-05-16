// SPDX-License-Identifier: AGPL-3.0-only

// Full reader for the FVD++ 0.77 / 0.79 `.fvd` binary format.
//
// Implementation closely follows docs/fvd-binary-format.md. Each function
// reads exactly the bytes one entity owns and leaves the cursor positioned
// at the start of the next entity. Length and tag fields are bounds-checked
// (cursor.ts) so a corrupt file fails loudly rather than via a runaway
// allocation.
//
// Two FVD++ behaviors require notable care:
//   1. Endianness is mixed: most primitives are big-endian per the
//      whole-buffer reversal trick (see cursor.ts). vec3 fields appear in
//      both flavors — back-to-back BE floats (`readVec3`) and
//      whole-blob-reversed (`readReversedVec3`). The site decides; the
//      spec doc table 4 lists every flavor.
//   2. The `v0.30` legacy format is identical to `v0.77` except for
//      `secforced::legacyLoadSection` which omits `fVel` and forces
//      `bSpeed=true` (spec §8). All other section types load the same.
//
// All angles in the on-disk format are degrees (track header) or whatever
// the section's units are — we convert to radians at the model boundary
// because the rest of `core` uses SI radians.
//
// Units delivered to the model:
//   - position: meters
//   - speed:    m/s
//   - heart:    meters
//   - pitch/yaw/roll on the anchor: radians (converted from degrees here)
//   - rollFunc / normalFunc / lateralFunc subfunc values: passed through
//     unchanged — degree units stay degree units, normal/lateral g stays g.
//     Conversion to radians for evaluation is handled where the integrator
//     consumes them (the rest of core already does this for native model
//     funcs).

import { WebFvdError } from '../../errors.js';
import {
  Argument,
  EDegree,
  EFuncType,
  Orientation,
  SecType,
  TrackStyle,
} from '../../model/enums.js';
import { type Func, createEmptyFunc } from '../../model/function.js';
import { createEmptyProject, type Project } from '../../model/project.js';
import {
  type AnchorSection,
  type BezierSection,
  type BezierSegment,
  type CurvedSection,
  type ForcedSection,
  type GeometricSection,
  type NoLimitsCSVNode,
  type NoLimitsCSVSection,
  type Section,
  type StraightSection,
} from '../../model/section.js';
import { type SubFunc } from '../../model/subfunction.js';
import { type Smoother, type Track } from '../../model/track.js';

import { FvdCursor } from './cursor.js';

const PROJECT_MAGIC = 'FVD';
const VERSION_LENGTH = 5;
const TRACK_TAG = 'TRC';
const TRACK_END_TAG = 'EOT';
const PROJECT_END_TAG = 'EOP';
const FUNC_TAG = 'FUNC';

const SECTION_TAGS = {
  STR: 'straight',
  CUR: 'curved',
  FRC: 'forced',
  GEO: 'geometric',
  BEZ: 'bezier',
  CSV: 'nolimits-csv',
} as const;
type SectionTag = keyof typeof SECTION_TAGS;

const DEG = Math.PI / 180;

/** Result of parsing a `.fvd` file: a `Project` ready for the integrator,
 *  plus the file's self-reported version tag and any non-fatal warnings.
 *  Warnings include things like "freeform subfunc loaded with empty curve
 *  data" (per spec §11 bug #5) — the reader recovers gracefully but the
 *  caller should surface a notice. */
export interface FvdParseResult {
  readonly project: Project;
  readonly version: 'v0.77' | 'v0.30';
  readonly warnings: readonly string[];
}

/**
 * Parse a `.fvd` byte stream into a Project. Throws WebFvdError on any
 * unrecoverable parse failure (unknown magic, unsupported version,
 * length-overflow, missing terminator). Recoverable issues are collected
 * in `result.warnings`.
 */
export function parseFvd(bytes: Uint8Array): FvdParseResult {
  const cursor = new FvdCursor(bytes);
  const warnings: string[] = [];

  const magic = cursor.readTag(PROJECT_MAGIC.length);
  if (magic !== PROJECT_MAGIC) {
    throw new WebFvdError('io.fvdMalformed', {
      reason: 'bad-magic',
      got: magic,
      expected: PROJECT_MAGIC,
    });
  }

  const version = cursor.readTag(VERSION_LENGTH);
  if (version !== 'v0.77' && version !== 'v0.30') {
    throw new WebFvdError('schema.versionUnsupported', { got: version, expected: 'v0.77' });
  }
  const legacy = version === 'v0.30';

  // texturePath: a length-prefixed UTF-8 path. Empty allowed.
  const texturePath = cursor.readLstr();

  const project = createEmptyProject();
  project.texturePath = texturePath;

  // Tracks are unterminated count: we read 'TRC' or 'EOP' in a loop.
  while (true) {
    const tag = cursor.peekTag(3);
    if (tag === PROJECT_END_TAG) {
      cursor.skip(3);
      break;
    }
    if (tag !== TRACK_TAG) {
      throw new WebFvdError('io.fvdMalformed', {
        reason: 'unexpected-tag',
        got: tag,
        expected: `${TRACK_TAG}|${PROJECT_END_TAG}`,
      });
    }
    const track = readTrack(cursor, legacy, warnings);
    project.tracks.push(track);
  }

  return { project, version: legacy ? 'v0.30' : 'v0.77', warnings };
}

function readTrack(cursor: FvdCursor, legacy: boolean, warnings: string[]): Track {
  const tag = cursor.readTag(3);
  if (tag !== TRACK_TAG) {
    throw new WebFvdError('io.fvdMalformed', {
      reason: 'expected-track-tag',
      got: tag,
    });
  }

  const name = cursor.readLstr();
  // 3 × QColor = 48 bytes — preserve opaquely as hex so a round-trip
  // doesn't lose the user's colour choices (FVD++ uses Qt's internal
  // QColor layout; we don't reinterpret).
  const colorsHex = cursor.readRawHex(48);
  const startPos = cursor.readReversedVec3();
  const anchorRollDeg = cursor.readF32();
  const startPitchDeg = cursor.readF32();
  const startYawDeg = cursor.readF32();
  const anchorVel = cursor.readF32();
  const anchorForceNormal = cursor.readF32();
  const anchorForceLateral = cursor.readF32();
  const heart = cursor.readF32();
  const friction = cursor.readF32();
  const resistance = cursor.readF32();
  const drawTrack = cursor.readBool();
  const drawHeartline = cursor.readI32();
  const styleId = cursor.readI32();
  const isWireframe = cursor.readBool();
  const povPosX = cursor.readF32();
  const povPosY = cursor.readF32();

  const sectionCount = cursor.readI32();
  if (sectionCount < 0 || sectionCount > 1_000_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-section-count', sectionCount });
  }

  const anchor: AnchorSection = {
    type: SecType.Anchor,
    name: 'Anchor',
    position: startPos,
    pitch: startPitchDeg * DEG,
    yaw: startYawDeg * DEG,
    roll: anchorRollDeg * DEG,
    speed: anchorVel,
  };

  const sections: Section[] = [anchor];
  for (let i = 0; i < sectionCount; i += 1) {
    sections.push(readSection(cursor, legacy, warnings));
  }

  const smootherCount = cursor.readI32();
  if (smootherCount < 0 || smootherCount > 100_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-smoother-count', smootherCount });
  }
  const smoothers: Smoother[] = [];
  for (let i = 0; i < smootherCount; i += 1) {
    smoothers.push(readSmoother(cursor));
  }

  const closing = cursor.readTag(3);
  if (closing !== TRACK_END_TAG) {
    throw new WebFvdError('io.fvdMalformed', {
      reason: 'expected-track-end',
      got: closing,
      expected: TRACK_END_TAG,
    });
  }

  return {
    name,
    style: trackStyleFromId(styleId),
    heart,
    friction,
    resistance,
    sections,
    smoothers,
    fvdDisplay: {
      colorsHex,
      drawTrack,
      drawHeartline,
      isWireframe,
      povPos: [povPosX, povPosY],
      anchorForceNormal,
      anchorForceLateral,
    },
  };
}

function trackStyleFromId(id: number): TrackStyle {
  if (id >= 0 && id <= 7) return id as TrackStyle;
  return TrackStyle.Generic;
}

function readSection(cursor: FvdCursor, legacy: boolean, warnings: string[]): Section {
  const tag = cursor.readTag(3);
  if (!(tag in SECTION_TAGS)) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'unknown-section-tag', got: tag });
  }
  const t = tag as SectionTag;
  switch (t) {
    case 'STR':
      return readStraight(cursor);
    case 'CUR':
      return readCurved(cursor);
    case 'FRC':
      return readForced(cursor, legacy, warnings);
    case 'GEO':
      return readGeometric(cursor, warnings);
    case 'BEZ':
      return readBezier(cursor);
    case 'CSV':
      return readNoLimitsCsv(cursor);
  }
}

function readStraight(cursor: FvdCursor): StraightSection {
  const bSpeed = cursor.readBool();
  const name = cursor.readLstr();
  const fVel = cursor.readF32();
  const length = cursor.readF32();
  const rollFunc = readFunc(cursor, EFuncType.Roll);
  return { type: SecType.Straight, name, length, rollFunc, bSpeed, fVel };
}

function readCurved(cursor: FvdCursor): CurvedSection {
  const bSpeed = cursor.readBool();
  const name = cursor.readLstr();
  const fVel = cursor.readF32();
  const fAngle = cursor.readF32();
  const fRadius = cursor.readF32();
  const fDirection = cursor.readF32();
  const fLeadIn = cursor.readF32();
  const fLeadOut = cursor.readF32();
  const orientation = cursor.readBool() ? Orientation.Quaternion : Orientation.Euler;

  const rollFunc = readFunc(cursor, EFuncType.Roll);

  return {
    type: SecType.Curved,
    name,
    fAngle,
    fRadius,
    fDirection,
    fLeadIn,
    fLeadOut,
    rollFunc,
    bSpeed,
    fVel,
    orientation,
  };
}

function readForced(cursor: FvdCursor, legacy: boolean, warnings: string[]): ForcedSection {
  const { name, bSpeed, fVel } = readForcedHeader(cursor, legacy, warnings, 'FRC');
  const orientation = cursor.readBool() ? Orientation.Quaternion : Orientation.Euler;
  const argument = cursor.readBool() ? Argument.Distance : Argument.Time;

  const rollFunc = readFunc(cursor, EFuncType.Roll);
  const normalFunc = readFunc(cursor, EFuncType.Normal);
  const lateralFunc = readFunc(cursor, EFuncType.Lateral);

  const extentRaw = readForcedExtent(cursor);
  const extent = argument === Argument.Time ? extentRaw / 1000 : extentRaw;

  return {
    type: SecType.Forced,
    name,
    argument,
    orientation,
    extent,
    rollFunc,
    normalFunc,
    lateralFunc,
    bSpeed,
    fVel,
  };
}

function readGeometric(cursor: FvdCursor, warnings: string[]): GeometricSection {
  const { name, bSpeed, fVel } = readForcedHeader(cursor, false, warnings, 'GEO');
  const orientation = cursor.readBool() ? Orientation.Quaternion : Orientation.Euler;
  const argument = cursor.readBool() ? Argument.Distance : Argument.Time;

  const rollFunc = readFunc(cursor, EFuncType.Roll);
  const pitchFunc = readFunc(cursor, EFuncType.Pitch);
  const yawFunc = readFunc(cursor, EFuncType.Yaw);

  const extentRaw = readForcedExtent(cursor);
  const extent = argument === Argument.Time ? extentRaw / 1000 : extentRaw;

  return {
    type: SecType.Geometric,
    name,
    argument,
    orientation,
    extent,
    rollFunc,
    pitchFunc,
    yawFunc,
    bSpeed,
    fVel,
  };
}

/**
 * The shared header layout for FRC and GEO sections: bSpeed, name, fVel,
 * iTime — except FRC's `legacyLoadSection` (v0.30) omits fVel entirely
 * (spec §8). The actual `iTime` is read by `readForcedExtent` because in
 * the on-disk record it sits AFTER the orientation/argument bools and
 * before the funcs in some readings of FVD++ — but in fact FVD++'s
 * `loadSection` reads them in a different order than our spec table
 * suggests. We match secforced.cpp:362–377 exactly: bSpeed, name, fVel,
 * iTime, orientation, argument, rollFunc, normForce, latForce.
 */
function readForcedHeader(
  cursor: FvdCursor,
  legacy: boolean,
  warnings: string[],
  tag: 'FRC' | 'GEO',
): { name: string; bSpeed: boolean; fVel: number } {
  const bSpeed = cursor.readBool();
  const name = cursor.readLstr();
  let fVel = 0;
  if (!(legacy && tag === 'FRC')) {
    fVel = cursor.readF32();
  } else {
    warnings.push(
      'fvd: legacy v0.30 forced section omits fVel; defaulting to 0 for the rest of this track',
    );
  }
  return { name, bSpeed, fVel };
}

function readForcedExtent(cursor: FvdCursor): number {
  return cursor.readI32();
}

function readBezier(cursor: FvdCursor): BezierSection {
  // BEZ has a different header: no bSpeed, no fVel, just nameLen + name.
  const name = cursor.readLstr();
  const bezCount = cursor.readI32();
  if (bezCount < 0 || bezCount > 100_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-bezier-count', bezCount });
  }

  // FVD++ stores the spline as a list of `bezier_t` entries (mnode.cpp:169–176):
  //   segment[i].P1  = anchor at i
  //   segment[i].Kp1 = outgoing handle from segment[i-1].P1
  //   segment[i].Kp2 = incoming handle into segment[i].P1
  // The cubic between segment[i-1] and segment[i] is sampled by
  // `runBezierCubic` in the integrator. Our `BezierSection.segments` is
  // the single source of truth — the same chain that gets read here is
  // walked by the integrator and emitted by the writer, so a `.fvd`
  // round-trip is identical in geometry, physics, and NL2 output.
  const segments: BezierSegment[] = [];
  for (let i = 0; i < bezCount; i += 1) {
    const P1 = cursor.readReversedVec3();
    const Kp1 = cursor.readReversedVec3();
    const Kp2 = cursor.readReversedVec3();
    const contRoll = cursor.readBool();
    const relRoll = cursor.readBool();
    const roll = cursor.readF32();
    segments.push({ P1, Kp1, Kp2, contRoll, relRoll, roll });
  }

  const supCount = cursor.readI32();
  if (supCount < 0 || supCount > 100_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-supcount', supCount });
  }
  const supports: [number, number, number][] = [];
  for (let i = 0; i < supCount; i += 1) {
    supports.push(cursor.readReversedVec3());
  }

  // Roll sub-curve isn't separately stored — the roll values live on each
  // bezier_t. We don't try to reconstruct a multi-segment rollFunc here;
  // produce an empty roll func so the integrator runs without crashing.
  const rollFunc = createEmptyFunc(EFuncType.Roll, 'Roll');

  return {
    type: SecType.Bezier,
    name,
    segments,
    rollFunc,
    smoothStart: false,
    smoothEnd: false,
    ...(supports.length > 0 ? { supports } : {}),
  };
}

function readNoLimitsCsv(cursor: FvdCursor): NoLimitsCSVSection {
  const size = cursor.readI32();
  if (size < 0 || size > 10_000_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-csv-node-count', size });
  }
  // The file embeds the CSV-imported nodes inline (36 bytes each):
  // pos / dir / lat as three back-to-back BE f32-vec3s in x,y,z order
  // (secnlcsv.cpp:140–150; per-component writeBytes calls).
  const nodes: NoLimitsCSVNode[] = [];
  for (let i = 0; i < size; i += 1) {
    nodes.push({
      pos: cursor.readVec3(),
      dir: cursor.readVec3(),
      lat: cursor.readVec3(),
    });
  }
  return {
    type: SecType.NoLimitsCSV,
    name: 'NoLimitsCSV',
    csvRef: `embedded:${size}-nodes`,
    ...(nodes.length > 0 ? { nodes } : {}),
  };
}

function readFunc(cursor: FvdCursor, kind: EFuncType): Func {
  const tag = cursor.readTag(4);
  if (tag !== FUNC_TAG) {
    throw new WebFvdError('io.fvdMalformed', {
      reason: 'expected-func-tag',
      got: tag,
      expected: FUNC_TAG,
    });
  }
  const subfuncCount = cursor.readI32();
  if (subfuncCount < 0 || subfuncCount > 1_000_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-subfunc-count', subfuncCount });
  }
  const func = createEmptyFunc(kind);
  for (let i = 0; i < subfuncCount; i += 1) {
    func.subfuncs.push(readSubFunc(cursor));
  }
  return func;
}

function readSubFunc(cursor: FvdCursor): SubFunc {
  const degreeId = cursor.readI32();
  const minArg = cursor.readF32();
  const maxArg = cursor.readF32();
  const startValue = cursor.readF32();
  const arg1 = cursor.readF32();
  const symArg = cursor.readF32();
  const centerArg = cursor.readF32();
  const tensionArg = cursor.readF32();
  cursor.readBool(); // locked — UI flag

  const length = Math.max(0, maxArg - minArg);
  const endValue = startValue + symArg;

  return {
    degree: subfuncDegreeFromId(degreeId),
    length,
    startValue,
    endValue,
    arg1,
    centerArg,
    tensionArg,
  };
}

function subfuncDegreeFromId(id: number): EDegree {
  if (id >= 0 && id <= 8) return id as EDegree;
  return EDegree.Linear;
}

function readSmoother(cursor: FvdCursor): Smoother {
  const name = cursor.readLstr();
  const fromNode = cursor.readI32();
  const toNode = cursor.readI32();
  const length = cursor.readI32();
  const iterations = cursor.readI32();
  const active = cursor.readBool();

  // Our smoothing pass consumes (fromSection, toSection, strength). We
  // can't map node indices to section indices without re-integrating, so
  // we surface zero values for those and preserve the FVD bytes verbatim
  // in `fvd`. The writer prefers `fvd` when present so a round-trip is
  // exact.
  return {
    fromSection: 0,
    toSection: 0,
    strength: 0,
    fvd: { name, fromNode, toNode, length, iterations, active },
  };
}
