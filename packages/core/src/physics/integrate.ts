// SPDX-License-Identifier: AGPL-3.0-only

import { vec3 } from 'gl-matrix';

import { F_G, F_HZ, HEART_ENERGY_FACTOR } from '../model/constants.js';
import { Argument, SecType } from '../model/enums.js';
import { type Func } from '../model/function.js';
import { allocateMNodeArrays, type MNodeArrays } from '../model/mnode.js';
import {
  type AnchorSection,
  type BezierSection,
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
import { getSubFuncValue, subFuncDerivativeAt } from './subfunc-eval.js';

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
      return integrateBezier(section, arrays, lastIdx, heart, anchor);
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
    const energy = arrays.energy[idx - 1]!;

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

    // Velocity from energy conservation at the new heart-path y.
    const yH = posY - norm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH;
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
  anchor: AnchorSection | null,
): number {
  // Auto-anchor the curve to the previous section's end pose. The user-
  // supplied control points provide the SHAPE; the position and the
  // entry-tangent are clamped to whatever the integrator actually
  // produced for the previous node, so a Bezier never introduces a
  // C0 jump regardless of what the user dragged.
  //
  // For closure sections (`isClosure: true`) the END is also clamped: p3
  // becomes the anchor's position and p2 sits along the anchor's
  // incoming direction (preserving the user's chosen handle length). The
  // closure therefore matches the start of the track even if the user
  // edits stored controlPoints by hand.
  const [p0, p1, p2, p3] = effectiveBezierControlPoints(section, arrays, lastIdx, anchor);
  const table = sampleArcLengthTable(p0, p1, p2, p3, BEZIER_ARC_SAMPLES);
  const totalArc = table[table.length - 1]!;
  if (totalArc <= 0) return lastIdx;

  const dt = 1 / F_HZ;
  const rollOffset = arrays.roll[lastIdx]! - evalRoll(section.rollFunc, 0);
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

    const rollAbs = evalRoll(section.rollFunc, sectionArc) + rollOffset;
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
// Constant pitch-rate and yaw-rate in rad/m; lead-in and lead-out ramp the
// rates from 0 through a cubic smoothstep so the rider doesn't feel a jerk
// at section boundaries.
//
// Force columns follow the same gravity projection as Straight. Centripetal
// contribution lands with M4's Forced integrator where forces drive the
// geometry rather than the other way round.
const curvedDir = vec3.create();
const curvedLat = vec3.create();
const curvedNorm = vec3.create();
const curvedHorizLat = vec3.create();

function integrateCurved(
  section: CurvedSection,
  arrays: MNodeArrays,
  lastIdx: number,
  heart: number,
): number {
  const dt = 1 / F_HZ;
  let arcLength = 0;
  let idx = lastIdx;
  const length = section.length;
  if (length <= 0) return lastIdx;

  const leadIn = Math.min(section.leadIn, length * 0.5);
  const leadOut = Math.min(section.leadOut, length * 0.5);
  // Rates are stored in rad/m (curvature). FVD++ keeps them user-facing as
  // total angle over section — mirror that: if a spec'd leadIn/leadOut
  // splits off a portion, the *peak* rate in the middle needs to bend the
  // remaining length by the full target angle. M3 takes the rates at face
  // value; tuning lands with the properties panel in M4.

  vec3.set(curvedDir, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);
  vec3.set(curvedLat, arrays.latX[lastIdx]!, arrays.latY[lastIdx]!, arrays.latZ[lastIdx]!);

  const rollOffset = arrays.roll[lastIdx]! - evalRoll(section.rollFunc, 0);

  while (arcLength < length && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    const step = prevVel * dt;
    const clippedStep = Math.min(step, length - arcLength);
    if (clippedStep <= 0) break;

    idx += 1;
    const midArc = arcLength + clippedStep * 0.5;
    const blend = leadInOutBlend(midArc, length, leadIn, leadOut);
    const yawRate = section.yawRate * blend;
    const pitchRate = section.pitchRate * blend;

    // Pitch rotates around the *horizontal* lateral axis (rider's right
    // projected onto the ground = dir × up), not the banked `curvedLat`.
    // Rolling the track around dir tilts curvedLat out of the horizontal
    // plane; rotating dir around a tilted axis leaks pitch into yaw and
    // warps the path. Decoupling here keeps the geometry banking-
    // independent, matching FVD++'s Curved section.
    vec3.set(curvedHorizLat, -curvedDir[2], 0, curvedDir[0]);
    const horizLen = Math.hypot(curvedHorizLat[0], curvedHorizLat[2]);
    if (horizLen > 1e-6) {
      curvedHorizLat[0] /= horizLen;
      curvedHorizLat[2] /= horizLen;
      rotateAroundAxis(curvedDir, curvedDir, curvedHorizLat, pitchRate * clippedStep);
      rotateAroundAxis(curvedLat, curvedLat, curvedHorizLat, pitchRate * clippedStep);
    }
    // Yaw rotates around world-up. Lat rotates too so it stays perpendicular
    // to the new forward direction.
    vec3.rotateY(curvedDir, curvedDir, [0, 0, 0], yawRate * clippedStep);
    vec3.rotateY(curvedLat, curvedLat, [0, 0, 0], yawRate * clippedStep);

    const posX = arrays.posX[idx - 1]! + curvedDir[0] * clippedStep;
    const posY = arrays.posY[idx - 1]! + curvedDir[1] * clippedStep;
    const posZ = arrays.posZ[idx - 1]! + curvedDir[2] * clippedStep;

    arcLength += clippedStep;
    const rollAbs = evalRoll(section.rollFunc, arcLength) + rollOffset;
    const prevRoll = arrays.roll[idx - 1]!;
    rotateAroundAxis(curvedLat, curvedLat, curvedDir, rollAbs - prevRoll);
    vec3.cross(curvedNorm, curvedLat, curvedDir);

    const energy = arrays.energy[idx - 1]!;
    const yH = posY - curvedNorm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH;
    const vel = kinetic > 0 ? Math.sqrt(2 * kinetic) : 0;

    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir: curvedDir,
      lat: curvedLat,
      norm: curvedNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: clippedStep,
      heartDistFromLast: clippedStep,
      totalLength: arrays.totalLength[idx - 1]! + clippedStep,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + clippedStep,
      forceNormal: projectGravity(curvedNorm),
      forceLateral: projectGravity(curvedLat),
      forceLong: projectGravityLong(curvedDir),
    });
  }
  return idx;
}

/**
 * Returns a blend factor ∈ [0, 1] at arc position `s` along a section of
 * total length `L`. In the lead-in region `[0, leadIn]` it ramps 0 → 1 via a
 * cubic smoothstep; in the lead-out region `[L − leadOut, L]` it ramps back
 * to 0; in between it's a constant 1. Ramps guarantee zero first derivative
 * at the boundaries so the rider doesn't feel a sudden onset of curvature.
 */
function leadInOutBlend(s: number, length: number, leadIn: number, leadOut: number): number {
  if (leadIn > 0 && s < leadIn) {
    const u = s / leadIn;
    return u * u * (3 - 2 * u);
  }
  if (leadOut > 0 && s > length - leadOut) {
    const u = (length - s) / leadOut;
    return u * u * (3 - 2 * u);
  }
  return 1;
}

// Forced section integrator — the heart of FVD++ (spec §5, port of
// core/secforced.cpp lines 110–135). Normal and Lateral Funcs define the
// g-forces the rider experiences; pitch and yaw rates fall out of the
// equations of motion so the path traces a curve that feels like the
// requested force profile.
//
// M4 scope note: implements the core equations from the spec template with
// energy conservation. The exact FVD++ 0.79 bit-for-bit match (applyCenter,
// applyTension, resistance, friction) lands once the golden-file harness
// (M9) has real .fvd goldens to diff against.
const forcedDir = vec3.create();
const forcedLat = vec3.create();
const forcedNorm = vec3.create();
const forcedPrevLat = vec3.create();
const forcedPrevNorm = vec3.create();

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
  let arg = 0; // section argument — seconds for Time-arg, meters for Distance-arg.

  vec3.set(forcedDir, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);
  vec3.set(forcedLat, arrays.latX[lastIdx]!, arrays.latY[lastIdx]!, arrays.latZ[lastIdx]!);
  vec3.cross(forcedNorm, forcedLat, forcedDir);

  const rollOffset = arrays.roll[lastIdx]! - evalRoll(section.rollFunc, 0);

  while (arg < extent && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    if (prevVel <= 1e-6) break;

    // Snapshot previous basis — used both to rotate the current basis and
    // to compute the gravity contribution before the orientation changes.
    vec3.copy(forcedPrevLat, forcedLat);
    vec3.copy(forcedPrevNorm, forcedNorm);

    // Sample the force functions at the current argument value.
    const normalG = evalRoll(section.normalFunc, arg);
    const lateralG = evalRoll(section.lateralFunc, arg);
    const normalF = normalG * F_G;
    const lateralF = lateralG * F_G;

    // Spec §5 template: angular rates come from net acceleration perpendicular
    // to the path. `normalG = 1` on a level track should cancel gravity
    // exactly (zero centripetal acceleration, straight line), so the net
    // along norm is `normalF + (gravity · norm)`. Gravity = (0, −F_G, 0),
    // hence `gravity · norm = −F_G · norm_y`; net = normalF − F_G · norm_y.
    const netNormal = normalF - F_G * forcedPrevNorm[1];
    const netLateral = lateralF - F_G * forcedPrevLat[1];

    const pitchRate = netNormal / (prevVel * F_HZ);
    const yawRate = -netLateral / (prevVel * F_HZ);

    // Apply pitch around prev lat, yaw around prev (negative) norm; lat
    // follows the yaw rotation so it stays perpendicular to the new dir.
    rotateAroundAxis(forcedDir, forcedDir, forcedPrevLat, pitchRate);
    rotateAroundAxis(forcedDir, forcedDir, forcedPrevNorm, -yawRate);
    rotateAroundAxis(forcedLat, forcedLat, forcedPrevNorm, -yawRate);

    // Roll from the Roll function at the same argument.
    const rollAbs = evalRoll(section.rollFunc, arg) + rollOffset;
    const prevRoll = arrays.roll[idx]!;
    rotateAroundAxis(forcedLat, forcedLat, forcedDir, rollAbs - prevRoll);
    vec3.cross(forcedNorm, forcedLat, forcedDir);

    idx += 1;

    // Position advances along the average of old and new dir for a better
    // second-order step. FVD++ uses this midpoint rule implicitly via its
    // `prev.dir + curr.dir` term.
    const avgX = (arrays.dirX[idx - 1]! + forcedDir[0]) * 0.5;
    const avgY = (arrays.dirY[idx - 1]! + forcedDir[1]) * 0.5;
    const avgZ = (arrays.dirZ[idx - 1]! + forcedDir[2]) * 0.5;
    const step = prevVel * dt;
    const posX = arrays.posX[idx - 1]! + avgX * step;
    const posY = arrays.posY[idx - 1]! + avgY * step;
    const posZ = arrays.posZ[idx - 1]! + avgZ * step;

    const energy = arrays.energy[idx - 1]!;
    const yH = posY - forcedNorm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH;
    const vel = kinetic > 0 ? Math.sqrt(2 * kinetic) : 0;

    // Advance the argument. TIME-arg sections step `dt` per node; DISTANCE
    // -arg sections step by the actual distance travelled.
    arg += section.argument === Argument.Time ? dt : step;

    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir: forcedDir,
      lat: forcedLat,
      norm: forcedNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: step,
      heartDistFromLast: step,
      totalLength: arrays.totalLength[idx - 1]! + step,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + step,
      forceNormal: normalG,
      forceLateral: lateralG,
      forceLong: projectGravityLong(forcedDir),
    });
  }
  return idx;
}

// Geometric section integrator — pitch and yaw come directly from two
// user-prescribed functions (rad per argument unit), instead of being
// computed from forces as in Forced. Roll still comes from the Roll func.
// Velocity from energy conservation. Port of core/secgeometric.cpp.
const geomDir = vec3.create();
const geomLat = vec3.create();
const geomNorm = vec3.create();
const geomPrevLat = vec3.create();

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

  vec3.set(geomDir, arrays.dirX[lastIdx]!, arrays.dirY[lastIdx]!, arrays.dirZ[lastIdx]!);
  vec3.set(geomLat, arrays.latX[lastIdx]!, arrays.latY[lastIdx]!, arrays.latZ[lastIdx]!);

  const rollOffset = arrays.roll[lastIdx]! - evalRoll(section.rollFunc, 0);

  while (arg < extent && idx + 1 < arrays.capacity) {
    const prevVel = arrays.vel[idx]!;
    if (prevVel <= 1e-6) break;

    vec3.copy(geomPrevLat, geomLat);

    // Sample target rates at the current argument value.
    const pitchAt = evalRoll(section.pitchFunc, arg);
    const yawAt = evalRoll(section.yawFunc, arg);

    // Convert "absolute angle at arg" into a per-step delta. Since evalRoll
    // returns a cumulative value, diffing against the previously sampled
    // value gives the delta. We stash the last sampled pair in the previous
    // node's totalLength / totalHeartLength slots? No — keep local state
    // via the running arg: just walk one delta per step.
    // Simpler approach: pitchFunc and yawFunc are treated as "rate over
    // argument" — sample instantaneous rate via subFuncDerivativeAt.
    const pitchRate = evalFuncRate(section.pitchFunc, arg);
    const yawRate = evalFuncRate(section.yawFunc, arg);

    // Don't need pitchAt/yawAt below; void them so the lint pass stays happy.
    void pitchAt;
    void yawAt;

    // dArg per step — seconds for Time-arg, meters for Distance-arg.
    const step = prevVel * dt;
    const dArg = section.argument === Argument.Time ? dt : step;

    // Pitch around prev lat, yaw around world +Y (matches Curved for
    // consistent turning behaviour; §5.1 note).
    rotateAroundAxis(geomDir, geomDir, geomPrevLat, pitchRate * dArg);
    vec3.rotateY(geomDir, geomDir, [0, 0, 0], yawRate * dArg);
    vec3.rotateY(geomLat, geomLat, [0, 0, 0], yawRate * dArg);

    // Roll.
    const rollAbs = evalRoll(section.rollFunc, arg) + rollOffset;
    const prevRoll = arrays.roll[idx]!;
    rotateAroundAxis(geomLat, geomLat, geomDir, rollAbs - prevRoll);
    vec3.cross(geomNorm, geomLat, geomDir);

    idx += 1;
    const avgX = (arrays.dirX[idx - 1]! + geomDir[0]) * 0.5;
    const avgY = (arrays.dirY[idx - 1]! + geomDir[1]) * 0.5;
    const avgZ = (arrays.dirZ[idx - 1]! + geomDir[2]) * 0.5;
    const posX = arrays.posX[idx - 1]! + avgX * step;
    const posY = arrays.posY[idx - 1]! + avgY * step;
    const posZ = arrays.posZ[idx - 1]! + avgZ * step;

    const energy = arrays.energy[idx - 1]!;
    const yH = posY - geomNorm[1] * heart * HEART_ENERGY_FACTOR;
    const kinetic = energy - F_G * yH;
    const vel = kinetic > 0 ? Math.sqrt(2 * kinetic) : 0;

    arg += dArg;

    writeNode(arrays, idx, {
      position: [posX, posY, posZ],
      dir: geomDir,
      lat: geomLat,
      norm: geomNorm,
      roll: rollAbs,
      vel,
      energy,
      distFromLast: step,
      heartDistFromLast: step,
      totalLength: arrays.totalLength[idx - 1]! + step,
      totalHeartLength: arrays.totalHeartLength[idx - 1]! + step,
      forceNormal: projectGravity(geomNorm),
      forceLateral: projectGravity(geomLat),
      forceLong: projectGravityLong(geomDir),
    });
  }
  return idx;
}

/**
 * Sample the instantaneous rate (derivative w.r.t. argument) of a Func at
 * arc position `s`. Walks the subfuncs the same way `evalRoll` does but
 * returns the local derivative instead of the accumulated value.
 */
function evalFuncRate(func: Func, s: number): number {
  let offset = 0;
  for (const sf of func.subfuncs) {
    if (s <= offset + sf.length) {
      return subFuncDerivativeAt(sf, s - offset);
    }
    offset += sf.length;
  }
  return 0;
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
 * Compute the four cubic-Bezier control points the integrator actually uses,
 * given a `BezierSection`'s stored controlPoints, the previous section's end
 * pose (read from `arrays[lastIdx]`), and — for closure sections — the
 * track's anchor.
 *
 * Auto-anchor contract:
 *   - p0' is always the previous section's end position.
 *   - p1' lies along the previous section's end direction at the user's
 *     chosen handle length (|stored p1 − stored p0|).
 *   - For mid-track Beziers, p2' and p3' are translated by the same delta
 *     as p0 (preserves the curve's user-authored shape relative to its
 *     start).
 *   - For closure Beziers (`isClosure: true`), p3' = anchor.position and
 *     p2' lies along the anchor's incoming direction at the user's chosen
 *     end-handle length (|stored p2 − stored p3|). This guarantees the
 *     closure rejoins the anchor tangentially even if upstream geometry
 *     shifts and `regenerateClosure` hasn't run yet.
 */
function effectiveBezierControlPoints(
  section: BezierSection,
  arrays: MNodeArrays,
  lastIdx: number,
  anchor: AnchorSection | null,
): [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] {
  const [storedP0, storedP1, storedP2, storedP3] = section.controlPoints;

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

  const handle1Len = Math.hypot(
    storedP1[0] - storedP0[0],
    storedP1[1] - storedP0[1],
    storedP1[2] - storedP0[2],
  );

  const p0: [number, number, number] = [...prevPos];
  const p1: [number, number, number] = [
    prevPos[0] + prevDir[0] * handle1Len,
    prevPos[1] + prevDir[1] * handle1Len,
    prevPos[2] + prevDir[2] * handle1Len,
  ];

  if (section.isClosure === true && anchor !== null) {
    const handle2Len = Math.hypot(
      storedP3[0] - storedP2[0],
      storedP3[1] - storedP2[1],
      storedP3[2] - storedP2[2],
    );
    const anchorDir = anchorForwardFromYawPitch(anchor.yaw, anchor.pitch);
    const p3: [number, number, number] = [...anchor.position];
    const p2: [number, number, number] = [
      anchor.position[0] - anchorDir[0] * handle2Len,
      anchor.position[1] - anchorDir[1] * handle2Len,
      anchor.position[2] - anchorDir[2] * handle2Len,
    ];
    return [p0, p1, p2, p3];
  }

  // Mid-track Bezier: translate p2 and p3 alongside p0 so the curve's
  // user-authored shape moves with the section's start.
  const dx = prevPos[0] - storedP0[0];
  const dy = prevPos[1] - storedP0[1];
  const dz = prevPos[2] - storedP0[2];
  const p2: [number, number, number] = [storedP2[0] + dx, storedP2[1] + dy, storedP2[2] + dz];
  const p3: [number, number, number] = [storedP3[0] + dx, storedP3[1] + dy, storedP3[2] + dz];
  return [p0, p1, p2, p3];
}

/**
 * Anchor's forward direction from its (yaw, pitch). Matches the convention
 * used by `integrateAnchor` (yaw around +Y, then pitch around the yawed
 * lateral axis = +Z·yaw). Used by closeTrack and effectiveBezierControlPoints.
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
