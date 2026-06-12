// SPDX-License-Identifier: AGPL-3.0-only
//
// The WebFVD document model — THE one model for the app, the worker and
// file I/O. A document is plain JSON whose fields mirror FVD++'s native
// section parameters 1:1 (fHLength, fAngle/fRadius/fDirection, iTime,
// bSpeed/bOrientation/bArgument, subfunc wire fields, bezier knots,
// positional smoothHandlers). WebFVD-only extensions are explicit:
//
//   - `kind: 'closure'`     — auto-derived Bezier joining the track end
//                             back to the anchor. Exports to .fvd as a
//                             plain BEZ (one-way; lint marks it).
//   - `pointList`           — Freeform authoring control points. FVD's
//                             wire format never persists them; a doc
//                             that carries them gets `updateBez()` baked
//                             (authoring semantics), one that doesn't
//                             evaluates like an .fvd-loaded Freeform
//                             (startValue everywhere — the FVD bug).
//   - `color`               — per-section display colour (no FVD slot).
//   - `fvdCompatibilityMode`— float32-emulated integrator (true) vs
//                             float64 precise mode (false).
//
// `buildTrack(doc)` materialises an integrable `fvd.Track`;
// `trackToDoc(track)` is the inverse used by .fvd import.

import { F_PI } from './constants.js';
import { type Func } from './func.js';
import { setFloatPrecision, vec3, type Vec3 } from './fvec.js';
import { type SecBezier } from './sec-bezier.js';
import { type SecCurved } from './sec-curved.js';
import { type SecForced } from './sec-forced.js';
import { type SecGeometric } from './sec-geometric.js';
import { type SecStraight } from './sec-straight.js';
import { SecType, type BezierT, type Section } from './section.js';
import { EDegree, type Subfunc } from './subfunction.js';
import { Track, type SmoothHandler } from './track.js';

// ----- document types ---------------------------------------------------

export type Vec3Doc = [number, number, number];

export interface SubfuncDoc {
  degree: EDegree;
  minArgument: number;
  maxArgument: number;
  startValue: number;
  symArg: number;
  arg1: number;
  centerArg: number;
  tensionArg: number;
  locked: boolean;
  /** WebFVD extension — Freeform authoring handles. */
  pointList?: [[number, number], [number, number]] | undefined;
}

export interface FuncDoc {
  subfuncs: SubfuncDoc[];
}

export interface BezierKnotDoc {
  P1: Vec3Doc;
  Kp1: Vec3Doc;
  Kp2: Vec3Doc;
  /** Radians, absolute unless relRoll. */
  roll: number;
  contRoll: boolean;
  relRoll: boolean;
}

interface SectionDocBase {
  name: string;
  /** WebFVD extension — display colour, dropped on .fvd export. */
  color?: string | undefined;
}

export interface StraightSectionDoc extends SectionDocBase {
  kind: 'straight';
  bSpeed: boolean;
  fVel: number;
  fHLength: number;
  rollFunc: FuncDoc;
}

export interface CurvedSectionDoc extends SectionDocBase {
  kind: 'curved';
  bSpeed: boolean;
  fVel: number;
  bOrientation: boolean;
  fAngle: number;
  fRadius: number;
  fDirection: number;
  fLeadIn: number;
  fLeadOut: number;
  rollFunc: FuncDoc;
}

export interface ForcedSectionDoc extends SectionDocBase {
  kind: 'forced';
  bSpeed: boolean;
  fVel: number;
  iTime: number;
  bOrientation: boolean;
  bArgument: boolean;
  rollFunc: FuncDoc;
  normForce: FuncDoc;
  latForce: FuncDoc;
}

export interface GeometricSectionDoc extends SectionDocBase {
  kind: 'geometric';
  bSpeed: boolean;
  fVel: number;
  iTime: number;
  bOrientation: boolean;
  bArgument: boolean;
  rollFunc: FuncDoc;
  normForce: FuncDoc;
  latForce: FuncDoc;
}

export interface BezierSectionDoc extends SectionDocBase {
  kind: 'bezier';
  knots: BezierKnotDoc[];
  supports?: Vec3Doc[] | undefined;
}

/** WebFVD extension — derives a 2-knot Bezier from the previous
 *  section's end pose back to the anchor at build time. */
export interface ClosureSectionDoc extends SectionDocBase {
  kind: 'closure';
}

export type SectionDoc =
  | StraightSectionDoc
  | CurvedSectionDoc
  | ForcedSectionDoc
  | GeometricSectionDoc
  | BezierSectionDoc
  | ClosureSectionDoc;

export interface SmootherDoc {
  name: string;
  from: number;
  to: number;
  length: number;
  iterations: number;
  active: boolean;
}

/** Opaque FVD++ display payload, preserved so .fvd round-trips keep the
 *  user's colours / draw flags. */
export interface FvdDisplayDoc {
  colorsHex: string;
  drawTrack: boolean;
  drawHeartline: number;
  isWireframe: boolean;
  povX: number;
  povY: number;
}

export interface TrackDoc {
  name: string;
  /** Display-only world placement (FVD semantics: integration always
   *  runs from the origin facing −Z; the renderer translates). */
  startPos: Vec3Doc;
  startYaw: number;
  startPitch: number;
  anchor: {
    roll: number;
    vel: number;
    normal: number;
    lateral: number;
  };
  heart: number;
  friction: number;
  resistance: number;
  style: number;
  sections: SectionDoc[];
  /** Positional binding: index 0 = whole track, 1..N = section i−1,
   *  beyond = custom region (smoothhandler.cpp:36). */
  smoothers: SmootherDoc[];
  fvdDisplay?: FvdDisplayDoc | undefined;
}

export interface ProjectDoc {
  fvdCompatibilityMode: boolean;
  tracks: TrackDoc[];
}

export function createEmptyProject(): ProjectDoc {
  return { fvdCompatibilityMode: true, tracks: [] };
}

// ----- doc → fvd.Track ---------------------------------------------------

function applySubfuncDoc(sf: Subfunc, d: SubfuncDoc): void {
  // Mirrors loadSubfunc (subfunction.cpp:317): direct field assignment,
  // no changeDegree. pointList present = authoring semantics → bake the
  // freeform value table the way FVD's UI does.
  sf.degree = d.degree;
  sf.minArgument = d.minArgument;
  sf.maxArgument = d.maxArgument;
  sf.startValue = d.startValue;
  sf.arg1 = d.arg1;
  sf.symArg = d.symArg;
  sf.centerArg = d.centerArg;
  sf.tensionArg = d.tensionArg;
  sf.locked = d.locked;
  if (d.degree === EDegree.Freeform && d.pointList) {
    sf.pointList = [
      { x: d.pointList[0][0], y: d.pointList[0][1] },
      { x: d.pointList[1][0], y: d.pointList[1][1] },
    ];
    sf.updateBez();
  }
}

function applyFuncDoc(f: Func, d: FuncDoc): void {
  // Mirrors loadFunc: first subfunc exists; append the rest.
  if (d.subfuncs.length === 0) return;
  applySubfuncDoc(f.funcList[0]!, d.subfuncs[0]!);
  for (let i = 1; i < d.subfuncs.length; i++) {
    f.appendSubFunction(1, i - 1);
    applySubfuncDoc(f.funcList[i]!, d.subfuncs[i]!);
  }
}

function knotToBezierT(k: BezierKnotDoc): BezierT {
  return {
    P1: vec3(...k.P1),
    Kp1: vec3(...k.Kp1),
    Kp2: vec3(...k.Kp2),
    roll: k.roll,
    contRoll: k.contRoll,
    relRoll: k.relRoll,
    equalDist: false,
    ptf: 0,
    fvdRoll: 0,
    length: 0,
    numNodes: 0,
    fVel: 0,
  };
}

/** Derive the closure's 2-knot bezList from the current end pose back to
 *  the anchor pose. Handle-length heuristic: gap/3 scaled up when the
 *  tangents diverge, padded for sideways gap, floored at 0.5 m. */
export function deriveClosureKnots(track: Track): BezierT[] {
  const prevSection = track.lSections[track.lSections.length - 1];
  const endNode = prevSection
    ? prevSection.lNodes[prevSection.lNodes.length - 1]!
    : track.anchorNode;
  const a = track.anchorNode;

  const dx = a.vPos.x - endNode.vPos.x;
  const dy = a.vPos.y - endNode.vPos.y;
  const dz = a.vPos.z - endNode.vPos.z;
  const gap = Math.hypot(dx, dy, dz);

  const dot = Math.max(
    -1,
    Math.min(1, endNode.vDir.x * a.vDir.x + endNode.vDir.y * a.vDir.y + endNode.vDir.z * a.vDir.z),
  );
  const angleScale = 1 + 1.25 * (1 - dot);
  const meanTx = 0.5 * (endNode.vDir.x + a.vDir.x);
  const meanTy = 0.5 * (endNode.vDir.y + a.vDir.y);
  const meanTz = 0.5 * (endNode.vDir.z + a.vDir.z);
  const meanLen = Math.hypot(meanTx, meanTy, meanTz) || 1;
  const gapAlong = (dx * meanTx + dy * meanTy + dz * meanTz) / meanLen;
  const gapPerp = Math.sqrt(Math.max(0, gap * gap - gapAlong * gapAlong));
  const handle = Math.max((gap / 3) * angleScale + gapPerp * 0.4, 0.5);

  const knot = (
    pos: Vec3,
    dir: Vec3,
    rollDeg: number,
  ): BezierT =>
    knotToBezierT({
      P1: [pos.x, pos.y, pos.z],
      Kp1: [pos.x - dir.x * handle, pos.y - dir.y * handle, pos.z - dir.z * handle],
      Kp2: [pos.x + dir.x * handle, pos.y + dir.y * handle, pos.z + dir.z * handle],
      roll: (rollDeg * F_PI) / 180,
      contRoll: false,
      relRoll: false,
    });

  return [knot(endNode.vPos, endNode.vDir, endNode.fRoll), knot(a.vPos, a.vDir, a.fRoll)];
}

/** Materialise one TrackDoc into an integrable fvd.Track. Replicates the
 *  anchor setup of track.cpp:1025 (loadTrack), then appends and
 *  configures each section and runs updateTrack. */
export function buildTrack(doc: TrackDoc): Track {
  const t = new Track(vec3(...doc.startPos), doc.startYaw, doc.heart);
  t.name = doc.name;
  t.startPitch = doc.startPitch;
  t.fFriction = doc.friction;
  t.fResistance = doc.resistance;
  t.style = doc.style;
  if (doc.fvdDisplay) {
    const hex = doc.fvdDisplay.colorsHex;
    for (let i = 0; i < 48 && i * 2 + 1 < hex.length; i++) {
      t.trackColors[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    t.drawTrack = doc.fvdDisplay.drawTrack;
    t.drawHeartline = doc.fvdDisplay.drawHeartline;
    t.isWireframe = doc.fvdDisplay.isWireframe;
    t.povPos.x = doc.fvdDisplay.povX;
    t.povPos.y = doc.fvdDisplay.povY;
  }

  // Anchor setup — order matters (track.cpp:1052-1056): energy first,
  // then changePitch, then setRoll.
  t.anchorNode.fRoll = doc.anchor.roll;
  t.anchorNode.fVel = doc.anchor.vel;
  t.anchorNode.forceNormal = doc.anchor.normal;
  t.anchorNode.forceLateral = doc.anchor.lateral;
  t.anchorNode.fEnergy =
    0.5 * t.anchorNode.fVel * t.anchorNode.fVel +
    9.80665 * t.anchorNode.fPosHearty(0.9 * t.fHeart);
  t.anchorNode.changePitch(doc.startPitch, false);
  t.anchorNode.setRoll(t.anchorNode.fRoll);
  t.anchorNode.updateNorm();

  for (const s of doc.sections) {
    switch (s.kind) {
      case 'straight': {
        const sec = t.appendSection(SecType.Straight) as SecStraight;
        sec.sName = s.name;
        sec.bSpeed = s.bSpeed;
        sec.fVel = s.fVel;
        sec.fHLength = s.fHLength;
        applyFuncDoc(sec.rollFunc, s.rollFunc);
        break;
      }
      case 'curved': {
        const sec = t.appendSection(SecType.Curved) as SecCurved;
        sec.sName = s.name;
        sec.bSpeed = s.bSpeed;
        sec.fVel = s.fVel;
        sec.bOrientation = s.bOrientation;
        sec.fAngle = s.fAngle;
        sec.fRadius = s.fRadius;
        sec.fDirection = s.fDirection;
        sec.fLeadIn = s.fLeadIn;
        sec.fLeadOut = s.fLeadOut;
        applyFuncDoc(sec.rollFunc, s.rollFunc);
        break;
      }
      case 'forced': {
        const sec = t.appendSection(SecType.Forced) as SecForced;
        sec.sName = s.name;
        sec.bSpeed = s.bSpeed;
        sec.fVel = s.fVel;
        sec.iTime = s.iTime;
        sec.bOrientation = s.bOrientation;
        sec.bArgument = s.bArgument;
        applyFuncDoc(sec.rollFunc, s.rollFunc);
        applyFuncDoc(sec.normForce!, s.normForce);
        applyFuncDoc(sec.latForce!, s.latForce);
        break;
      }
      case 'geometric': {
        const sec = t.appendSection(SecType.Geometric) as SecGeometric;
        sec.sName = s.name;
        sec.bSpeed = s.bSpeed;
        sec.fVel = s.fVel;
        sec.iTime = s.iTime;
        sec.bOrientation = s.bOrientation;
        sec.bArgument = s.bArgument;
        applyFuncDoc(sec.rollFunc, s.rollFunc);
        applyFuncDoc(sec.normForce!, s.normForce);
        applyFuncDoc(sec.latForce!, s.latForce);
        break;
      }
      case 'bezier': {
        const sec = t.appendSection(SecType.Bezier) as SecBezier;
        sec.sName = s.name;
        sec.bezList = s.knots.map(knotToBezierT);
        sec.supList = (s.supports ?? []).map((v) => vec3(...v));
        break;
      }
      case 'closure': {
        // Build everything upstream first so the end pose exists, then
        // derive the joining Bezier. Marked via isClosure so trackToDoc
        // and the compat lint can tell it apart from an authored BEZ.
        t.updateTrack(0, 0);
        const sec = t.appendSection(SecType.Bezier) as SecBezier;
        sec.sName = s.name;
        sec.bezList = deriveClosureKnots(t);
        closureSections.add(sec);
        break;
      }
    }
  }

  // Smoothers: doc order is the positional binding order.
  for (const sm of doc.smoothers) {
    t.smoothHandlers.push({ ...sm });
  }

  t.updateTrack(0, 0);
  return t;
}

// Closure sections are fvd.SecBezier instances at runtime; this side
// table marks which ones were derived from a `closure` doc so the
// inverse conversion and the UI can distinguish them.
const closureSections = new WeakSet<Section>();

export function isClosureSection(s: Section): boolean {
  return closureSections.has(s);
}

/** Build every track of a project with the project's integrator mode
 *  applied. THE entry point for recompute. */
export function buildProject(doc: ProjectDoc): Track[] {
  setFloatPrecision(doc.fvdCompatibilityMode ? 'float32' : 'float64');
  return doc.tracks.map(buildTrack);
}

// ----- fvd.Track → doc ----------------------------------------------------

function subfuncToDoc(sf: Subfunc): SubfuncDoc {
  const d: SubfuncDoc = {
    degree: sf.degree,
    minArgument: sf.minArgument,
    maxArgument: sf.maxArgument,
    startValue: sf.startValue,
    symArg: sf.symArg,
    arg1: sf.arg1,
    centerArg: sf.centerArg,
    tensionArg: sf.tensionArg,
    locked: sf.locked,
  };
  if (sf.degree === EDegree.Freeform && sf.pointList.length === 2 && sf.valueList.length > 0) {
    // Only authored freeforms carry a baked table; .fvd-loaded ones have
    // an empty valueList and must STAY that way (the FVD bug).
    d.pointList = [
      [sf.pointList[0]!.x, sf.pointList[0]!.y],
      [sf.pointList[1]!.x, sf.pointList[1]!.y],
    ];
  }
  return d;
}

function funcToDoc(f: Func): FuncDoc {
  return { subfuncs: f.funcList.map(subfuncToDoc) };
}

function v3(v: Vec3): Vec3Doc {
  return [v.x, v.y, v.z];
}

export function sectionToDoc(s: Section): SectionDoc {
  switch (s.type) {
    case SecType.Straight: {
      const sec = s as SecStraight;
      return {
        kind: 'straight',
        name: sec.sName,
        bSpeed: sec.bSpeed,
        fVel: sec.fVel,
        fHLength: sec.fHLength,
        rollFunc: funcToDoc(sec.rollFunc),
      };
    }
    case SecType.Curved: {
      const sec = s as SecCurved;
      return {
        kind: 'curved',
        name: sec.sName,
        bSpeed: sec.bSpeed,
        fVel: sec.fVel,
        bOrientation: sec.bOrientation,
        fAngle: sec.fAngle,
        fRadius: sec.fRadius,
        fDirection: sec.fDirection,
        fLeadIn: sec.fLeadIn,
        fLeadOut: sec.fLeadOut,
        rollFunc: funcToDoc(sec.rollFunc),
      };
    }
    case SecType.Forced: {
      const sec = s as SecForced;
      return {
        kind: 'forced',
        name: sec.sName,
        bSpeed: sec.bSpeed,
        fVel: sec.fVel,
        iTime: sec.iTime,
        bOrientation: sec.bOrientation,
        bArgument: sec.bArgument,
        rollFunc: funcToDoc(sec.rollFunc),
        normForce: funcToDoc(sec.normForce!),
        latForce: funcToDoc(sec.latForce!),
      };
    }
    case SecType.Geometric: {
      const sec = s as SecGeometric;
      return {
        kind: 'geometric',
        name: sec.sName,
        bSpeed: sec.bSpeed,
        fVel: sec.fVel,
        iTime: sec.iTime,
        bOrientation: sec.bOrientation,
        bArgument: sec.bArgument,
        rollFunc: funcToDoc(sec.rollFunc),
        normForce: funcToDoc(sec.normForce!),
        latForce: funcToDoc(sec.latForce!),
      };
    }
    case SecType.Bezier: {
      const sec = s as SecBezier;
      if (isClosureSection(sec)) {
        return { kind: 'closure', name: sec.sName };
      }
      return {
        kind: 'bezier',
        name: sec.sName,
        knots: sec.bezList.map((b) => ({
          P1: v3(b.P1),
          Kp1: v3(b.Kp1),
          Kp2: v3(b.Kp2),
          roll: b.roll,
          contRoll: b.contRoll,
          relRoll: b.relRoll,
        })),
        supports: sec.supList.length ? sec.supList.map(v3) : undefined,
      };
    }
    default:
      throw new Error(`sectionToDoc: unsupported section type ${String(s.type)}`);
  }
}

export function trackToDoc(t: Track): TrackDoc {
  let colorsHex = '';
  for (let i = 0; i < 48; i++) colorsHex += t.trackColors[i]!.toString(16).padStart(2, '0');
  return {
    name: t.name,
    startPos: v3(t.startPos),
    startYaw: t.startYaw,
    startPitch: t.startPitch,
    anchor: {
      roll: t.anchorNode.fRoll,
      vel: t.anchorNode.fVel,
      normal: t.anchorNode.forceNormal,
      lateral: t.anchorNode.forceLateral,
    },
    heart: t.fHeart,
    friction: t.fFriction,
    resistance: t.fResistance,
    style: t.style,
    sections: t.lSections.map(sectionToDoc),
    smoothers: t.smoothHandlers.map((h: SmoothHandler) => ({ ...h })),
    fvdDisplay: {
      colorsHex,
      drawTrack: t.drawTrack,
      drawHeartline: t.drawHeartline,
      isWireframe: t.isWireframe,
      povX: t.povPos.x,
      povY: t.povPos.y,
    },
  };
}
