// SPDX-License-Identifier: AGPL-3.0-only
//
// Geometric-section test corpus generator. Eight small .fvd files so FVD++
// 0.79 (which crashes on a single ~70-section track) can chew through
// each scenario in isolation:
//
//   geo-degree-roll.fvd       9 sections, one per EDegree, on rollFunc
//   geo-degree-pitch.fvd      9 sections, one per EDegree, on normForce
//   geo-degree-yaw.fvd        9 sections, one per EDegree, on latForce
//   geo-arg1.fvd              11 sections sweeping arg1 across
//                             Quartic / Quintic / Plateau
//   geo-warp.fvd              10 sections sweeping centerArg/tensionArg
//   geo-options.fvd           6 sections covering the bOrientation ×
//                             bSpeed × bArgument matrix (includes 2
//                             DISTANCE-mode sections)
//   geo-multisub.fvd          3 sections with multi-subfunc funcs incl.
//                             a locked-tail subfunc
//   geo-kinematics.fvd        6 sections sweeping velocity / time
//
// Workflow: run `pnpm tsx scripts/build-geometric-corpus.ts` from
// packages/core, open each .fvd in FVD++ 0.79, export the NL2 element
// XML, drop each .nl2elem next to its source .fvd.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFvd } from '../src/fvd/fvd-file.js';
import { vec3 } from '../src/fvd/fvec.js';
import { type SecBezier } from '../src/fvd/sec-bezier.js';
import { type SecCurved } from '../src/fvd/sec-curved.js';
import { type SecForced } from '../src/fvd/sec-forced.js';
import { type SecGeometric } from '../src/fvd/sec-geometric.js';
import { type SecStraight } from '../src/fvd/sec-straight.js';
import { SecType, EULER, QUATERNION, TIME, DISTANCE, type BezierT } from '../src/fvd/section.js';
import type { Subfunc } from '../src/fvd/subfunction.js';
import { EDegree } from '../src/fvd/subfunction.js';
import { Track } from '../src/fvd/track.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../test/golden/data/fvd-corpus');
mkdirSync(outDir, { recursive: true });

// ----- helpers --------------------------------------------------------

function newTrack(): Track {
  // heart=1.1 so the heart-line correction has a real effect; friction
  // and resistance match testtrack.fvd so energy bookkeeping is non-trivial.
  const t = new Track(vec3(0, 0, 0), 0, 1.1);
  t.fFriction = 0.03;
  t.fResistance = 2e-5;
  // 48 bytes of trackColors stay zero — FVD doesn't care.
  t.name = 'GeoCorpus';
  return t;
}

interface SubfuncConfig {
  degree?: EDegree;
  // Subfunc spans [min, max] in the func's parameter (seconds for TIME,
  // meters for DISTANCE). symArg is end-value − start-value.
  min?: number;
  max?: number;
  start?: number;
  symArg?: number;
  // arg1 (Quartic/Quintic/Plateau), centerArg + tensionArg (any degree).
  arg1?: number;
  center?: number;
  tension?: number;
  locked?: boolean;
}

function configSubfunc(sf: Subfunc, c: SubfuncConfig): void {
  if (c.degree !== undefined) sf.changeDegree(c.degree);
  // Note: sf.update() also calls parent.translateValues(), so we set
  // arg1/center/tension AFTER so they aren't trampled.
  const min = c.min ?? sf.minArgument;
  const max = c.max ?? sf.maxArgument;
  const symArg = c.symArg ?? sf.symArg;
  sf.update(min, max, symArg);
  if (c.start !== undefined) sf.startValue = c.start;
  if (c.arg1 !== undefined) sf.arg1 = c.arg1;
  if (c.center !== undefined) sf.centerArg = c.center;
  if (c.tension !== undefined) sf.tensionArg = c.tension;
  if (c.locked !== undefined) sf.locked = c.locked;
}

interface GeoConfig {
  name?: string;
  // Section-level
  timeSec?: number;
  fVel?: number;
  bSpeed?: boolean;
  bOrientation?: boolean;
  bArgument?: boolean;
  // Func configs — first subfunc only (multi-subfunc handled separately).
  roll?: SubfuncConfig;
  pitch?: SubfuncConfig;
  yaw?: SubfuncConfig;
}

function addGeo(track: Track, cfg: GeoConfig): SecGeometric {
  const s = track.appendSection(SecType.Geometric) as SecGeometric;
  s.sName = cfg.name ?? 'geo';
  if (cfg.timeSec !== undefined) s.iTime = Math.round(cfg.timeSec * 1000);
  if (cfg.fVel !== undefined) s.fVel = cfg.fVel;
  if (cfg.bSpeed !== undefined) s.bSpeed = cfg.bSpeed;
  if (cfg.bOrientation !== undefined) s.bOrientation = cfg.bOrientation;
  if (cfg.bArgument !== undefined) s.bArgument = cfg.bArgument;

  // For TIME-mode sections the func parameter is seconds; for DISTANCE
  // it's meters. Either way the first subfunc spans [0, iTime/1000] (or
  // approximate length) unless the caller overrides.
  const paramEnd = (s.iTime ?? 1000) / 1000;
  if (cfg.roll) configSubfunc(s.rollFunc.funcList[0]!, { min: 0, max: paramEnd, ...cfg.roll });
  if (cfg.pitch) configSubfunc(s.normForce!.funcList[0]!, { min: 0, max: paramEnd, ...cfg.pitch });
  if (cfg.yaw) configSubfunc(s.latForce!.funcList[0]!, { min: 0, max: paramEnd, ...cfg.yaw });

  return s;
}

function save(track: Track, name: string): void {
  // FVD++ project envelope: "FVD" "v0.77" + a 16-byte texPath + TRC blocks
  // + "EOP". The bg image string matches what FVD++ writes for a fresh
  // project so it round-trips cleanly.
  const buf = writeFvd({
    version: 'v0.77',
    backgroundImage: ':/background.png',
    tracks: [track],
  });
  const path = resolve(outDir, `${name}.fvd`);
  writeFileSync(path, buf);
  // eslint-disable-next-line no-console
  console.log(`  wrote ${path} (${buf.length} bytes, ${track.lSections.length} sections)`);
}

// ----- scenarios ------------------------------------------------------

const ALL_DEGREES: { name: string; degree: EDegree }[] = [
  { name: 'linear', degree: EDegree.Linear },
  { name: 'quadratic', degree: EDegree.Quadratic },
  { name: 'cubic', degree: EDegree.Cubic },
  { name: 'quartic', degree: EDegree.Quartic },
  { name: 'quintic', degree: EDegree.Quintic },
  { name: 'sinusoidal', degree: EDegree.Sinusoidal },
  { name: 'plateau', degree: EDegree.Plateau },
  { name: 'tozero', degree: EDegree.ToZero },
  { name: 'freeform', degree: EDegree.Freeform },
];

// Scenario 1: roll-rate ramps, one section per EDegree. Pitch/yaw stay
// zero so the rider only banks.
function rollDegreeSweep(t: Track): void {
  for (const { name, degree } of ALL_DEGREES) {
    addGeo(t, {
      name: `roll-${name}`,
      timeSec: 1,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      roll: { degree, start: 0, symArg: 60 },
    });
  }
}

// Scenario 2: pitch-rate ramps, one section per EDegree.
function pitchDegreeSweep(t: Track): void {
  for (const { name, degree } of ALL_DEGREES) {
    addGeo(t, {
      name: `pitch-${name}`,
      timeSec: 1,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      pitch: { degree, start: 0, symArg: 30 },
    });
  }
}

// Scenario 3: yaw-rate ramps, one section per EDegree.
function yawDegreeSweep(t: Track): void {
  for (const { name, degree } of ALL_DEGREES) {
    addGeo(t, {
      name: `yaw-${name}`,
      timeSec: 1,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      yaw: { degree, start: 0, symArg: 30 },
    });
  }
}

// Scenario 4: arg1 sweep on the degrees that consume it (Quartic /
// Quintic / Plateau).
function arg1Sweep(t: Track): void {
  const sweep: { d: EDegree; a: number; tag: string }[] = [
    { d: EDegree.Quartic, a: -10, tag: 'quartic-neg10' },
    { d: EDegree.Quartic, a: -5, tag: 'quartic-neg5' },
    { d: EDegree.Quartic, a: 0.25, tag: 'quartic-pos025' },
    { d: EDegree.Quartic, a: 0.45, tag: 'quartic-pos045' },
    { d: EDegree.Quintic, a: -8, tag: 'quintic-neg8' },
    { d: EDegree.Quintic, a: 0, tag: 'quintic-0' },
    { d: EDegree.Quintic, a: 8, tag: 'quintic-pos8' },
    { d: EDegree.Plateau, a: 0.5, tag: 'plateau-05' },
    { d: EDegree.Plateau, a: 1, tag: 'plateau-1' },
    { d: EDegree.Plateau, a: 5, tag: 'plateau-5' },
    { d: EDegree.Plateau, a: 10, tag: 'plateau-10' },
  ];
  for (const { d, a, tag } of sweep) {
    addGeo(t, {
      name: tag,
      timeSec: 1,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      pitch: { degree: d, start: 0, symArg: 30, arg1: a },
    });
  }
}

// Scenario 5: input warp (centerArg / tensionArg) — they distort the
// curve's x ∈ [0,1] before the polynomial is evaluated.
function warpSweep(t: Track): void {
  const sweep: { tag: string; center: number; tension: number }[] = [
    { tag: 'center-neg2', center: -2, tension: 0 },
    { tag: 'center-neg1', center: -1, tension: 0 },
    { tag: 'center-pos1', center: 1, tension: 0 },
    { tag: 'center-pos2', center: 2, tension: 0 },
    { tag: 'tension-neg2', center: 0, tension: -2 },
    { tag: 'tension-neg1', center: 0, tension: -1 },
    { tag: 'tension-pos1', center: 0, tension: 1 },
    { tag: 'tension-pos2', center: 0, tension: 2 },
    { tag: 'combo-c1-t1', center: 1, tension: 1 },
    { tag: 'combo-cn1-t1', center: -1, tension: 1 },
  ];
  for (const { tag, center, tension } of sweep) {
    addGeo(t, {
      name: tag,
      timeSec: 1,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      pitch: { degree: EDegree.Cubic, start: 0, symArg: 30, center, tension },
    });
  }
}

// Scenario 6: bOrientation × bSpeed × bArgument matrix.
// DISTANCE-mode sections are included so FVD++'s gold drives the
// not-yet-ported DISTANCE integrator (corpus.test.ts skips them).
function optionMatrix(t: Track): void {
  const matrix: { tag: string; ori: boolean; speed: boolean; arg: boolean }[] = [
    { tag: 'euler-spd-time', ori: EULER, speed: true, arg: TIME },
    { tag: 'euler-nspd-time', ori: EULER, speed: false, arg: TIME },
    { tag: 'quat-spd-time', ori: QUATERNION, speed: true, arg: TIME },
    { tag: 'quat-nspd-time', ori: QUATERNION, speed: false, arg: TIME },
    { tag: 'euler-spd-dist', ori: EULER, speed: true, arg: DISTANCE },
    { tag: 'quat-spd-dist', ori: QUATERNION, speed: true, arg: DISTANCE },
  ];
  for (const { tag, ori, speed, arg } of matrix) {
    const paramEnd = arg === DISTANCE ? 15 : 1;
    addGeo(t, {
      name: tag,
      timeSec: 1,
      fVel: 15,
      bSpeed: speed,
      bOrientation: ori,
      bArgument: arg,
      pitch: { degree: EDegree.Cubic, min: 0, max: paramEnd, start: 0, symArg: 30 },
      yaw: { degree: EDegree.Cubic, min: 0, max: paramEnd, start: 0, symArg: 20 },
      roll: { degree: EDegree.Cubic, min: 0, max: paramEnd, start: 0, symArg: 45 },
    });
  }
}

// Scenario 7: multi-subfunc funcs, including a locked tail subfunc.
function multiSubfunc(t: Track): void {
  const a = addGeo(t, {
    name: 'split-2',
    timeSec: 1,
    fVel: 15,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    pitch: { degree: EDegree.Linear, min: 0, max: 0.5, start: 0, symArg: 15 },
  });
  a.normForce!.appendSubFunction(0.5, 0);
  configSubfunc(a.normForce!.funcList[1]!, {
    degree: EDegree.Cubic,
    min: 0.5,
    max: 1,
    symArg: 15,
  });

  const b = addGeo(t, {
    name: 'split-3',
    timeSec: 1.5,
    fVel: 15,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    roll: { degree: EDegree.Cubic, min: 0, max: 0.5, start: 0, symArg: 20 },
  });
  b.rollFunc.appendSubFunction(0.5, 0);
  configSubfunc(b.rollFunc.funcList[1]!, {
    degree: EDegree.ToZero,
    min: 0.5,
    max: 1,
    symArg: -20,
  });
  b.rollFunc.appendSubFunction(0.5, 1);
  configSubfunc(b.rollFunc.funcList[2]!, {
    degree: EDegree.Quartic,
    min: 1,
    max: 1.5,
    symArg: 10,
    arg1: -10,
  });

  const c = addGeo(t, {
    name: 'locked-tail',
    timeSec: 1,
    fVel: 15,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    pitch: { degree: EDegree.Linear, min: 0, max: 0.4, start: 0, symArg: 12 },
  });
  c.normForce!.appendSubFunction(0.6, 0);
  configSubfunc(c.normForce!.funcList[1]!, {
    degree: EDegree.Quartic,
    min: 0.4,
    max: 1,
    symArg: 8,
    arg1: -10,
    locked: true,
  });
}

// Scenario 8: velocity / time sweep.
function kinematicsSweep(t: Track): void {
  const sweep: { tag: string; time: number; vel: number; speed: boolean }[] = [
    { tag: 'short-slow', time: 0.25, vel: 5, speed: false },
    { tag: 'short-fast', time: 0.25, vel: 30, speed: false },
    { tag: 'long-slow', time: 4, vel: 5, speed: false },
    { tag: 'long-fast', time: 4, vel: 30, speed: false },
    { tag: 'energy-low', time: 2, vel: 8, speed: true },
    { tag: 'energy-high', time: 2, vel: 25, speed: true },
  ];
  for (const { tag, time, vel, speed } of sweep) {
    addGeo(t, {
      name: tag,
      timeSec: time,
      fVel: vel,
      bSpeed: speed,
      bOrientation: QUATERNION,
      bArgument: TIME,
      pitch: { degree: EDegree.Sinusoidal, start: 0, symArg: 20 },
    });
  }
}

// Scenario 9a: Freeform isolation. Single Geometric section with a
// Freeform pitch func — default pointList (0.3, 0) and (0.7, 1). Lets
// us diff per-step pitch values against FVD without any upstream
// sections muddying the signal.
function freeformOnly(t: Track): void {
  addGeo(t, {
    name: 'freeform-pitch-only',
    timeSec: 1,
    fVel: 15,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    pitch: { degree: EDegree.Freeform, start: 0, symArg: 30 },
  });
}

// Scenario 9b: section.length straddling the int(length / mPerNode)
// boundary so fFillPointList's numNodes truncation can disagree
// between FVD and us. mPerNode is 2.0 in the export, so the int
// boundary at numNodes=8 sits around length=16.0. iTime values are
// chosen so fVel=15 produces a heart-line length that brackets this:
//   iTime=1060 → ~15.9 m (numNodes=7)
//   iTime=1080 → ~16.2 m (numNodes=8)
// Plus a few more straddling 6/7 and 5/6.
function lengthThreshold(t: Track): void {
  const sweep: { tag: string; iTime: number }[] = [
    { tag: 'sub-6-7-lo', iTime: 920 }, //  ~13.8 m → numNodes=6
    { tag: 'sub-6-7-hi', iTime: 950 }, //  ~14.25 m → numNodes=7
    { tag: 'sub-7-8-lo', iTime: 1060 }, // ~15.9 m → numNodes=7
    { tag: 'sub-7-8-hi', iTime: 1080 }, // ~16.2 m → numNodes=8
  ];
  for (const { tag, iTime } of sweep) {
    addGeo(t, {
      name: tag,
      timeSec: iTime / 1000,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      pitch: { degree: EDegree.Cubic, start: 0, symArg: 15 },
    });
  }
}

// Scenario 9c: transcendental-isolation. Eight Geometric sections of
// 2 seconds each (= 2000 integration steps), no warp, no roll/yaw,
// pitch-only. Pairs are (Linear, Sinusoidal) and (Linear, Plateau)
// repeating. The Linear sections share the same start/symArg as
// their neighbors so they should produce IDENTICAL total pitch
// integral. Any per-section drift difference between Linear and
// Sinusoidal / Plateau directly exposes Math.cos / Math.exp /
// Math.pow ULP divergence from C++ libm, accumulated over 2000
// steps × N sections.
function transcendentalIsolation(t: Track): void {
  const seq: { tag: string; degree: EDegree; arg1?: number }[] = [
    { tag: 'lin-1', degree: EDegree.Linear },
    { tag: 'sin-1', degree: EDegree.Sinusoidal },
    { tag: 'lin-2', degree: EDegree.Linear },
    { tag: 'sin-2', degree: EDegree.Sinusoidal },
    { tag: 'lin-3', degree: EDegree.Linear },
    { tag: 'plat-1', degree: EDegree.Plateau, arg1: 1 },
    { tag: 'lin-4', degree: EDegree.Linear },
    { tag: 'plat-2', degree: EDegree.Plateau, arg1: 1 },
  ];
  for (const { tag, degree, arg1 } of seq) {
    addGeo(t, {
      name: tag,
      timeSec: 2,
      fVel: 15,
      bSpeed: false,
      bOrientation: QUATERNION,
      bArgument: TIME,
      pitch: arg1 === undefined
        ? { degree, start: 0, symArg: 20 }
        : { degree, start: 0, symArg: 20, arg1 },
    });
  }
}

// ----- Bezier / smoother / mixed scenarios ------------------------------

function bezKnot(
  p1: [number, number, number],
  kp1: [number, number, number],
  kp2: [number, number, number],
  opts: Partial<Pick<BezierT, 'roll' | 'contRoll' | 'relRoll'>> = {},
): BezierT {
  return {
    P1: vec3(...p1),
    Kp1: vec3(...kp1),
    Kp2: vec3(...kp2),
    roll: opts.roll ?? 0,
    contRoll: opts.contRoll ?? false,
    equalDist: false,
    relRoll: opts.relRoll ?? false,
    ptf: 0,
    fvdRoll: 0,
    length: 0,
    numNodes: 0,
    fVel: 0,
  };
}

// FVD++ keeps one smoothHandler per section plus a whole-track handler
// at index 0 (track.cpp:335, smoothhandler.cpp:36). Binding is
// positional, so the corpus writer must emit exactly 1 + numSections
// records for FVD++ to apply them onto its auto-created list.
// `sectionIndex: -1` activates the whole-track handler at index 0 — the
// one that actually smooths across section boundaries. A handler bound
// to a single constant-roll-rate section is a no-op (the filter anchors
// to endpoint averages inside its own window).
function pushSmoothHandlers(
  t: Track,
  active: { sectionIndex: number; length: number; iterations: number }[] = [],
): void {
  const trackAct = active.find((a) => a.sectionIndex === -1);
  t.smoothHandlers.push({
    name: t.name,
    from: 0,
    to: 0,
    length: trackAct?.length ?? 400,
    iterations: trackAct?.iterations ?? 1,
    active: trackAct !== undefined,
  });
  for (let i = 0; i < t.lSections.length; i++) {
    const act = active.find((a) => a.sectionIndex === i);
    t.smoothHandlers.push({
      name: t.lSections[i]!.sName,
      from: 0,
      to: 0,
      length: act?.length ?? 400,
      iterations: act?.iterations ?? 1,
      active: act !== undefined,
    });
  }
}

// Scenario 10: plain Bezier chain — 4 knots, mild 3D 'S', zero roll.
// Heights stay ≤ 3 m so the energy-driven velocity keeps real headroom
// above the anchor's 10 m/s energy budget.
function bezBasic(t: Track): void {
  const s = t.appendSection(SecType.Bezier) as SecBezier;
  s.sName = 'bez-basic';
  s.bezList = [
    bezKnot([0, 0, 0], [0, 0, 3], [0, 0, -6]),
    bezKnot([5, 2, -18], [4, 2, -12], [6, 2, -24]),
    bezKnot([-2, 1, -36], [0, 1.5, -30], [-4, 0.5, -42]),
    bezKnot([0, 0, -55], [-1, 0, -49], [1, 0, -61]),
  ];
}

// Scenario 11: Bezier roll matrix — absolute roll, relRoll chaining, and
// contRoll transitions, across 5 knots.
function bezRoll(t: Track): void {
  const s = t.appendSection(SecType.Bezier) as SecBezier;
  s.sName = 'bez-roll';
  s.bezList = [
    bezKnot([0, 0, 0], [0, 0, 3], [0, 0, -6]),
    bezKnot([6, 1, -16], [5, 1, -10], [7, 1, -22], { roll: 0.5 }),
    bezKnot([0, 2, -32], [2, 2, -26], [-2, 2, -38], { roll: 0.4, relRoll: true }),
    bezKnot([-6, 1, -48], [-5, 1, -42], [-7, 1, -54], { roll: -0.6, contRoll: true }),
    bezKnot([0, 0, -64], [-2, 0, -58], [2, 0, -70], { roll: 0, contRoll: true }),
  ];
}

// Scenario 12: every section type in one track — STR, CUR, FRC, GEO, BEZ.
// Small (5 sections) so FVD++ stays stable. The BEZ picks up wherever
// the GEO ends; FVD++ doesn't enforce continuity into a BEZ, and the
// parity diff doesn't care.
function mixedAll(t: Track): void {
  const str = t.appendSection(SecType.Straight) as SecStraight;
  str.sName = 'straight';
  configSubfunc(str.rollFunc.funcList[0]!, { min: 0, max: 10, degree: EDegree.Cubic, start: 0, symArg: 30 });

  const cur = t.appendSection(SecType.Curved) as SecCurved;
  cur.sName = 'curved';
  cur.fAngle = 90;
  cur.fRadius = 12;
  cur.fDirection = 90;
  cur.fLeadIn = 10;
  cur.fLeadOut = 10;
  cur.rollFunc.setMaxArgument(90);

  const frc = t.appendSection(SecType.Forced) as SecForced;
  frc.sName = 'forced';
  frc.iTime = 1500;
  frc.bSpeed = false;
  frc.fVel = 12;
  configSubfunc(frc.normForce!.funcList[0]!, { min: 0, max: 1.5, degree: EDegree.Cubic, start: 1, symArg: 1.5 });

  addGeo(t, {
    name: 'geometric',
    timeSec: 1.5,
    fVel: 12,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    pitch: { degree: EDegree.Cubic, start: 0, symArg: 20 },
  });

  const bez = t.appendSection(SecType.Bezier) as SecBezier;
  bez.sName = 'bezier';
  bez.bezList = [
    bezKnot([0, 0, 0], [0, 0, 3], [0, 0, -6]),
    bezKnot([4, 1, -15], [3, 1, -9], [5, 1, -21]),
    bezKnot([0, 0, -30], [2, 0.5, -24], [-2, 0, -36]),
  ];
}

// Scenario 13: roll smoother. A triangle roll-rate spike (0→80→0 °/s
// over 0.6 s) inside a 2 s Geometric section, flat neighbours, and the
// WHOLE-TRACK smoothHandler active (length=400 ticks, 1 iteration).
// Every section type stitches its roll-rate start to the previous
// section's end (translateValues at node 0), so a startValue step can't
// exist — only a sharp in-profile feature can. The box filter rounds
// the triangle's peak, depositing non-zero fSmoothSpeed.
function smoothRoll(t: Track): void {
  addGeo(t, {
    name: 'pre',
    timeSec: 1,
    fVel: 12,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    roll: { degree: EDegree.Linear, start: 0, symArg: 0 },
  });
  const spike = addGeo(t, {
    name: 'spike',
    timeSec: 2,
    fVel: 12,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    roll: { degree: EDegree.Linear, min: 0, max: 0.7, start: 0, symArg: 80 },
  });
  // Triangle: up over [0, 0.7], down over [0.7, 1.3], flat to 2.0 s.
  spike.rollFunc.appendSubFunction(0.6, 0);
  configSubfunc(spike.rollFunc.funcList[1]!, { degree: EDegree.Linear, symArg: -80 });
  spike.rollFunc.appendSubFunction(0.7, 1);
  configSubfunc(spike.rollFunc.funcList[2]!, { degree: EDegree.Linear, symArg: 0 });
  addGeo(t, {
    name: 'post',
    timeSec: 1,
    fVel: 12,
    bSpeed: false,
    bOrientation: QUATERNION,
    bArgument: TIME,
    roll: { degree: EDegree.Linear, start: 0, symArg: 0 },
  });
  pushSmoothHandlers(t, [{ sectionIndex: -1, length: 400, iterations: 1 }]);
}

// Scenario 14: same track, heavier smoothing — whole-track handler with
// 3 iterations × 600 ticks, PLUS the middle section's own handler, so
// overlapping handlers accumulate (smoothui.cpp:231 `+=`).
function smoothIter(t: Track): void {
  smoothRoll(t);
  t.smoothHandlers.length = 0;
  pushSmoothHandlers(t, [
    { sectionIndex: -1, length: 600, iterations: 3 },
    { sectionIndex: 1, length: 400, iterations: 1 },
  ]);
}

// ----- run -----

function buildOne(name: string, populate: (t: Track) => void): void {
  const t = newTrack();
  populate(t);
  save(t, name);
}

// eslint-disable-next-line no-console
console.log(`Geometric corpus → ${outDir}`);
buildOne('geo-degree-roll', rollDegreeSweep);
buildOne('geo-degree-pitch', pitchDegreeSweep);
buildOne('geo-degree-yaw', yawDegreeSweep);
buildOne('geo-arg1', arg1Sweep);
buildOne('geo-warp', warpSweep);
buildOne('geo-options', optionMatrix);
buildOne('geo-multisub', multiSubfunc);
buildOne('geo-kinematics', kinematicsSweep);
buildOne('geo-freeform-only', freeformOnly);
buildOne('geo-length-threshold', lengthThreshold);
buildOne('geo-trig-isolation', transcendentalIsolation);
buildOne('bez-basic', bezBasic);
buildOne('bez-roll', bezRoll);
buildOne('mixed-all', mixedAll);
buildOne('smooth-roll', smoothRoll);
buildOne('smooth-iter', smoothIter);
// eslint-disable-next-line no-console
console.log('done.');
