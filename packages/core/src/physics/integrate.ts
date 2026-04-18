// SPDX-License-Identifier: AGPL-3.0-only

import { vec3 } from 'gl-matrix';

import { F_G, F_HZ, HEART_ENERGY_FACTOR } from '../model/constants.js';
import { SecType } from '../model/enums.js';
import { type Func } from '../model/function.js';
import { allocateMNodeArrays, type MNodeArrays } from '../model/mnode.js';
import {
  type AnchorSection,
  type BezierSection,
  type Section,
  type StraightSection,
} from '../model/section.js';
import { type Track } from '../model/track.js';

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

  let idx = -1;
  for (const section of track.sections) {
    sectionStartNodes.push(idx + 1);
    idx = integrateSection(section, arrays, idx, track.heart);
  }
  arrays.length = idx + 1;
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
    default:
      throw new Error(`Section type not yet implemented: ${SecType[section.type]}`);
  }
}

// Scratch buffers reused across steps so the inner loop never allocates.
const tmp0 = vec3.create();
const tmp1 = vec3.create();
const tmp2 = vec3.create();

function integrateAnchor(section: AnchorSection, arrays: MNodeArrays, heart: number): number {
  const idx = 0;

  // Right-handed Y-up world. dir = forward, lat = rider's right, norm = up.
  // At rest: forward=+X, right=+Z, up=+Y, and norm = cross(lat, dir) = +Y.
  // Spec §4.2 writes `norm = cross(dir, lat)`, but that assumes Y-down; the
  // viewport (Three.js) and Vite dev build both use Y-up, so we flip the
  // cross order once here and stay Y-up through the whole pipeline.
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
    // Heart-path y offsets by `heart` along the normal; keep the simplified
    // form from track.cpp:50 (0.9×heart) so energy matches FVD++.
    energy:
      0.5 * section.speed * section.speed +
      F_G * heartY(section.position, norm, heart) * HEART_ENERGY_FACTOR,
    distFromLast: 0,
    heartDistFromLast: 0,
    totalLength: 0,
    totalHeartLength: 0,
    forceNormal: projectGravity(norm),
    forceLateral: projectGravity(lat),
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
    const energy = arrays.energy[idx - 1]!;

    // Roll at this point of the section.
    arcLength += clippedStep;
    const rollAbs = evalRoll(section.rollFunc, arcLength);
    const prevRoll = arrays.roll[idx - 1]!;
    const dRoll = rollAbs - prevRoll;

    // Rotate lateral axis around dir by dRoll; recompute normal with the
    // same cross(lat, dir) ordering as the anchor for Y-up consistency.
    const lat = vec3.set(tmp1, arrays.latX[idx - 1]!, arrays.latY[idx - 1]!, arrays.latZ[idx - 1]!);
    rotateAroundAxis(lat, lat, dir, dRoll);
    const norm = vec3.create();
    vec3.cross(norm, lat, dir);

    // Velocity from energy conservation at the new heart-path y.
    const yH = posY + norm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH * HEART_ENERGY_FACTOR;
    const vel = kinetic > 0 ? Math.sqrt(2 * kinetic) : 0;

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
  const [p0, p1, p2, p3] = section.controlPoints;
  const table = sampleArcLengthTable(p0, p1, p2, p3, BEZIER_ARC_SAMPLES);
  const totalArc = table[table.length - 1]!;
  if (totalArc <= 0) return lastIdx;

  const dt = 1 / F_HZ;
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

    const rollAbs = evalRoll(section.rollFunc, sectionArc);
    const prevRoll = arrays.roll[idx - 1]!;
    rotateAroundAxis(bezierLat, bezierLat, bezierTangent, rollAbs - prevRoll);
    vec3.cross(bezierNorm, bezierLat, bezierTangent);

    const energy = arrays.energy[idx - 1]!;
    const yH = bezierPos[1] + bezierNorm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH * HEART_ENERGY_FACTOR;
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
  arrays.smoothNormal[i] = n.forceNormal;
  arrays.smoothLateral[i] = n.forceLateral;
  arrays.distFromLast[i] = n.distFromLast;
  arrays.heartDistFromLast[i] = n.heartDistFromLast;
  arrays.totalLength[i] = n.totalLength;
  arrays.totalHeartLength[i] = n.totalHeartLength;
}

function heartY(position: readonly [number, number, number], norm: vec3, heart: number): number {
  return position[1] + norm[1] * heart * HEART_ENERGY_FACTOR;
}

// Gravity (world: [0, -F_G, 0]) projected onto a unit axis and returned as a
// dimensionless g multiple. Sign follows FVD++: forceNormal is positive when
// the rider is pressed into their seat, forceLateral is positive to the
// right.
function projectGravity(axis: vec3): number {
  return -(-F_G * axis[1]) / F_G;
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
