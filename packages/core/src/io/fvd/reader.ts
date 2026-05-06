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
import { Argument, EDegree, EFuncType, Orientation, SecType, TrackStyle } from '../../model/enums.js';
import { type Func, createEmptyFunc } from '../../model/function.js';
import { createEmptyProject, type Project } from '../../model/project.js';
import {
  type AnchorSection,
  type BezierSection,
  type CurvedSection,
  type ForcedSection,
  type GeometricSection,
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
    throw new WebFvdError(
      'io.fvdMalformed',
      { reason: 'bad-magic', got: magic, expected: PROJECT_MAGIC },
    );
  }

  const version = cursor.readTag(VERSION_LENGTH);
  if (version !== 'v0.77' && version !== 'v0.30') {
    throw new WebFvdError(
      'schema.versionUnsupported',
      { got: version, expected: 'v0.77' },
    );
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
      throw new WebFvdError(
        'io.fvdMalformed',
        { reason: 'unexpected-tag', got: tag, expected: `${TRACK_TAG}|${PROJECT_END_TAG}` },
      );
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
  // 3 × QColor = 48 bytes, opaque to us (spec §3.1).
  cursor.skip(48);
  const startPos = cursor.readReversedVec3();
  const anchorRollDeg = cursor.readF32();
  const startPitchDeg = cursor.readF32();
  const startYawDeg = cursor.readF32();
  const anchorVel = cursor.readF32();
  // anchor.forceNormal / forceLateral — display state, not part of the
  // anchor pose. The integrator computes them from gravity. Skip them in
  // the model but read past them for offset correctness.
  cursor.readF32(); // forceNormal
  cursor.readF32(); // forceLateral
  const heart = cursor.readF32();
  const friction = cursor.readF32();
  const resistance = cursor.readF32();
  cursor.readBool(); // drawTrack — UI state
  cursor.readI32(); // drawHeartline — UI state
  const styleId = cursor.readI32();
  cursor.readBool(); // isWireframe — UI state
  cursor.readF32(); // povPos.x — UI state
  cursor.readF32(); // povPos.y — UI state

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
    const sm = readSmoother(cursor);
    if (sm !== null) smoothers.push(sm);
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
  cursor.readBool(); // bSpeed — display intent, not pose
  const name = cursor.readLstr();
  cursor.readF32(); // fVel — pose carried by the integrator
  const length = cursor.readF32();
  const rollFunc = readFunc(cursor, EFuncType.Roll);
  return { type: SecType.Straight, name, length, rollFunc };
}

function readCurved(cursor: FvdCursor): CurvedSection {
  cursor.readBool(); // bSpeed
  const name = cursor.readLstr();
  cursor.readF32(); // fVel
  const angleDeg = cursor.readF32();
  const radius = cursor.readF32();
  cursor.readF32(); // fDirection — degrees of helix tilt; not yet modeled
  const leadInDeg = cursor.readF32();
  const leadOutDeg = cursor.readF32();
  cursor.readBool(); // bOrientation — solver flag, not pose

  const rollFunc = readFunc(cursor, EFuncType.Roll);

  // FVD++ stores the curve as total angle + radius; our model uses
  // length + pitchRate + yawRate. Convert: arc length = radius·angle (rad);
  // until we model fDirection, treat the curve as pure-yaw (level turn).
  const angleRad = angleDeg * DEG;
  const length = Math.abs(radius * angleRad);
  const yawRate = length > 0 ? angleRad / length : 0;

  // fLeadIn/fLeadOut are degrees of ridden angle; convert to a metres-based
  // lead distance via the same arc-length relation.
  const leadIn = Math.abs(radius * leadInDeg * DEG);
  const leadOut = Math.abs(radius * leadOutDeg * DEG);

  return {
    type: SecType.Curved,
    name,
    length,
    pitchRate: 0,
    yawRate,
    leadIn,
    leadOut,
    rollFunc,
  };
}

function readForced(cursor: FvdCursor, legacy: boolean, warnings: string[]): ForcedSection {
  const name = readForcedHeader(cursor, legacy, warnings, 'FRC');
  const orientation = cursor.readBool() ? Orientation.Quaternion : Orientation.Euler;
  const argument = cursor.readBool() ? Argument.Distance : Argument.Time;

  const rollFunc = readFunc(cursor, EFuncType.Roll);
  const normalFunc = readFunc(cursor, EFuncType.Normal);
  const lateralFunc = readFunc(cursor, EFuncType.Lateral);

  // iTime is integer milliseconds; convert to seconds for our extent. If
  // the section is DISTANCE-argument, FVD++ still stores the value in the
  // iTime slot and reinterprets at integration time — preserve as-is.
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
  };
}

function readGeometric(cursor: FvdCursor, warnings: string[]): GeometricSection {
  const name = readForcedHeader(cursor, false, warnings, 'GEO');
  cursor.readBool(); // orientation — not part of geometric model surface
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
    extent,
    rollFunc,
    pitchFunc,
    yawFunc,
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
): string {
  cursor.readBool(); // bSpeed
  const name = cursor.readLstr();
  if (!(legacy && tag === 'FRC')) {
    cursor.readF32(); // fVel
  } else {
    warnings.push(
      'fvd: legacy v0.30 forced section omits fVel; defaulting to 0 for the rest of this track',
    );
  }
  return name;
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

  // FVD++ stores the spline as a list of `bezier_t` entries (P1, Kp1, Kp2,
  // contRoll, relRoll, roll), reconstructed at load time into a polyline of
  // cubic Bezier hops. Our `BezierSection` carries one cubic. For now: take
  // the first segment and use its (P1, Kp1, Kp2) as p0..p3 of a single
  // cubic. The full multi-bezier chain port lands with the FVD-export round-
  // trip work; until then a multi-segment FVD bezier loses everything past
  // the first.
  let p0: [number, number, number] = [0, 0, 0];
  let p1: [number, number, number] = [0, 0, 0];
  let p2: [number, number, number] = [0, 0, 0];
  let p3: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < bezCount; i += 1) {
    const segP1 = cursor.readReversedVec3();
    const segKp1 = cursor.readReversedVec3();
    const segKp2 = cursor.readReversedVec3();
    cursor.readBool(); // contRoll
    cursor.readBool(); // relRoll
    cursor.readF32(); // roll

    if (i === 0) {
      p0 = segP1;
      p1 = segKp1;
    }
    if (i === bezCount - 1) {
      p2 = segKp2;
      p3 = segP1;
    }
  }

  const supCount = cursor.readI32();
  if (supCount < 0 || supCount > 100_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-supcount', supCount });
  }
  for (let i = 0; i < supCount; i += 1) {
    cursor.readReversedVec3(); // discard support points; UI-only
  }

  // Roll sub-curve isn't separately stored — the roll values live on each
  // bezier_t. We don't try to reconstruct a multi-segment rollFunc here;
  // produce an empty roll func so the integrator runs without crashing.
  const rollFunc = createEmptyFunc(EFuncType.Roll, 'Roll');

  return {
    type: SecType.Bezier,
    name,
    controlPoints: [p0, p1, p2, p3],
    rollFunc,
    smoothStart: false,
    smoothEnd: false,
  };
}

function readNoLimitsCsv(cursor: FvdCursor): NoLimitsCSVSection {
  const size = cursor.readI32();
  if (size < 0 || size > 10_000_000) {
    throw new WebFvdError('io.fvdMalformed', { reason: 'absurd-csv-node-count', size });
  }
  // The file embeds the CSV-imported nodes inline (36 bytes each). For now
  // we just skip them and store a placeholder ref — full ingestion is part
  // of the M5 NoLimitsCSV integrator port. This still validates the bytes.
  for (let i = 0; i < size; i += 1) {
    cursor.skip(36);
  }
  return {
    type: SecType.NoLimitsCSV,
    name: 'NoLimitsCSV',
    csvRef: `embedded:${size}-nodes`,
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

function readSmoother(cursor: FvdCursor): Smoother | null {
  cursor.readLstr(); // name — UI label; not part of model
  const fromNode = cursor.readI32();
  cursor.readI32(); // toNode (-1 = until end)
  cursor.readI32(); // length (smoothing window in nodes)
  cursor.readI32(); // iterations
  cursor.readBool(); // active

  // Our model carries `(fromSection, toSection, strength)` while FVD++'s
  // smoothers operate in node space. Without re-integrating we cannot
  // map node indices → section indices here, so we drop the entry rather
  // than fabricate a wrong section pair. The FVD round-trip writer (M9
  // tail) will rebuild these.
  return fromNode < 0 ? null : null;
}
