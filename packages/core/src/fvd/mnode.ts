// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/mnode.h and mnode.cpp.
//
// Conventions (FVD-native, do not change):
//   vDir   — forward along track (rider's gaze)
//   vLat   — rider's right
//   vNorm  — vDir × vLat → points to rider's feet (vNorm.y ≈ −1 at rest)
//   fRoll  — degrees. Positive roll banks the rider to the right.
//
// All vector fields are mutable in place; integration writes them per-step.
// Methods preserve FVD method names and signatures so the line numbers in
// the comments below match reference/openfvd/core/mnode.cpp.

import { F_HZ, F_PI, FLOAT_EPSILON, toRad } from './constants.js';
import {
  type Vec3,
  vec3,
  vec3Copy,
  vec3Cross,
  vec3Normalize,
  vec3RotateAxis,
  vec3RotateAxisGlm,
  vec3Set,
  r,
} from './fvec.js';

// Working temporaries reused across method calls. The FVD code allocates
// glm::vec3 by value freely; we keep one set of scratch vectors per module
// to avoid per-tick allocations in the integrator.
const tmpAxis: Vec3 = vec3();
const tmpVec: Vec3 = vec3();

export class MNode {
  // Pose
  vPos: Vec3 = vec3();
  vDir: Vec3 = vec3();
  vLat: Vec3 = vec3();
  vNorm: Vec3 = vec3();

  // Scalar pose / kinematics
  fRoll = 0;
  fVel = 0;
  fEnergy = 0;

  // Forces (rider-frame g multiples). `forceLong` is an addition beyond
  // FVD++ — it's the gravity component along vDir (i.e. -vDir.y), useful
  // for the forces graph to surface downhill acceleration / uphill drag.
  // Not persisted in the .fvd file; computed per-step.
  forceNormal = 0;
  forceLateral = 0;
  forceLong = 0;
  smoothNormal = 0;
  smoothLateral = 0;
  smoothLong = 0;

  // Per-step deltas
  fDistFromLast = 0;
  fHeartDistFromLast = 0;
  fAngleFromLast = 0;
  fTrackAngleFromLast = 0;
  fDirFromLast = 0;
  fPitchFromLast = 0;
  fYawFromLast = 0;
  fRollSpeed = 0;
  fSmoothSpeed = 0;

  // Running totals
  fTotalLength = 0;
  fTotalHeartLength = 0;

  // Default constructor — mnode::mnode() (mnode.cpp:26). Zero-initialized.
  constructor();
  // Parameterized constructor — mnode::mnode(vec3, vec3, float, float, float, float)
  // (mnode.cpp:31–66).
  constructor(
    getPos: Vec3,
    getDir: Vec3,
    getRoll: number,
    getVel: number,
    getNForce: number,
    getLateral: number,
  );
  constructor(
    getPos?: Vec3,
    getDir?: Vec3,
    getRoll?: number,
    getVel?: number,
    getNForce?: number,
    getLateral?: number,
  ) {
    if (getPos === undefined) {
      return;
    }

    vec3Copy(this.vPos, getPos);
    vec3Copy(this.vDir, getDir!);
    vec3Normalize(this.vDir, this.vDir);

    this.fRoll = r(getRoll!);
    this.fVel = r(getVel!);
    this.fEnergy = 0;
    this.forceNormal = r(getNForce!);
    this.forceLateral = r(getLateral!);

    if (this.vDir.y === 1) {
      // mnode.cpp:54–57: straight-up direction — pick lat from a roll
      // rotation of (1,0,0) about (0,-1,0).
      const rad = toRad(getRoll!);
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      // angleAxis(rad, (0,-1,0)) applied to (1,0,0).
      vec3Set(this.vLat, c, 0, s);
    } else {
      // mnode.cpp:60: vLat = (-dir.z, 0, dir.x).
      vec3Set(this.vLat, -this.vDir.z, 0, this.vDir.x);
    }

    // mnode.cpp:63 — set lat.y so the lateral vector banks by fRoll.
    const horizLen = Math.sqrt(this.vLat.x * this.vLat.x + this.vLat.z * this.vLat.z);
    this.vLat.y = r(Math.tan((this.fRoll * F_PI) / 180) * horizLen);
    vec3Normalize(this.vLat, this.vLat);
    this.fRollSpeed = 0;

    this.updateNorm();
  }

  // mnode.cpp:68 — rotate vLat by −dRoll (degrees) around vDir, then
  // recompute vNorm and fRoll from the new lat/dir frame. The negation of
  // dRoll is intentional and load-bearing.
  setRoll(dRoll: number): void {
    vec3RotateAxis(this.vLat, this.vDir, toRad(-dRoll), this.vLat);
    vec3Normalize(this.vLat, this.vLat);
    this.updateRoll();
  }

  // mnode.cpp:75 — refresh vNorm and re-derive fRoll from the geometry.
  updateRoll(): void {
    this.updateNorm();
    this.fRoll = r((Math.atan2(this.vLat.y, -this.vNorm.y) * 180) / F_PI);
  }

  // mnode.h:53 — inline in C++.
  updateNorm(): void {
    vec3Cross(this.vDir, this.vLat, this.vNorm);
  }

  // mnode.cpp:98 — changePitch rotates vDir/vLat around the horizontal
  // axis perpendicular to (0, vNorm.y, 0) and vDir. `inverted` flips the
  // axis when the rider is upside-down (vNorm.y > 0).
  //
  // C++ uses `glm::angleAxis(angle, axis) * vec` which constructs a
  // quaternion and rotates via cross-cross composition. Rodrigues is
  // mathematically identical but the float32 evaluation order diverges
  // by ~1 ULP per call — over 1000 steps per Geometric section that
  // accumulates to centimeters of drift. Use vec3RotateAxisGlm here to
  // match FVD bit-for-bit (modulo the float32 emulation).
  changePitch(dAngle: number, inverted: boolean): void {
    vec3Set(tmpVec, 0, this.vNorm.y, 0);
    vec3Cross(tmpVec, this.vDir, tmpAxis);
    vec3Normalize(tmpAxis, tmpAxis);
    if (inverted) {
      tmpAxis.x = -tmpAxis.x;
      tmpAxis.y = -tmpAxis.y;
      tmpAxis.z = -tmpAxis.z;
    }
    const a = toRad(dAngle);
    vec3RotateAxisGlm(this.vDir, tmpAxis, a, this.vDir);
    vec3Normalize(this.vDir, this.vDir);
    vec3RotateAxisGlm(this.vLat, tmpAxis, a, this.vLat);
    vec3Normalize(this.vLat, this.vLat);
    this.updateNorm();
  }

  // mnode.cpp:111 — yaw rotates vDir/vLat around world +Y.
  changeYaw(dAngle: number): void {
    vec3Set(tmpAxis, 0, 1, 0);
    const a = toRad(dAngle);
    vec3RotateAxisGlm(this.vDir, tmpAxis, a, this.vDir);
    vec3Normalize(this.vDir, this.vDir);
    vec3RotateAxisGlm(this.vLat, tmpAxis, a, this.vLat);
    vec3Normalize(this.vLat, this.vLat);
    this.updateNorm();
  }

  // mnode.h:56–57
  getPitchChange(): number {
    return r(this.fPitchFromLast * F_HZ);
  }

  getYawChange(): number {
    return r(this.fYawFromLast * F_HZ);
  }

  // mnode.h:58–60: scalar components of vPosHeart.
  fPosHeartx(fHeart: number): number {
    return r(this.vPos.x + this.vNorm.x * fHeart);
  }

  fPosHearty(fHeart: number): number {
    return r(this.vPos.y + this.vNorm.y * fHeart);
  }

  fPosHeartz(fHeart: number): number {
    return r(this.vPos.z + this.vNorm.z * fHeart);
  }

  // mnode.h:63
  vPosHeart(fHeart: number, out: Vec3 = vec3()): Vec3 {
    return vec3Set(
      out,
      this.vPos.x + this.vNorm.x * fHeart,
      this.vPos.y + this.vNorm.y * fHeart,
      this.vPos.z + this.vNorm.z * fHeart,
    );
  }

  // mnode.cpp:118 — lateral vector at the heart-line, corrected for
  // roll-speed-induced shear. Returns a normalized vec3.
  vLatHeart(fHeart: number, out: Vec3 = vec3()): Vec3 {
    const estDistFromLast = 0.7 * this.fHeartDistFromLast + 0.3 * this.fDistFromLast;
    let estimated: number;
    if (this.fAngleFromLast < 0.001) {
      estimated = this.fHeartDistFromLast;
    } else {
      estimated = this.fVel / F_HZ;
    }
    const fRollSpeedPerMeter =
      estDistFromLast > 0 ? (this.fRollSpeed + this.fSmoothSpeed) / F_HZ / estimated : 0;

    // normalize(vLat) - normalize(vDir) * (rollSpeedPerMeter * π * heart / 180)
    const latLen = Math.sqrt(
      this.vLat.x * this.vLat.x + this.vLat.y * this.vLat.y + this.vLat.z * this.vLat.z,
    );
    const dirLen = Math.sqrt(
      this.vDir.x * this.vDir.x + this.vDir.y * this.vDir.y + this.vDir.z * this.vDir.z,
    );
    if (latLen === 0 || dirLen === 0) {
      return vec3Set(out, 0, 0, 0);
    }
    const k = (fRollSpeedPerMeter * F_PI * fHeart) / 180;
    const x = this.vLat.x / latLen - (this.vDir.x / dirLen) * k;
    const y = this.vLat.y / latLen - (this.vDir.y / dirLen) * k;
    const z = this.vLat.z / latLen - (this.vDir.z / dirLen) * k;
    const olen = Math.sqrt(x * x + y * y + z * z);
    if (olen === 0) return vec3Set(out, 0, 0, 0);
    const inv = 1 / olen;
    return vec3Set(out, x * inv, y * inv, z * inv);
  }

  // mnode.cpp:131 — direction at the heart-line.
  vDirHeart(fHeart: number, out: Vec3 = vec3()): Vec3 {
    let estimated: number;
    if (this.fAngleFromLast < 0.001) {
      estimated = this.fHeartDistFromLast;
    } else {
      estimated = this.fVel / F_HZ;
    }
    let fRollSpeedPerMeter =
      this.fHeartDistFromLast > 0 ? (this.fRollSpeed + this.fSmoothSpeed) / F_HZ / estimated : 0;
    // C++ NaN guard (mnode.cpp:140–141).
    if (Number.isNaN(fRollSpeedPerMeter)) {
      fRollSpeedPerMeter = 0;
    }
    const k = (fRollSpeedPerMeter * F_PI * fHeart) / 180;
    const x = this.vDir.x + this.vLat.x * k;
    const y = this.vDir.y + this.vLat.y * k;
    const z = this.vDir.z + this.vLat.z * k;
    const olen = Math.sqrt(x * x + y * y + z * z);
    if (olen === 0) return vec3Set(out, 0, 0, 0);
    const inv = 1 / olen;
    return vec3Set(out, x * inv, y * inv, z * inv);
  }

  // mnode.h:65 — vRelPos(y, x, z=0) = vPos - y*vNorm + x*vLatHeart(-y) + z*vDirHeart(-y).
  vRelPos(y: number, x: number, z = 0, out: Vec3 = vec3()): Vec3 {
    const lat = this.vLatHeart(-y, vec3());
    const dir = this.vDirHeart(-y, vec3());
    return vec3Set(
      out,
      this.vPos.x - y * this.vNorm.x + x * lat.x + z * dir.x,
      this.vPos.y - y * this.vNorm.y + x * lat.y + z * dir.y,
      this.vPos.z - y * this.vNorm.z + x * lat.z + z * dir.z,
    );
  }

  // mnode.h:69
  getPitch(): number {
    return r(
      (Math.atan2(this.vDir.y, Math.sqrt(this.vDir.x * this.vDir.x + this.vDir.z * this.vDir.z)) *
        180) /
        F_PI,
    );
  }

  // mnode.h:70
  getDirection(): number {
    return r((Math.atan2(-this.vDir.x, -this.vDir.z) * 180) / F_PI);
  }

  // mnode.h:98
  fFlexion(): number {
    return this.fDistFromLast <= 0 ? 0 : this.fTrackAngleFromLast / this.fDistFromLast;
  }

  // mnode.cpp:202 — see C++ for the rationale of the lateral/normal split.
  calcSmoothForces(): void {
    let forceX: number;
    let forceY: number;
    let forceZ: number;
    const temp = Math.cos((Math.abs(this.getPitch()) * F_PI) / 180);
    if (Math.abs(this.fAngleFromLast) < FLOAT_EPSILON) {
      forceX = 0;
      forceY = 1;
      forceZ = 0;
    } else {
      const rollRad = (this.fRoll * F_PI) / 180;
      const cosR = Math.cos(rollRad);
      const sinR = Math.sin(rollRad);
      const normalDAngle = (F_PI / 180) * (-this.fPitchFromLast * cosR - temp * this.fYawFromLast * sinR);
      const lateralDAngle = (F_PI / 180) * (this.fPitchFromLast * sinR - temp * this.fYawFromLast * cosR);
      const F_G_LOCAL = 9.80665;
      const latCoef = (lateralDAngle * this.fVel * F_HZ) / F_G_LOCAL;
      const normCoef = (normalDAngle * this.fHeartDistFromLast * F_HZ * F_HZ) / F_G_LOCAL;
      forceX = 0 + latCoef * this.vLat.x + normCoef * this.vNorm.x;
      forceY = 1 + latCoef * this.vLat.y + normCoef * this.vNorm.y;
      forceZ = 0 + latCoef * this.vLat.z + normCoef * this.vNorm.z;
    }

    // -dot(force, normalize(vNorm)) - forceNormal
    const normLen = Math.sqrt(
      this.vNorm.x * this.vNorm.x + this.vNorm.y * this.vNorm.y + this.vNorm.z * this.vNorm.z,
    );
    const latLen = Math.sqrt(
      this.vLat.x * this.vLat.x + this.vLat.y * this.vLat.y + this.vLat.z * this.vLat.z,
    );
    const dotN =
      normLen === 0
        ? 0
        : (forceX * this.vNorm.x + forceY * this.vNorm.y + forceZ * this.vNorm.z) / normLen;
    const dotL =
      latLen === 0
        ? 0
        : (forceX * this.vLat.x + forceY * this.vLat.y + forceZ * this.vLat.z) / latLen;
    this.smoothNormal = r(-dotN - this.forceNormal);
    this.smoothLateral = r(-dotL - this.forceLateral);
  }

  // Shallow clone used at section boundaries. Vector fields are copied by
  // value, matching C++ slice-on-assign semantics (mnode is a plain class
  // and FVD does `*new mnode = *prev` in several places).
  clone(): MNode {
    const out = new MNode();
    vec3Copy(out.vPos, this.vPos);
    vec3Copy(out.vDir, this.vDir);
    vec3Copy(out.vLat, this.vLat);
    vec3Copy(out.vNorm, this.vNorm);
    out.fRoll = this.fRoll;
    out.fVel = this.fVel;
    out.fEnergy = this.fEnergy;
    out.forceNormal = this.forceNormal;
    out.forceLateral = this.forceLateral;
    out.forceLong = this.forceLong;
    out.smoothNormal = this.smoothNormal;
    out.smoothLateral = this.smoothLateral;
    out.smoothLong = this.smoothLong;
    out.fDistFromLast = this.fDistFromLast;
    out.fHeartDistFromLast = this.fHeartDistFromLast;
    out.fAngleFromLast = this.fAngleFromLast;
    out.fTrackAngleFromLast = this.fTrackAngleFromLast;
    out.fDirFromLast = this.fDirFromLast;
    out.fPitchFromLast = this.fPitchFromLast;
    out.fYawFromLast = this.fYawFromLast;
    out.fRollSpeed = this.fRollSpeed;
    out.fSmoothSpeed = this.fSmoothSpeed;
    out.fTotalLength = this.fTotalLength;
    out.fTotalHeartLength = this.fTotalHeartLength;
    return out;
  }
}

// Convenience helper used by tests.
export function mnodeClone(src: MNode): MNode {
  return src.clone();
}

// Re-export Vec3 for downstream callers.
export type { Vec3 } from './fvec.js';
