// SPDX-License-Identifier: AGPL-3.0-only

import { vec3 } from 'gl-matrix';

import { F_G, F_HZ, HEART_ENERGY_FACTOR } from '../model/constants.js';
import { Argument, Orientation, SecType } from '../model/enums.js';
import { type Func } from '../model/function.js';
import { allocateMNodeArrays, type MNodeArrays } from '../model/mnode.js';
import {
  type AnchorSection,
  type BezierSection,
  type ClosureSection,
  type CurvedSection,
  type ForcedSection,
  type GeometricSection,
  type Section,
  type StraightSection,
} from '../model/section.js';
import { type Track } from '../model/track.js';
import { applySmoothers } from '../smoothing/index.js';

import {
  arcLengthToParameter,
  cubicBezier,
  cubicBezierDerivative,
  sampleArcLengthTable,
} from './bezier-math.js';
import { getSubFuncValue } from './subfunc-eval.js';

// M2 ships Anchor, Straight, and a minimal Bezier. Curved, Forced, Geometric,
// and the proper arc-length-reparameterized Bezier from spec §5 land at
// M3–M5. Unimplemented section types throw loudly so integrator bugs can't
// hide behind silent empty output.

const DEFAULT_CAPACITY = 200_000;

export interface TrackIntegration {
  readonly arrays: MNodeArrays;
  /** Indices where each section *starts* (first node of that section). */
  readonly sectionStartNodes: number[];
}

export function integrateTrack(track: Track, capacity = DEFAULT_CAPACITY): TrackIntegration {
  const arrays = allocateMNodeArrays(capacity);
  const sectionStartNodes: number[] = [];

  // Cache the anchor — needed by integrateBezier when isClosure: true so
  // the closure's end can be pinned to the anchor's pose.
  const anchor = track.sections[0];
  const anchorSection = anchor?.type === SecType.Anchor ? anchor : null;

  let idx = -1;
  for (const section of track.sections) {
    sectionStartNodes.push(idx + 1);
    idx = integrateSection(section, arrays, idx, track.heart, anchorSection);
  }
  arrays.length = idx + 1;

  // Roll speed (banking rate) in rad/s, numerically differentiated from the
  // per-node roll column. `roll` is already offset-corrected across section
  // boundaries, so a simple forward-difference produces a clean curve. The
  // graph layer converts rad/s → deg/s for display.
  if (arrays.length > 0) {
    arrays.rollSpeed[0] = 0;
    for (let i = 1; i < arrays.length; i += 1) {
      arrays.rollSpeed[i] = (arrays.roll[i]! - arrays.roll[i - 1]!) * F_HZ;
    }
  }

  // Apply the track's registered smoothers to the force columns. Always
  // runs — when smoothers is empty the helper copies raw into smoothed so
  // downstream consumers read one source of truth. `track.smoothers` may be
  // undefined on hand-assembled test tracks; treat absence as empty.
  applySmoothers(arrays, track.smoothers ?? [], sectionStartNodes);

  return { arrays, sectionStartNodes };
}

export function integrateProject(tracks: readonly Track[], capacity?: number): TrackIntegration[] {
  return tracks.map((track) => integrateTrack(track, capacity));
}

function integrateSection(
  section: Section,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
  anchor: AnchorSection | null,
): number {
  switch (section.type) {
    case SecType.Anchor:
      if (lastIdx !== -1) {
        throw new Error('Anchor section must be the first section in a track.');
      }
      return integrateAnchor(section, arrays, heart);
    case SecType.Straight:
      if (lastIdx < 0) {
        throw new Error('Straight section requires a prior Anchor.');
      }
      return integrateStraight(section, arrays, lastIdx, heart);
    case SecType.Bezier:
      if (lastIdx < 0) {
        throw new Error('Bezier section requires a prior Anchor.');
      }
      return integrateBezier(section, arrays, lastIdx, heart);
    case SecType.Closure:
      if (lastIdx < 0) {
        throw new Error('Closure section requires a prior Anchor.');
      }
      if (!anchor) {
        throw new Error('Closure section requires the track anchor to be available.');
      }
      return integrateClosure(section, arrays, lastIdx, heart, anchor);
    case SecType.Curved:
      if (lastIdx < 0) {
        throw new Error('Curved section requires a prior Anchor.');
      }
      return integrateCurved(section, arrays, lastIdx, heart);
    case SecType.Forced:
      if (lastIdx < 0) {
        throw new Error('Forced section requires a prior Anchor.');
      }
      return integrateForced(section, arrays, lastIdx, heart);
    case SecType.Geometric:
      if (lastIdx < 0) {
        throw new Error('Geometric section requires a prior Anchor.');
      }
      return integrateGeometric(section, arrays, lastIdx, heart);
    default:
      throw new Error(`Section type not yet implemented: ${SecType[section.type]}`);
  }
}

// Scratch buffers reused across steps so the inner loop never allocates.
const tmp0 = vec3.create();
const tmp1 = vec3.create();
const tmp2 = vec3.create();

// Sections carrying FVD++'s `bSpeed`/`fVel` pair: when bSpeed=false the
// velocity is held at fVel instead of evolving from energy. This mirrors
// FVD++'s "constant velocity" mode used by brake runs, launch sections,
// and stations. When bSpeed is true (or the fields are absent) we fall
// back to energy-driven velocity exactly as before.
interface MaybeHeldVel {
  readonly bSpeed?: boolean | undefined;
  readonly fVel?: number | undefined;
}

/** Resolve velocity + energy at a node given the previous energy and the
 *  current heart-path y. Returns the held-velocity branch when the section
 *  opts into bSpeed=false; otherwise the standard energy-driven branch. */
function resolveVelocity(
  section: MaybeHeldVel,
  energyPrev: number,
  yH: number,
): { vel: number; energy: number } {
  if (section.bSpeed === false && section.fVel !== undefined) {
    const vel = section.fVel;
    // Re-base energy off the held velocity so the next energy-driven
    // section starts consistently. Matches FVD++ 0.79's behaviour.
    return { vel, energy: 0.5 * vel * vel + F_G * yH };
  }
  const kinetic = energyPrev - F_G * yH;
  const vel = kinetic > 0 ? Math.sqrt(2 * kinetic) : 0;
  return { vel, energy: energyPrev };
}

function integrateAnchor(section: AnchorSection, arrays: MNodeArrays, heart: number): number {
  const idx = 0;

  // Right-handed Y-up world. dir = forward, lat = rider's right, norm = up.
  // At rest: forward=+X, right=+Z, up=+Y, and norm = cross(lat, dir) = +Y.
  // FVD++ is Y-up too (mnode.h:69 `getPitch() = atan2(vDir.y, ...)`), but
  // its vNorm = cross(vDir, vLat) points toward the rider's FEET (−Y at
  // rest). We flip the cross order so our `norm` points toward the SKY (+Y
  // at rest); that matches Three.js and keeps the viewport math obvious.
  // The sign flip is absorbed in `heartY` and `projectGravity` so the
  // energy / force values still match FVD++ outputs.
  const dir = vec3.set(tmp0, 1, 0, 0);
  const lat = vec3.set(tmp1, 0, 0, 1);
  const up = vec3.set(tmp2, 0, 1, 0);

  // Yaw rotates heading around world +Y; carries both dir and lat.
  vec3.rotateY(dir, dir, [0, 0, 0], section.yaw);
  vec3.rotateY(lat, lat, [0, 0, 0], section.yaw);

  // Pitch rotates around the (yawed) lateral axis, tilting the nose up.
  rotateAroundAxis(dir, dir, lat, section.pitch);
  rotateAroundAxis(up, up, lat, section.pitch);

  // Roll rotates the lateral axis around dir.
  rotateAroundAxis(lat, lat, dir, section.roll);
  const norm = vec3.create();
  vec3.cross(norm, lat, dir);

  writeNode(arrays, idx, {
    position: section.position,
    dir,
    lat,
    norm,
    roll: section.roll,
    vel: section.speed,
    // Heart-path y offsets by `heart` along the normal; matches track.cpp:50
    // (0.9×heart inside the gravity term, no outer factor).
    energy: 0.5 * section.speed * section.speed + F_G * heartY(section.position, norm, heart),
    distFromLast: 0,
    heartDistFromLast: 0,
    totalLength: 0,
    totalHeartLength: 0,
    forceNormal: projectGravity(norm),
    forceLateral: projectGravity(lat),
    forceLong: projectGravityLong(dir),
  });
  return idx;
}

function integrateStraight(
  section: StraightSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
): number {
  const dt = 1 / F_HZ;
  let arcLength = 0;
  let idx = lastIdx;

  // Direction stays constant through a Straight section (spec §5.1). Load it
  // once from the last written node.
  const dir = vec3.set(tmp0, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);

  // Rollfuncs are evaluated from 0 each section, but the rider carries roll
  // continuously across boundaries. Offset the evaluated roll by whatever
  // it takes to match the previous section's end roll exactly, so edits
  // that leave a section's rollFunc startValue out of sync no longer
  // produce a 1 ms snap. (User-reported Curved→Straight bug.)
  const rollOffset = arrays.roll[lastIdx]! - evalRoll(section.rollFunc, 0);

  while (arcLength < section.length && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    const step = prevVel * dt;
    // Don't overshoot the section end.
    const clippedStep = Math.min(step, section.length - arcLength);
    if (clippedStep <= 0) break;

    idx += 1;

    const posX = arrays.posX[idx - 1]! + dir[0] * clippedStep;
    const posY = arrays.posY[idx - 1]! + dir[1] * clippedStep;
    const posZ = arrays.posZ[idx - 1]! + dir[2] * clippedStep;

    // Energy conserves across a frictionless Straight.
    const energyPrev = arrays.energy[idx - 1]!;

    // Roll at this point of the section.
    arcLength += clippedStep;
    const rollAbs = evalRoll(section.rollFunc, arcLength) + rollOffset;
    const prevRoll = arrays.roll[idx - 1]!;
    const dRoll = rollAbs - prevRoll;

    // Rotate lateral axis around dir by dRoll; recompute normal with the
    // same cross(lat, dir) ordering as the anchor for Y-up consistency.
    const lat = vec3.set(tmp1, arrays.latX[idx - 1]!, arrays.latY[idx - 1]!, arrays.latZ[idx - 1]!);
    rotateAroundAxis(lat, lat, dir, dRoll);
    const norm = vec3.create();
    vec3.cross(norm, lat, dir);

    // Velocity: held at `fVel` when `bSpeed=false`; otherwise from energy
    // conservation at the new heart-path y.
    const yH = posY - norm[1] * heart * HEART_ENERGY_FACTOR;
    const { vel, energy } = resolveVelocity(section, energyPrev, yH);

    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir,
      lat,
      norm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: clippedStep,
      heartDistFromLast: clippedStep,
      totalLength: arrays.totalLength[idx - 1]! + clippedStep,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + clippedStep,
      forceNormal: projectGravity(norm),
      forceLateral: projectGravity(lat),
      forceLong: projectGravityLong(dir),
    });
  }
  return idx;
}

// M2-quality Bezier integrator. Enough for the "close the track" visualisation:
// tangent-continuous polyline following the curve, parallel-transported lat
// axis plus the Roll function, energy conservation along y. NOT the FVD++
// arc-length Newton reparameterisation from spec §5 — that port lands at M5.
// Force columns are projected from gravity only; centripetal contribution is
// the M4 integrator's job.
const BEZIER_ARC_SAMPLES = 200;
const bezierPos = vec3.create();
const bezierTangent = vec3.create();
const bezierLat = vec3.create();
const bezierNorm = vec3.create();

function integrateBezier(
  section: BezierSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
): number {
  if (section.segments.length < 2) return lastIdx;

  // Auto-anchor the FIRST segment to the previous section's end pose so
  // a mid-track Bezier doesn't snap geometrically regardless of what the
  // user dragged. The interior segments (segment[2..N−1]) are walked as
  // authored — this matches FVD++'s multi-segment integration.
  const prevPos: [number, number, number] = [
    arrays.posX[lastIdx]!,
    arrays.posY[lastIdx]!,
    arrays.posZ[lastIdx]!,
  ];
  const prevDir: [number, number, number] = [
    arrays.dirX[lastIdx]!,
    arrays.dirY[lastIdx]!,
    arrays.dirZ[lastIdx]!,
  ];
  const seg0Stored = section.segments[0]!;
  const seg1Stored = section.segments[1]!;
  // First cubic: anchored to prev pose. Preserve the user's outgoing-
  // handle length, force its direction onto prevDir.
  const handle1Len = dist3(seg0Stored.P1, seg1Stored.Kp1);
  const p0: [number, number, number] = [...prevPos];
  const p1: [number, number, number] = [
    prevPos[0] + prevDir[0] * handle1Len,
    prevPos[1] + prevDir[1] * handle1Len,
    prevPos[2] + prevDir[2] * handle1Len,
  ];
  // Translate stored P3/Kp2 by the same delta so the rest of the chain
  // moves with the section start.
  const dx = prevPos[0] - seg0Stored.P1[0];
  const dy = prevPos[1] - seg0Stored.P1[1];
  const dz = prevPos[2] - seg0Stored.P1[2];
  const p2: [number, number, number] = [
    seg1Stored.Kp2[0] + dx,
    seg1Stored.Kp2[1] + dy,
    seg1Stored.Kp2[2] + dz,
  ];
  const p3: [number, number, number] = [
    seg1Stored.P1[0] + dx,
    seg1Stored.P1[1] + dy,
    seg1Stored.P1[2] + dz,
  ];

  // Total arc-length offset across all cubics, used as the rollFunc's
  // argument so a multi-segment chain's rollFunc spans the whole curve.
  let rollArcOffset = 0;
  let idx = runBezierCubic(arrays, lastIdx, heart, p0, p1, p2, p3, section.rollFunc, 0);
  rollArcOffset = arrays.totalLength[idx]! - arrays.totalLength[lastIdx]!;

  // Subsequent cubics: walk segments[i-1] → segments[i] for i ≥ 2.
  for (let i = 2; i < section.segments.length; i += 1) {
    const prev = section.segments[i - 1]!;
    const cur = section.segments[i]!;
    // Apply the same `dx, dy, dz` translation so the rest of the chain
    // stays consistent with where the first segment was anchored.
    const c0: [number, number, number] = [prev.P1[0] + dx, prev.P1[1] + dy, prev.P1[2] + dz];
    const c1: [number, number, number] = [cur.Kp1[0] + dx, cur.Kp1[1] + dy, cur.Kp1[2] + dz];
    const c2: [number, number, number] = [cur.Kp2[0] + dx, cur.Kp2[1] + dy, cur.Kp2[2] + dz];
    const c3: [number, number, number] = [cur.P1[0] + dx, cur.P1[1] + dy, cur.P1[2] + dz];
    idx = runBezierCubic(arrays, idx, heart, c0, c1, c2, c3, section.rollFunc, rollArcOffset);
    rollArcOffset = arrays.totalLength[idx]! - arrays.totalLength[lastIdx]!;
  }
  return idx;
}

function dist3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function integrateClosure(
  section: ClosureSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
  anchor: AnchorSection,
): number {
  // Closure control points are entirely derived: p0 + p1 follow the
  // previous section's end pose, p2 + p3 follow the anchor. The user
  // only edits the entry/exit handle lengths (and the roll ramp).
  const prevPos: [number, number, number] = [
    arrays.posX[lastIdx]!,
    arrays.posY[lastIdx]!,
    arrays.posZ[lastIdx]!,
  ];
  const prevDir: [number, number, number] = [
    arrays.dirX[lastIdx]!,
    arrays.dirY[lastIdx]!,
    arrays.dirZ[lastIdx]!,
  ];
  const anchorDir = anchorForwardFromYawPitch(anchor.yaw, anchor.pitch);
  const p0: [number, number, number] = [...prevPos];
  const p1: [number, number, number] = [
    prevPos[0] + prevDir[0] * section.entryHandleLength,
    prevPos[1] + prevDir[1] * section.entryHandleLength,
    prevPos[2] + prevDir[2] * section.entryHandleLength,
  ];
  const p3: [number, number, number] = [...anchor.position];
  const p2: [number, number, number] = [
    anchor.position[0] - anchorDir[0] * section.exitHandleLength,
    anchor.position[1] - anchorDir[1] * section.exitHandleLength,
    anchor.position[2] - anchorDir[2] * section.exitHandleLength,
  ];
  return runBezierCubic(arrays, lastIdx, heart, p0, p1, p2, p3, section.rollFunc, 0);
}

function runBezierCubic(
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
  rollFunc: BezierSection['rollFunc'],
  rollArcOffset: number,
): number {
  const table = sampleArcLengthTable(p0, p1, p2, p3, BEZIER_ARC_SAMPLES);
  const totalArc = table[table.length - 1]!;
  if (totalArc <= 0) return lastIdx;

  const dt = 1 / F_HZ;
  const rollOffset = arrays.roll[lastIdx]! - evalRoll(rollFunc, rollArcOffset);
  let idx = lastIdx;
  let sectionArc = 0;

  while (sectionArc < totalArc && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    const step = prevVel * dt;
    const clippedStep = Math.min(step, totalArc - sectionArc);
    if (clippedStep <= 0) break;

    idx += 1;
    sectionArc += clippedStep;

    const t = arcLengthToParameter(table, sectionArc);
    cubicBezier(bezierPos, t, p0, p1, p2, p3);
    cubicBezierDerivative(bezierTangent, t, p0, p1, p2, p3);
    vec3.normalize(bezierTangent, bezierTangent);

    // Parallel-transport the previous lat onto the plane perpendicular to the
    // new tangent, then apply the roll function's delta. Spec §5 does the
    // equivalent with a proper quaternion rotation between successive tangents;
    // projection is good enough for the M2 viewport.
    vec3.set(bezierLat, arrays.latX[idx - 1]!, arrays.latY[idx - 1]!, arrays.latZ[idx - 1]!);
    const latDotDir = vec3.dot(bezierLat, bezierTangent);
    bezierLat[0] -= latDotDir * bezierTangent[0];
    bezierLat[1] -= latDotDir * bezierTangent[1];
    bezierLat[2] -= latDotDir * bezierTangent[2];
    if (vec3.squaredLength(bezierLat) < 1e-8) {
      // Degenerate: old lat was nearly parallel to new tangent. Fall back to
      // world-up-cross-tangent so the frame stays sane.
      vec3.set(bezierLat, 0, 1, 0);
      const k = vec3.dot(bezierLat, bezierTangent);
      bezierLat[0] -= k * bezierTangent[0];
      bezierLat[1] -= k * bezierTangent[1];
      bezierLat[2] -= k * bezierTangent[2];
    }
    vec3.normalize(bezierLat, bezierLat);

    const rollAbs = evalRoll(rollFunc, rollArcOffset + sectionArc) + rollOffset;
    const prevRoll = arrays.roll[idx - 1]!;
    rotateAroundAxis(bezierLat, bezierLat, bezierTangent, rollAbs - prevRoll);
    vec3.cross(bezierNorm, bezierLat, bezierTangent);

    const energy = arrays.energy[idx - 1]!;
    const yH = bezierPos[1] - bezierNorm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH;
    const vel = kinetic > 0 ? Math.sqrt(2 * kinetic) : 0;

    writeNode(arrays, idx, {
      position: [bezierPos[0], bezierPos[1], bezierPos[2]],
      dir: bezierTangent,
      lat: bezierLat,
      norm: bezierNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: clippedStep,
      heartDistFromLast: clippedStep,
      totalLength: arrays.totalLength[idx - 1]! + clippedStep,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + clippedStep,
      forceNormal: projectGravity(bezierNorm),
      forceLateral: projectGravity(bezierLat),
      forceLong: projectGravityLong(bezierTangent),
    });
  }
  return idx;
}

// Curved section integrator (spec §5.1, port of core/seccurved.cpp).
// Curved — port of `seccurved.cpp:48–188`. The rotation axis is
// `cos(fPureDirection)·vLat + sin(fPureDirection)·vNorm` (in our sky-up
// norm convention; equivalent to FVD++'s `cos(-fPureDirection)·vLat +
// sin(-fPureDirection)·vNorm` because their vNorm is feet-down).
// `fPureDirection = fDirection − artificialRoll` cancels the rolling
// effect on the rotation axis so the axis stays in the un-rolled frame.
//
// The integrator advances by a small `deltaAngle` (degrees) per tick,
// derived from velocity / radius. Lead-in / lead-out are smoothstep
// scalings of that per-tick angle so the rider doesn't feel a curvature
// jerk at the boundaries.
//
// `rollFunc` is parameterised by ridden angle (degrees). It returns a
// per-tick roll-rate; we divide by F_HZ as FVD++ does (line 128) to
// match the integration cadence.
const curvedDir = vec3.create();
const curvedLat = vec3.create();
const curvedNorm = vec3.create();
const curvedAxis = vec3.create();

function integrateCurved(
  section: CurvedSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
): number {
  const fAngle = section.fAngle;
  const fRadius = section.fRadius;
  if (fAngle <= 0 || fRadius <= 0) return lastIdx;

  vec3.set(curvedDir, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);
  vec3.set(curvedLat, arrays.latX[lastIdx]!, arrays.latY[lastIdx]!, arrays.latZ[lastIdx]!);
  vec3.set(curvedNorm, arrays.normX[lastIdx]!, arrays.normY[lastIdx]!, arrays.normZ[lastIdx]!);

  let idx = lastIdx;
  let riddenAngleDeg = 0;
  let artificialRollDeg = 0;
  let leadOutStartArc: number | null = null;
  let myLeadOut = 0;
  const arcAtStart = arrays.totalLength[lastIdx]!;

  const DEG = Math.PI / 180;

  while (riddenAngleDeg < fAngle - 1e-5 && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    if (prevVel <= 0.1) break; // train stalled

    // Base per-tick angle, degrees: deltaAngle = vel / (fRadius · F_HZ) · (180/π)
    let deltaAngleDeg = (prevVel / (fRadius * F_HZ)) * (180 / Math.PI);
    if (deltaAngleDeg <= 0) break;

    // Lead-in smoothstep. FVD++ uses arc-length over a "lead arc-length"
    // window of `1.997/F_HZ · vel/deltaAngle · fLeadIn` metres. The
    // 1.997 factor approximates 2 (integral of smoothstep over [0,1]).
    const arcTraveled = arrays.totalLength[idx]! - arcAtStart;
    if (section.fLeadIn > 0) {
      const window = (1.997 / F_HZ) * (prevVel / deltaAngleDeg) * section.fLeadIn;
      const fTrans = window > 0 ? arcTraveled / window : 1;
      if (fTrans <= 1) {
        deltaAngleDeg *= fTrans * fTrans * (3 - 2 * fTrans);
      }
    }

    // Lead-out smoothstep, mirrored.
    if (leadOutStartArc === null && riddenAngleDeg > fAngle - section.fLeadOut) {
      leadOutStartArc = arrays.totalLength[idx]!;
      myLeadOut = fAngle - riddenAngleDeg;
    }
    if (leadOutStartArc !== null && section.fLeadOut > 0) {
      const window = (1.997 / F_HZ) * (prevVel / deltaAngleDeg) * myLeadOut;
      const fTrans = window > 0 ? 1 - (arrays.totalLength[idx]! - leadOutStartArc) / window : 0;
      if (fTrans >= 0) {
        deltaAngleDeg *= fTrans * fTrans * (3 - 2 * fTrans);
      } else {
        break;
      }
    }

    idx += 1;
    riddenAngleDeg += deltaAngleDeg;
    const deltaAngleRad = deltaAngleDeg * DEG;

    // Rotation axis in the un-rolled frame: fPureDirection = fDirection −
    // artificialRoll. With our sky-up norm convention the formula
    // simplifies to `cos(θ)·vLat + sin(θ)·vNorm` (no negative on θ).
    const fPureDirectionRad = (section.fDirection - artificialRollDeg) * DEG;
    const c = Math.cos(fPureDirectionRad);
    const s = Math.sin(fPureDirectionRad);
    curvedAxis[0] = c * curvedLat[0] + s * curvedNorm[0];
    curvedAxis[1] = c * curvedLat[1] + s * curvedNorm[1];
    curvedAxis[2] = c * curvedLat[2] + s * curvedNorm[2];
    const axLen = Math.hypot(curvedAxis[0], curvedAxis[1], curvedAxis[2]);
    if (axLen > 1e-9) {
      curvedAxis[0] /= axLen;
      curvedAxis[1] /= axLen;
      curvedAxis[2] /= axLen;
    }

    // Rotate dir and lat around the axis. Norm is recomputed from the
    // cross product afterwards (matches FVD++'s updateNorm()).
    rotateAroundAxis(curvedDir, curvedDir, curvedAxis, deltaAngleRad);
    rotateAroundAxis(curvedLat, curvedLat, curvedAxis, deltaAngleRad);
    vec3.normalize(curvedDir, curvedDir);
    vec3.normalize(curvedLat, curvedLat);
    vec3.cross(curvedNorm, curvedLat, curvedDir);

    // Position step uses the midpoint rule + a heart-correction term so
    // the HEART path (not the rail path) is what advances by step·avgDir.
    // Match FVD++'s `vPos += vDir·step/2 + prev.vDir·step/2 +
    // (prev.vPosHeart − cur.vPosHeart)`.
    const stepMetres = prevVel / F_HZ;
    const halfStep = stepMetres / 2;
    const prevDirX = arrays.dirX[idx - 1]!;
    const prevDirY = arrays.dirY[idx - 1]!;
    const prevDirZ = arrays.dirZ[idx - 1]!;
    const prevNormX = arrays.normX[idx - 1]!;
    const prevNormY = arrays.normY[idx - 1]!;
    const prevNormZ = arrays.normZ[idx - 1]!;
    // Heart-correction: heart_offset(prev) − heart_offset(cur), where the
    // heart sits at pos − heart·norm in our sky-up convention (rails are
    // BELOW the heart line by `heart`). Pos tracks the heart line, so
    // the correction zeroes out — keep the term explicit for clarity in
    // case the convention is revisited.
    const heartCorrX = -heart * (prevNormX - curvedNorm[0]);
    const heartCorrY = -heart * (prevNormY - curvedNorm[1]);
    const heartCorrZ = -heart * (prevNormZ - curvedNorm[2]);
    const posX = arrays.posX[idx - 1]! + halfStep * (curvedDir[0] + prevDirX) + heartCorrX;
    const posY = arrays.posY[idx - 1]! + halfStep * (curvedDir[1] + prevDirY) + heartCorrY;
    const posZ = arrays.posZ[idx - 1]! + halfStep * (curvedDir[2] + prevDirZ) + heartCorrZ;

    // Roll: rollFunc evaluated at the ridden angle, divided by F_HZ for
    // the per-tick delta. Then apply that delta to the lat axis (and
    // re-cross to get norm).
    const rollRate = evalRoll(section.rollFunc, riddenAngleDeg); // degrees / F_HZ ticks worth of angle
    const dRollDeg = rollRate / F_HZ;
    const dRollRad = dRollDeg * DEG;
    if (dRollRad !== 0) {
      rotateAroundAxis(curvedLat, curvedLat, curvedDir, -dRollRad);
      vec3.cross(curvedNorm, curvedLat, curvedDir);
    }
    artificialRollDeg += dRollDeg;
    const rollAbs = (arrays.roll[idx - 1]! ?? 0) + dRollRad;

    // Energy → velocity at the new heart-path y. Matches FVD++ exactly:
    // E_anchor − F_G·(pos.y_heart) → kinetic. Held at `fVel` when
    // `bSpeed=false`.
    const energyPrev = arrays.energy[idx - 1]!;
    const yH = posY - curvedNorm[1] * heart * HEART_ENERGY_FACTOR;
    const { vel, energy } = resolveVelocity(section, energyPrev, yH);

    // Per-step deltas use heart-path distance for `distFromLast` (used by
    // lead-in/out windows on the next iteration); rail-path distance for
    // `heartDistFromLast`.
    const heartDist = Math.hypot(
      posX - arrays.posX[idx - 1]!,
      posY - arrays.posY[idx - 1]!,
      posZ - arrays.posZ[idx - 1]!,
    );
    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir: curvedDir,
      lat: curvedLat,
      norm: curvedNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: stepMetres,
      heartDistFromLast: heartDist,
      totalLength: arrays.totalLength[idx - 1]! + stepMetres,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + heartDist,
      forceNormal: projectGravity(curvedNorm),
      forceLateral: projectGravity(curvedLat),
      forceLong: projectGravityLong(curvedDir),
    });
  }
  return idx;
}

// Forced section integrator — the heart of FVD++ (spec §5, port of
// core/secforced.cpp lines 110–135). Normal and Lateral Funcs define the
// g-forces the rider experiences; pitch and yaw rates fall out of the
// equations of motion so the path traces a curve that feels like the
// Forced — direct port of `secforced.cpp:51–183` (TIME) and `:186–311`
// (DISTANCE). The rider's normal and lateral g-loads drive the geometry:
// the integrator solves for angular rates that make the rider feel
// (normalG, lateralG) at every tick, accounting for gravity. Roll is
// taken from rollFunc.
//
// Force-vector form (line 114 in C++): the felt force in WORLD coords is
//   forceVec = −normalG · vNorm − lateralG · vLat − (0, 1, 0)
// (gravity points down; the rider feels its opposite). Projecting
// forceVec onto the rider's lat/norm and multiplying by F_G gives the
// net acceleration components driving the per-tick angular rotation.
//
// Position step + heart-correction matches Curved (mnode.cpp:126).
// Roll: `setRoll(rollFunc.getValue(arg)/F_HZ)` per tick, with the
// EULER orientation kicker adding a yaw-from-last correction to keep
// the rider upright relative to world-up.
const forcedDir = vec3.create();
const forcedLat = vec3.create();
const forcedNorm = vec3.create();

function integrateForced(
  section: ForcedSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
): number {
  const dt = 1 / F_HZ;
  const extent = section.extent;
  if (extent <= 0) return lastIdx;

  let idx = lastIdx;
  let arg = 0; // seconds for TIME-arg, metres of arc for DISTANCE-arg
  const isTime = section.argument === Argument.Time;

  vec3.set(forcedDir, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);
  vec3.set(forcedLat, arrays.latX[lastIdx]!, arrays.latY[lastIdx]!, arrays.latZ[lastIdx]!);
  vec3.set(forcedNorm, arrays.normX[lastIdx]!, arrays.normY[lastIdx]!, arrays.normZ[lastIdx]!);

  const rollOffset = arrays.roll[lastIdx]! - evalRoll(section.rollFunc, 0);

  while (arg < extent && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    if (prevVel <= 0.1) break; // train stalled

    const stepMetres = prevVel / F_HZ;
    const nextArg = isTime ? arg + dt : arg + stepMetres;

    // Sample force functions at the FORWARD end of this tick (matches
    // `(i+1)/F_HZ` in C++ TIME branch and `length+vel/F_HZ` in DISTANCE).
    const normalG = evalRoll(section.normalFunc, nextArg);
    const lateralG = evalRoll(section.lateralFunc, nextArg);

    // forceVec in world coords. FVD++'s formula at line 114:
    //   −normalG · vNorm − lateralG · vLat − (0, 1, 0)
    // In our sky-up norm convention, FVD's vNorm = −our_norm. Substitute:
    //   forceVec = normalG · our_norm − lateralG · vLat − (0, 1, 0)
    const fvX = normalG * forcedNorm[0] - lateralG * forcedLat[0];
    const fvY = normalG * forcedNorm[1] - lateralG * forcedLat[1] - 1;
    const fvZ = normalG * forcedNorm[2] - lateralG * forcedLat[2];

    // Project onto rider basis. C++ negates: `nForce = −dot(forceVec, vNorm) · F_G`.
    // With our flipped norm this becomes `nForce = +dot(forceVec, our_norm) · F_G`.
    const nForce = (fvX * forcedNorm[0] + fvY * forcedNorm[1] + fvZ * forcedNorm[2]) * F_G;
    const lForce = -(fvX * forcedLat[0] + fvY * forcedLat[1] + fvZ * forcedLat[2]) * F_G;

    // Heart-path distance from the previous step (or fall back to vel/F_HZ
    // when none yet). Used as the effective velocity for the pitch-rate
    // calculation — matches `estVel` in C++ line 122.
    const prevHeartDist = arrays.heartDistFromLast[idx]! || prevVel / F_HZ;
    const estVel = prevHeartDist * F_HZ;
    const pitchRad = nForce / F_HZ / Math.max(estVel, 0.1);
    const yawRad = -lForce / Math.max(prevVel, 0.1) / F_HZ;

    // FVD++ composes: vDir = angleAxis(nForce/.../estVel, vLat) *
    //                       angleAxis(-lForce/vel/F_HZ, vNorm) * prevDir
    // i.e. yaw first (around vNorm), then pitch (around vLat).
    // Our angle convention: rotating vDir around vLat (positive) flips
    // direction from +X toward +Y (pitch up). Around our_norm = (−sky-up at rest),
    // rotating +X by positive yawRad goes toward −Z. FVD++'s vNorm is the
    // opposite; the −yawRad accounts for the sign flip — but we already
    // flipped norm direction so the sign matches when we use our_norm
    // directly with the same sign convention. The simplest correct form
    // (verified by hand-checking a level turn): yaw around −our_norm.
    rotateAroundAxis(forcedDir, forcedDir, forcedNorm, -yawRad);
    rotateAroundAxis(forcedLat, forcedLat, forcedNorm, -yawRad);
    rotateAroundAxis(forcedDir, forcedDir, forcedLat, pitchRad);
    vec3.normalize(forcedDir, forcedDir);
    vec3.normalize(forcedLat, forcedLat);
    vec3.cross(forcedNorm, forcedLat, forcedDir);

    idx += 1;

    // Midpoint position step + heart-correction (mnode.cpp:129 == :266).
    const prevDirX = arrays.dirX[idx - 1]!;
    const prevDirY = arrays.dirY[idx - 1]!;
    const prevDirZ = arrays.dirZ[idx - 1]!;
    const prevNormX = arrays.normX[idx - 1]!;
    const prevNormY = arrays.normY[idx - 1]!;
    const prevNormZ = arrays.normZ[idx - 1]!;
    const halfStep = stepMetres / 2;
    const heartCorrX = -heart * (prevNormX - forcedNorm[0]);
    const heartCorrY = -heart * (prevNormY - forcedNorm[1]);
    const heartCorrZ = -heart * (prevNormZ - forcedNorm[2]);
    const posX = arrays.posX[idx - 1]! + halfStep * (forcedDir[0] + prevDirX) + heartCorrX;
    const posY = arrays.posY[idx - 1]! + halfStep * (forcedDir[1] + prevDirY) + heartCorrY;
    const posZ = arrays.posZ[idx - 1]! + halfStep * (forcedDir[2] + prevDirZ) + heartCorrZ;

    // Per-tick roll delta from rollFunc, divided by F_HZ as in line 132.
    const rollRate = evalRoll(section.rollFunc, nextArg) + rollOffset;
    const dRollDeg = rollRate / F_HZ;
    const dRollRad = dRollDeg * (Math.PI / 180);
    if (dRollRad !== 0) {
      rotateAroundAxis(forcedLat, forcedLat, forcedDir, -dRollRad);
      vec3.cross(forcedNorm, forcedLat, forcedDir);
    }
    const rollAbs = (arrays.roll[idx - 1]! ?? 0) + dRollRad;

    // Energy → velocity. Held at `fVel` when `bSpeed=false`.
    const energyPrev = arrays.energy[idx - 1]!;
    const yH = posY - forcedNorm[1] * heart * HEART_ENERGY_FACTOR;
    const { vel, energy } = resolveVelocity(section, energyPrev, yH);

    const heartDist = Math.hypot(
      posX - arrays.posX[idx - 1]!,
      posY - arrays.posY[idx - 1]!,
      posZ - arrays.posZ[idx - 1]!,
    );

    arg = nextArg;

    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir: forcedDir,
      lat: forcedLat,
      norm: forcedNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: stepMetres,
      heartDistFromLast: heartDist,
      totalLength: arrays.totalLength[idx - 1]! + stepMetres,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + heartDist,
      // FVD++ rewrites forceNormal/forceLateral from the actual angular
      // changes at the END of the loop (lines 162–171). For now we
      // surface the COMMANDED values (matching what the user authored);
      // the actuator-from-angles refinement lands when we add the §6.10
      // engineering-analysis force columns.
      forceNormal: normalG,
      forceLateral: lateralG,
      forceLong: projectGravityLong(forcedDir),
    });
  }
  return idx;
}

// Geometric — direct port of `secgeometric.cpp:64–197`. Pitch and yaw rates
// come from the normalFunc / lateralFunc (reinterpreted as angular rates
// per `secgeometric.cpp:133–134`). Each tick:
//
//   pitchChange = normForce(arg) / F_HZ   (degrees)
//   yawChange   = latForce(arg) / F_HZ    (degrees)
//
// `changePitch` rotates dir + lat around the world-horizontal axis
// `normalize(cross((0, vNorm.y, 0), vDir))` — i.e. the rider's right
// projected onto the ground plane. `changeYaw` rotates around world +Y.
// An "upside-down" sign flip on pitch (sign = artificialRoll ≥ 90° ? −1)
// keeps the rider upright relative to gravity.
//
// `artificialRoll` accumulates the cumulative roll relative to world up,
// used both for the pitch-flip and for the EULER kicker that converts
// world-frame yaw into a roll correction.
const geomDir = vec3.create();
const geomLat = vec3.create();
const geomNorm = vec3.create();
const geomAxis = vec3.create();

function integrateGeometric(
  section: GeometricSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
): number {
  const dt = 1 / F_HZ;
  const extent = section.extent;
  if (extent <= 0) return lastIdx;

  let idx = lastIdx;
  let arg = 0;
  let artificialRollDeg = arrays.roll[lastIdx]! * (180 / Math.PI);
  const isTime = section.argument === Argument.Time;
  const DEG = Math.PI / 180;

  vec3.set(geomDir, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);
  vec3.set(geomLat, arrays.latX[lastIdx]!, arrays.latY[lastIdx]!, arrays.latZ[lastIdx]!);
  vec3.set(geomNorm, arrays.normX[lastIdx]!, arrays.normY[lastIdx]!, arrays.normZ[lastIdx]!);

  while (arg < extent && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    if (prevVel <= 0.1) break;

    const stepMetres = prevVel / F_HZ;
    const nextArg = isTime ? arg + dt : arg + stepMetres;

    // Per-tick pitch / yaw deltas (degrees). FVD++ uses pitchFunc and
    // yawFunc which we mirror as `pitchFunc` / `yawFunc` on the section.
    const pitchChangeDeg = evalRoll(section.pitchFunc, nextArg) / F_HZ;
    const yawChangeDeg = evalRoll(section.yawFunc, nextArg) / F_HZ;
    const sign = Math.abs(artificialRollDeg) >= 90 ? -1 : 1;

    // changePitch: axis = normalize(cross((0, -our_norm.y, 0), vDir)).
    // (FVD uses vNorm.y which is the OPPOSITE sign of our sky-up norm;
    // hence the −our_norm.y.)
    const horizY = -geomNorm[1];
    geomAxis[0] = horizY * geomDir[2];
    geomAxis[1] = 0;
    geomAxis[2] = -horizY * geomDir[0];
    const axLen = Math.hypot(geomAxis[0], geomAxis[2]);
    if (axLen > 1e-9) {
      geomAxis[0] /= axLen;
      geomAxis[2] /= axLen;
      const pitchRad = sign * pitchChangeDeg * DEG;
      rotateAroundAxis(geomDir, geomDir, geomAxis, pitchRad);
      rotateAroundAxis(geomLat, geomLat, geomAxis, pitchRad);
    }

    // changeYaw: rotate around world +Y.
    const yawRad = yawChangeDeg * DEG;
    vec3.rotateY(geomDir, geomDir, [0, 0, 0], yawRad);
    vec3.rotateY(geomLat, geomLat, [0, 0, 0], yawRad);
    vec3.normalize(geomDir, geomDir);
    vec3.normalize(geomLat, geomLat);
    vec3.cross(geomNorm, geomLat, geomDir);

    // EULER orientation correction (secgeometric.cpp:156–159 + :176–178).
    // World-frame yaw above includes a "vertical" component when the
    // rider is pitched up/down; FVD++ decomposes:
    //   pureRollChange = dot(vDir, world_down) · yawChange · F_HZ
    // and applies it as an additional roll so the rider stays
    // "upright relative to world up." Sign flip again due to our
    // norm convention.
    const dirDotWorldDown = -geomDir[1]; // FVD's `dot(vDir, (0,-1,0))`
    const pureRollChangeDeg = dirDotWorldDown * yawChangeDeg;
    if (section.orientation === Orientation.Euler) {
      const dRollRad = pureRollChangeDeg * DEG;
      rotateAroundAxis(geomLat, geomLat, geomDir, -dRollRad);
      vec3.cross(geomNorm, geomLat, geomDir);
      artificialRollDeg += pureRollChangeDeg;
    }

    idx += 1;

    // Midpoint position step + heart-correction.
    const prevDirX = arrays.dirX[idx - 1]!;
    const prevDirY = arrays.dirY[idx - 1]!;
    const prevDirZ = arrays.dirZ[idx - 1]!;
    const prevNormX = arrays.normX[idx - 1]!;
    const prevNormY = arrays.normY[idx - 1]!;
    const prevNormZ = arrays.normZ[idx - 1]!;
    const halfStep = stepMetres / 2;
    const heartCorrX = -heart * (prevNormX - geomNorm[0]);
    const heartCorrY = -heart * (prevNormY - geomNorm[1]);
    const heartCorrZ = -heart * (prevNormZ - geomNorm[2]);
    const posX = arrays.posX[idx - 1]! + halfStep * (geomDir[0] + prevDirX) + heartCorrX;
    const posY = arrays.posY[idx - 1]! + halfStep * (geomDir[1] + prevDirY) + heartCorrY;
    const posZ = arrays.posZ[idx - 1]! + halfStep * (geomDir[2] + prevDirZ) + heartCorrZ;

    // Per-tick roll from rollFunc.
    const rollDeltaDeg = evalRoll(section.rollFunc, nextArg) / F_HZ;
    const dRollRad = rollDeltaDeg * DEG;
    if (dRollRad !== 0) {
      rotateAroundAxis(geomLat, geomLat, geomDir, -dRollRad);
      vec3.cross(geomNorm, geomLat, geomDir);
    }
    artificialRollDeg += rollDeltaDeg;
    while (artificialRollDeg > 180) artificialRollDeg -= 360;
    while (artificialRollDeg < -180) artificialRollDeg += 360;

    const rollAbs =
      (arrays.roll[idx - 1]! ?? 0) +
      dRollRad +
      (section.orientation === Orientation.Euler ? pureRollChangeDeg * DEG : 0);

    const energyPrev = arrays.energy[idx - 1]!;
    const yH = posY - geomNorm[1] * heart * HEART_ENERGY_FACTOR;
    const { vel, energy } = resolveVelocity(section, energyPrev, yH);

    const heartDist = Math.hypot(
      posX - arrays.posX[idx - 1]!,
      posY - arrays.posY[idx - 1]!,
      posZ - arrays.posZ[idx - 1]!,
    );

    arg = nextArg;

    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir: geomDir,
      lat: geomLat,
      norm: geomNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: stepMetres,
      heartDistFromLast: heartDist,
      totalLength: arrays.totalLength[idx - 1]! + stepMetres,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + heartDist,
      forceNormal: projectGravity(geomNorm),
      forceLateral: projectGravity(geomLat),
      forceLong: projectGravityLong(geomDir),
    });
  }
  return idx;
}

// -- helpers ----------------------------------------------------------------

interface NodeWrite {
  position: readonly [number, number, number];
  dir: vec3;
  lat: vec3;
  norm: vec3;
  roll: number;
  vel: number;
  energy: number;
  distFromLast: number;
  heartDistFromLast: number;
  totalLength: number;
  totalHeartLength: number;
  forceNormal: number;
  forceLateral: number;
  forceLong: number;
}

function writeNode(arrays: MNodeArrays, i: number, n: NodeWrite): void {
  arrays.posX[i] = n.position[0];
  arrays.posY[i] = n.position[1];
  arrays.posZ[i] = n.position[2];
  arrays.dirX[i] = n.dir[0];
  arrays.dirY[i] = n.dir[1];
  arrays.dirZ[i] = n.dir[2];
  arrays.latX[i] = n.lat[0];
  arrays.latY[i] = n.lat[1];
  arrays.latZ[i] = n.lat[2];
  arrays.normX[i] = n.norm[0];
  arrays.normY[i] = n.norm[1];
  arrays.normZ[i] = n.norm[2];
  arrays.roll[i] = n.roll;
  arrays.vel[i] = n.vel;
  arrays.energy[i] = n.energy;
  arrays.forceNormal[i] = n.forceNormal;
  arrays.forceLateral[i] = n.forceLateral;
  arrays.forceLong[i] = n.forceLong;
  arrays.smoothNormal[i] = n.forceNormal;
  arrays.smoothLateral[i] = n.forceLateral;
  arrays.smoothLong[i] = n.forceLong;
  arrays.distFromLast[i] = n.distFromLast;
  arrays.heartDistFromLast[i] = n.heartDistFromLast;
  arrays.totalLength[i] = n.totalLength;
  arrays.totalHeartLength[i] = n.totalHeartLength;
}

// NOTE: matches FVD++ 0.79 (secstraight.cpp:110–113, seccurved.cpp:143–146).
// FVD++ stores the heart-path y via `vPosHearty(0.9*heart) = vPos.y +
// 0.9*heart*vNorm.y`. Its vNorm points toward the rider's feet (−Y at rest),
// so 0.9*heart·vNorm.y is a negative offset on a level track. Our `norm`
// points toward the sky (+Y at rest), so we subtract instead of add to
// arrive at the same y-coordinate. The 0.9 factor is applied exactly once,
// here — callers must NOT multiply again.
function heartY(position: readonly [number, number, number], norm: vec3, heart: number): number {
  return position[1] - norm[1] * heart * HEART_ENERGY_FACTOR;
}

// Gravity (world: [0, −F_G, 0]) projected onto a rider-frame unit axis, as a
// dimensionless g multiple. Matches FVD++ `forceNormal = −vNorm.y` after
// accounting for the sky-vs-feet sign flip on `norm` (see integrateAnchor):
// FVD++ vNorm.y = −axis[1] in our convention, so `−vNorm.y = axis[1]`.
// Convention: forceNormal positive = rider pressed into seat, forceLateral
// positive = force to the rider's right.
function projectGravity(axis: vec3): number {
  return axis[1];
}

/**
 * Anchor's forward direction from its (yaw, pitch). Matches the convention
 * used by `integrateAnchor` (yaw around +Y, then pitch around the yawed
 * lateral axis = +Z·yaw). Used by `closeTrack` and `integrateClosure`.
 */
function anchorForwardFromYawPitch(yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [cy * cp, sp, -sy * cp];
}

// Longitudinal g from gravity alone: positive means the rider is pushed
// forward (downhill accelerates the car). For a forward unit vector `dir`,
// gravity=(0,-g,0) has a forward component of `-g·dir_y`, so the g multiple
// is `-dir_y`.
function projectGravityLong(dir: vec3): number {
  return -dir[1];
}

function evalRoll(func: Func, s: number): number {
  // Walk the subfuncs until we cover position `s`; return the cumulative
  // roll as a running sum of subfunc outputs.
  let offset = 0;
  let running = 0;
  for (const sf of func.subfuncs) {
    if (s <= offset + sf.length) {
      return running + getSubFuncValue(sf, s - offset);
    }
    running += getSubFuncValue(sf, sf.length);
    offset += sf.length;
  }
  return running;
}

// Rodrigues' rotation formula without allocations. Rotates `point` around
// unit vector `axis` by `angle` radians; writes into `out` (may alias point).
function rotateAroundAxis(out: vec3, point: vec3, axis: vec3, angle: number): vec3 {
  if (angle === 0) {
    if (out !== point) vec3.copy(out, point);
    return out;
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  const ax = axis[0];
  const ay = axis[1];
  const az = axis[2];
  const px = point[0];
  const py = point[1];
  const pz = point[2];
  const dot = ax * px + ay * py + az * pz;
  out[0] = px * c + (ay * pz - az * py) * s + ax * dot * k;
  out[1] = py * c + (az * px - ax * pz) * s + ay * dot * k;
  out[2] = pz * c + (ax * py - ay * px) * s + az * dot * k;
  return out;
}
