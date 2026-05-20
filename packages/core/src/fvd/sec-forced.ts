// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/secforced.cpp. Time-mode only —
// distance-mode (bArgument==DISTANCE) is a separate path; matches FVD's
// updateDistanceSection.

import { F_G, F_HZ, F_PI, FLOAT_EPSILON } from './constants.js';
import { Func, EFunctype } from './func.js';
import {
  r,
  vec3,
  vec3Distance,
  vec3Normalize,
  vec3RotateAxisGlm,
  type Vec3,
} from './fvec.js';
import type { ReadStream, WriteStream } from './io-stream.js';
import { type MNode } from './mnode.js';
import { loadFunc, writeFunc } from './sec-straight.js';
import { Section, SecType, TIME, EULER, QUATERNION, DISTANCE } from './section.js';
import { type Subfunc, EDegree } from './subfunction.js';
import type { Track } from './track.js';
// gl-matrix style: tmpAxis reserved for future use; suppress lint until then.

export class SecForced extends Section {
  constructor(parent: Track, first: MNode, getTime: number) {
    super(parent, SecType.Forced, first);
    this.iTime = (getTime + 0.5) | 0;
    this.length = 0;
    this.rollFunc.changeLength(1, 0);
    this.normForce = new Func(
      0,
      1,
      this.lNodes[0]!.forceNormal,
      this.lNodes[0]!.forceNormal,
      this,
      EFunctype.FuncNormal,
    );
    this.latForce = new Func(
      0,
      1,
      this.lNodes[0]!.forceLateral,
      this.lNodes[0]!.forceLateral,
      this,
      EFunctype.FuncLateral,
    );
    this.bOrientation = QUATERNION;
    this.bArgument = TIME;
    this.bSpeed = true;
    this.fVel = 10;
  }

  updateSection(node = 0): number {
    if (this.rollFunc.lockedFunc() !== -1) {
      const last = this.rollFunc.funcList[this.rollFunc.funcList.length - 1]!;
      if (Math.abs(last.symArg) > 0.00001 && last.minArgument * F_HZ < node) {
        node = (F_HZ * last.minArgument - 1.5) | 0;
      }
    }
    if (this.normForce && this.normForce.lockedFunc() !== -1) {
      const last = this.normForce.funcList[this.normForce.funcList.length - 1]!;
      if (Math.abs(last.symArg) > 0.00001 && last.minArgument * F_HZ < node) {
        node = (F_HZ * last.minArgument - 1.5) | 0;
      }
    }
    if (this.latForce && this.latForce.lockedFunc() !== -1) {
      const last = this.latForce.funcList[this.latForce.funcList.length - 1]!;
      if (Math.abs(last.symArg) > 0.00001 && last.minArgument * F_HZ < node) {
        node = (F_HZ * last.minArgument - 1.5) | 0;
      }
    }

    if (this.bArgument === DISTANCE) {
      return this.updateDistanceSection(node);
    }

    node = node > this.lNodes.length - 2 ? this.lNodes.length - 2 : node;
    if (node < 0) node = 0;

    const numNodes = (this.getMaxArgument() * F_HZ + 0.5) | 0;
    this.iTime = numNodes;

    if (node >= this.lNodes.length - 1 && node > 0) node = this.lNodes.length - 2;

    if (
      this.lNodes.length > 1 &&
      this.parent.lSections[this.parent.lSections.length - 1] !== this
    ) {
      this.lNodes.pop();
    }

    if (node === 0) {
      this.lNodes[0]!.updateNorm();

      let diff = this.lNodes[0]!.forceNormal;
      this.normForce!.funcList[0]!.translateValues(diff);
      this.normForce!.translateValues(this.normForce!.funcList[0]!);

      diff = this.lNodes[0]!.forceLateral;
      this.latForce!.funcList[0]!.translateValues(diff);
      this.latForce!.translateValues(this.latForce!.funcList[0]!);

      diff = this.lNodes[0]!.fRollSpeed;
      if (this.bOrientation === EULER) {
        diff += this.lNodes[0]!.vDir.y * this.lNodes[0]!.getYawChange();
      }
      this.rollFunc.funcList[0]!.translateValues(diff);
      this.rollFunc.translateValues(this.rollFunc.funcList[0]!);
    }

    const tmpForce: Vec3 = vec3();
    const tmpAxis: Vec3 = vec3();
    const tmpPos: Vec3 = vec3();
    const tmpPrev: Vec3 = vec3();

    let i: number;
    for (i = node; i < numNodes; i++) {
      if (i >= this.lNodes.length - 1) this.lNodes.push(this.lNodes[i]!.clone());

      const prevNode = this.lNodes[i]!;
      const curNode = this.lNodes[i + 1]!;
      curNode.vPos.x = prevNode.vPos.x;
      curNode.vPos.y = prevNode.vPos.y;
      curNode.vPos.z = prevNode.vPos.z;
      curNode.fVel = prevNode.fVel;
      curNode.fEnergy = prevNode.fEnergy;

      const nVal = this.normForce!.getValue((i + 1) / F_HZ);
      const lVal = this.latForce!.getValue((i + 1) / F_HZ);
      tmpForce.x = -nVal * prevNode.vNorm.x - lVal * prevNode.vLat.x - 0;
      tmpForce.y = -nVal * prevNode.vNorm.y - lVal * prevNode.vLat.y - 1;
      tmpForce.z = -nVal * prevNode.vNorm.z - lVal * prevNode.vLat.z - 0;

      curNode.forceNormal = nVal;
      curNode.forceLateral = lVal;
      curNode.forceLong = -prevNode.vDir.y;

      const normLen = Math.sqrt(
        prevNode.vNorm.x * prevNode.vNorm.x +
          prevNode.vNorm.y * prevNode.vNorm.y +
          prevNode.vNorm.z * prevNode.vNorm.z,
      );
      const latLen = Math.sqrt(
        prevNode.vLat.x * prevNode.vLat.x +
          prevNode.vLat.y * prevNode.vLat.y +
          prevNode.vLat.z * prevNode.vLat.z,
      );
      const dotN =
        normLen === 0
          ? 0
          : (tmpForce.x * prevNode.vNorm.x +
              tmpForce.y * prevNode.vNorm.y +
              tmpForce.z * prevNode.vNorm.z) /
            normLen;
      const dotL =
        latLen === 0
          ? 0
          : (tmpForce.x * prevNode.vLat.x +
              tmpForce.y * prevNode.vLat.y +
              tmpForce.z * prevNode.vLat.z) /
            latLen;
      const nForce = -dotN * F_G;
      const lForce = -dotL * F_G;

      const estVel =
        Math.abs(prevNode.fHeartDistFromLast) < FLOAT_EPSILON
          ? prevNode.fVel
          : prevNode.fHeartDistFromLast * F_HZ;

      // First rotate vDir by -lForce/v/F_HZ around prevNode.vNorm, then by
      // nForce/F_HZ/estVel around prevNode.vLat. Composition is order-sensitive.
      // secforced.cpp:124-125.
      vec3RotateAxisGlm(prevNode.vDir, prevNode.vNorm, -lForce / prevNode.fVel / F_HZ, curNode.vDir);
      vec3RotateAxisGlm(curNode.vDir, prevNode.vLat, nForce / F_HZ / estVel, curNode.vDir);
      vec3Normalize(curNode.vDir, curNode.vDir);

      vec3RotateAxisGlm(prevNode.vLat, prevNode.vNorm, -lForce / prevNode.fVel / F_HZ, curNode.vLat);
      vec3Normalize(curNode.vLat, curNode.vLat);

      curNode.updateNorm();

      curNode.vPosHeart(this.parent.fHeart, tmpPos);
      prevNode.vPosHeart(this.parent.fHeart, tmpPrev);
      curNode.vPos.x +=
        curNode.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        (tmpPrev.x - tmpPos.x);
      curNode.vPos.y +=
        curNode.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        (tmpPrev.y - tmpPos.y);
      curNode.vPos.z +=
        curNode.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        (tmpPrev.z - tmpPos.z);

      curNode.fRollSpeed = 0;
      curNode.setRoll(this.rollFunc.getValue((i + 1) / F_HZ) / F_HZ);
      this.calcDirFromLast(i + 1);
      const subDeg = this.rollFunc.getSubfunc((i + 1) / F_HZ).degree;
      if (this.bOrientation === EULER || subDeg === EDegree.ToZero) {
        const downY = -curNode.vDir.y;
        curNode.setRoll(downY * curNode.fYawFromLast);
        curNode.fRollSpeed += downY * curNode.fYawFromLast * F_HZ;
      }

      curNode.updateNorm();

      curNode.fDistFromLast = r(
        vec3Distance(
          curNode.vPosHeart(this.parent.fHeart),
          prevNode.vPosHeart(this.parent.fHeart),
        ),
      );
      curNode.fTotalLength = r(prevNode.fTotalLength + curNode.fDistFromLast);
      curNode.fHeartDistFromLast = r(vec3Distance(curNode.vPos, prevNode.vPos));
      curNode.fTotalHeartLength = r(prevNode.fTotalHeartLength + curNode.fHeartDistFromLast);
      curNode.fRollSpeed += this.rollFunc.getValue((i + 1) / F_HZ);

      this.calcDirFromLast(i + 1);

      const temp = Math.cos((Math.abs(curNode.getPitch()) * F_PI) / 180);
      const forceAngle = Math.sqrt(
        temp * temp * curNode.fYawFromLast * curNode.fYawFromLast +
          curNode.fPitchFromLast * curNode.fPitchFromLast,
      );
      curNode.fAngleFromLast = forceAngle;

      if (this.bSpeed) {
        curNode.fEnergy -=
          (curNode.fVel * curNode.fVel * curNode.fVel) / F_HZ * this.parent.fResistance;
        curNode.fVel = Math.sqrt(
          2 *
            (curNode.fEnergy -
              F_G *
                (curNode.vPosHeart(this.parent.fHeart * 0.9).y +
                  curNode.fTotalLength * this.parent.fFriction)),
        );
      } else {
        curNode.fVel = this.fVel;
        curNode.fEnergy =
          0.5 * this.fVel * this.fVel +
          F_G *
            (curNode.vPosHeart(this.parent.fHeart * 0.9).y +
              curNode.fTotalLength * this.parent.fFriction);
      }

      // Re-derive force components from per-step pitch/yaw deltas.
      let fX: number;
      let fY: number;
      let fZ: number;
      if (Math.abs(curNode.fAngleFromLast) < FLOAT_EPSILON) {
        fX = 0;
        fY = 1;
        fZ = 0;
      } else {
        const rollRad = (curNode.fRoll * F_PI) / 180;
        const cosR = Math.cos(rollRad);
        const sinR = Math.sin(rollRad);
        const normalDAngle =
          (F_PI / 180) * (-curNode.fPitchFromLast * cosR - temp * curNode.fYawFromLast * sinR);
        const lateralDAngle =
          (F_PI / 180) * (curNode.fPitchFromLast * sinR - temp * curNode.fYawFromLast * cosR);
        const latCoef = (lateralDAngle * curNode.fVel * F_HZ) / F_G;
        const normCoef = (normalDAngle * curNode.fHeartDistFromLast * F_HZ * F_HZ) / F_G;
        fX = 0 + latCoef * curNode.vLat.x + normCoef * curNode.vNorm.x;
        fY = 1 + latCoef * curNode.vLat.y + normCoef * curNode.vNorm.y;
        fZ = 0 + latCoef * curNode.vLat.z + normCoef * curNode.vNorm.z;
      }
      const nLen2 = Math.sqrt(
        curNode.vNorm.x * curNode.vNorm.x +
          curNode.vNorm.y * curNode.vNorm.y +
          curNode.vNorm.z * curNode.vNorm.z,
      );
      const lLen2 = Math.sqrt(
        curNode.vLat.x * curNode.vLat.x +
          curNode.vLat.y * curNode.vLat.y +
          curNode.vLat.z * curNode.vLat.z,
      );
      const dN2 =
        nLen2 === 0
          ? 0
          : (fX * curNode.vNorm.x + fY * curNode.vNorm.y + fZ * curNode.vNorm.z) / nLen2;
      const dL2 =
        lLen2 === 0
          ? 0
          : (fX * curNode.vLat.x + fY * curNode.vLat.y + fZ * curNode.vLat.z) / lLen2;
      curNode.forceNormal = -dN2;
      curNode.forceLateral = -dL2;
      curNode.forceLong = -curNode.vDir.y;

      void tmpAxis;
    }

    while (this.lNodes.length > 1 + i) this.lNodes.splice(1 + i, 1);
    this.length = this.lNodes.length
      ? this.lNodes[this.lNodes.length - 1]!.fTotalLength - this.lNodes[0]!.fTotalLength
      : 0;
    return node;
  }

  // 1:1 port of secforced.cpp::updateDistanceSection (line 186).
  // DISTANCE-mode uses heart-line length as the func argument instead
  // of time. Step output multiplies by fVel/F_HZ (m/step) when the C++
  // formula needs deg/step from deg/m.
  updateDistanceSection(node: number): number {
    if (node < 0) node = 0;

    let i = 0;
    this.length = 0;
    while (this.length < node / F_HZ && i + 1 < this.lNodes.length) {
      i++;
      this.length = r(this.length + this.lNodes[i]!.fDistFromLast);
    }

    if (i >= this.lNodes.length - 1 && i > 0) i = this.lNodes.length - 2;

    if (
      this.lNodes.length > 1 &&
      this.parent.lSections[this.parent.lSections.length - 1] !== this
    ) {
      this.lNodes.pop();
    }

    if (i === 0) {
      this.lNodes[0]!.updateNorm();
      let diff = this.lNodes[0]!.forceNormal;
      if (Number.isNaN(diff)) {
        this.lNodes.push(this.lNodes[0]!.clone());
        return node;
      }
      this.normForce!.funcList[0]!.translateValues(diff);
      this.normForce!.translateValues(this.normForce!.funcList[0]!);

      diff = this.lNodes[0]!.forceLateral;
      if (Number.isNaN(diff)) {
        this.lNodes.push(this.lNodes[0]!.clone());
        return node;
      }
      this.latForce!.funcList[0]!.translateValues(diff);
      this.latForce!.translateValues(this.latForce!.funcList[0]!);

      diff = this.lNodes[0]!.fRollSpeed / this.lNodes[0]!.fVel;
      if (this.bOrientation === true) {
        diff += (this.lNodes[0]!.vDir.y * this.lNodes[0]!.getYawChange()) / this.lNodes[0]!.fVel;
      }
      this.rollFunc.funcList[0]!.translateValues(diff);
      this.rollFunc.translateValues(this.rollFunc.funcList[0]!);
    }

    const retval = i;
    const end = this.getMaxArgument();

    while (this.length < end) {
      if (i >= this.lNodes.length - 1) {
        this.lNodes.push(this.lNodes[i]!.clone());
      }
      const prevNode = this.lNodes[i]!;
      const curNode = this.lNodes[i + 1]!;
      curNode.vPos.x = prevNode.vPos.x;
      curNode.vPos.y = prevNode.vPos.y;
      curNode.vPos.z = prevNode.vPos.z;
      curNode.fVel = prevNode.fVel;
      curNode.fEnergy = prevNode.fEnergy;

      const nVal = this.normForce!.getValue(this.length + prevNode.fVel / F_HZ);
      const lVal = this.latForce!.getValue(this.length + prevNode.fVel / F_HZ);
      // forceVec = -nVal*vNorm - lVal*vLat - (0,1,0)
      const fvX = -nVal * prevNode.vNorm.x - lVal * prevNode.vLat.x;
      const fvY = -nVal * prevNode.vNorm.y - lVal * prevNode.vLat.y - 1;
      const fvZ = -nVal * prevNode.vNorm.z - lVal * prevNode.vLat.z;

      curNode.forceNormal = nVal;
      curNode.forceLateral = lVal;
      curNode.forceLong = -prevNode.vDir.y;

      const normLen = Math.sqrt(
        prevNode.vNorm.x * prevNode.vNorm.x +
          prevNode.vNorm.y * prevNode.vNorm.y +
          prevNode.vNorm.z * prevNode.vNorm.z,
      );
      const latLen = Math.sqrt(
        prevNode.vLat.x * prevNode.vLat.x +
          prevNode.vLat.y * prevNode.vLat.y +
          prevNode.vLat.z * prevNode.vLat.z,
      );
      const dotN =
        normLen === 0
          ? 0
          : (fvX * prevNode.vNorm.x + fvY * prevNode.vNorm.y + fvZ * prevNode.vNorm.z) / normLen;
      const dotL =
        latLen === 0
          ? 0
          : (fvX * prevNode.vLat.x + fvY * prevNode.vLat.y + fvZ * prevNode.vLat.z) / latLen;
      const nForce = -dotN * F_G;
      const lForce = -dotL * F_G;

      const estVel =
        Math.abs(prevNode.fHeartDistFromLast) < FLOAT_EPSILON
          ? prevNode.fVel
          : prevNode.fHeartDistFromLast * F_HZ;

      // secforced.cpp:261 — same rotation composition as TIME-mode:
      //   curNode.vDir = q_n * q_l * prevNode.vDir
      //   curNode.vLat = q_l * prevNode.vLat
      // where q_l = angleAxis(-lForce/v/F_HZ, prevNode.vNorm),
      //       q_n = angleAxis(nForce/F_HZ/estVel, prevNode.vLat).
      vec3RotateAxisGlm(prevNode.vDir, prevNode.vNorm, -lForce / prevNode.fVel / F_HZ, curNode.vDir);
      vec3RotateAxisGlm(curNode.vDir, prevNode.vLat, nForce / F_HZ / estVel, curNode.vDir);
      vec3Normalize(curNode.vDir, curNode.vDir);

      vec3RotateAxisGlm(prevNode.vLat, prevNode.vNorm, -lForce / prevNode.fVel / F_HZ, curNode.vLat);
      vec3Normalize(curNode.vLat, curNode.vLat);

      curNode.updateNorm();

      const phx = prevNode.fPosHeartx(this.parent.fHeart);
      const phy = prevNode.fPosHearty(this.parent.fHeart);
      const phz = prevNode.fPosHeartz(this.parent.fHeart);
      const chx = curNode.fPosHeartx(this.parent.fHeart);
      const chy = curNode.fPosHearty(this.parent.fHeart);
      const chz = curNode.fPosHeartz(this.parent.fHeart);
      curNode.vPos.x +=
        curNode.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        (phx - chx);
      curNode.vPos.y +=
        curNode.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        (phy - chy);
      curNode.vPos.z +=
        curNode.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        (phz - chz);

      // secforced.cpp:268-271 — setRoll called twice. The first call
      // uses the DISTANCE-mode argument; the second uses the per-step
      // argument. We mirror the order exactly even though the first
      // call's effect is overwritten by the second + by setRoll later.
      curNode.setRoll(
        this.rollFunc.getValue(this.length + curNode.fVel / F_HZ) * (curNode.fVel / F_HZ),
      );
      curNode.fRollSpeed = 0;
      curNode.setRoll(this.rollFunc.getValue(this.length + prevNode.fVel / F_HZ) / F_HZ);
      this.calcDirFromLast(i + 1);
      if (this.bOrientation === EULER) {
        const downY = -curNode.vDir.y;
        curNode.setRoll(downY * curNode.fYawFromLast);
        curNode.fRollSpeed += downY * curNode.fYawFromLast * F_HZ;
      }
      curNode.updateNorm();

      curNode.fDistFromLast = r(
        vec3Distance(
          curNode.vPosHeart(this.parent.fHeart),
          prevNode.vPosHeart(this.parent.fHeart),
        ),
      );
      curNode.fTotalLength = r(prevNode.fTotalLength + curNode.fDistFromLast);
      curNode.fHeartDistFromLast = r(vec3Distance(curNode.vPos, prevNode.vPos));
      curNode.fTotalHeartLength = r(prevNode.fTotalHeartLength + curNode.fHeartDistFromLast);
      curNode.fRollSpeed +=
        this.rollFunc.getValue(this.length + curNode.fVel / F_HZ) * curNode.fVel;

      this.calcDirFromLast(i + 1);
      const tempCos = Math.cos((Math.abs(curNode.getPitch()) * F_PI) / 180);
      const forceAngle = Math.sqrt(
        tempCos * tempCos * curNode.fYawFromLast * curNode.fYawFromLast +
          curNode.fPitchFromLast * curNode.fPitchFromLast,
      );
      curNode.fAngleFromLast = forceAngle;

      if (this.bSpeed) {
        curNode.fEnergy -=
          (curNode.fVel * curNode.fVel * curNode.fVel) / F_HZ * this.parent.fResistance;
        curNode.fVel = Math.sqrt(
          2 *
            (curNode.fEnergy -
              F_G *
                (curNode.vPosHeart(this.parent.fHeart * 0.9).y +
                  curNode.fTotalLength * this.parent.fFriction)),
        );
      } else {
        curNode.fVel = this.fVel;
        curNode.fEnergy =
          0.5 * this.fVel * this.fVel +
          F_G *
            (curNode.vPosHeart(this.parent.fHeart * 0.9).y +
              curNode.fTotalLength * this.parent.fFriction);
      }

      let fX: number;
      let fY: number;
      let fZ: number;
      if (Math.abs(curNode.fAngleFromLast) < FLOAT_EPSILON) {
        fX = 0;
        fY = 1;
        fZ = 0;
      } else {
        const rollRad = (curNode.fRoll * F_PI) / 180;
        const cosR = Math.cos(rollRad);
        const sinR = Math.sin(rollRad);
        const normalDAngle =
          (F_PI / 180) * (-curNode.fPitchFromLast * cosR - tempCos * curNode.fYawFromLast * sinR);
        const lateralDAngle =
          (F_PI / 180) * (curNode.fPitchFromLast * sinR - tempCos * curNode.fYawFromLast * cosR);
        const latCoef = (lateralDAngle * curNode.fVel * F_HZ) / F_G;
        const normCoef = (normalDAngle * curNode.fHeartDistFromLast * F_HZ * F_HZ) / F_G;
        fX = 0 + latCoef * curNode.vLat.x + normCoef * curNode.vNorm.x;
        fY = 1 + latCoef * curNode.vLat.y + normCoef * curNode.vNorm.y;
        fZ = 0 + latCoef * curNode.vLat.z + normCoef * curNode.vNorm.z;
      }
      const nLen2 = Math.sqrt(
        curNode.vNorm.x * curNode.vNorm.x +
          curNode.vNorm.y * curNode.vNorm.y +
          curNode.vNorm.z * curNode.vNorm.z,
      );
      const lLen2 = Math.sqrt(
        curNode.vLat.x * curNode.vLat.x +
          curNode.vLat.y * curNode.vLat.y +
          curNode.vLat.z * curNode.vLat.z,
      );
      const dN2 =
        nLen2 === 0
          ? 0
          : (fX * curNode.vNorm.x + fY * curNode.vNorm.y + fZ * curNode.vNorm.z) / nLen2;
      const dL2 =
        lLen2 === 0
          ? 0
          : (fX * curNode.vLat.x + fY * curNode.vLat.y + fZ * curNode.vLat.z) / lLen2;
      curNode.forceNormal = -dN2;
      curNode.forceLateral = -dL2;
      curNode.forceLong = -curNode.vDir.y;

      this.length = r(this.length + curNode.fDistFromLast);
      i++;
    }
    while (this.lNodes.length > 1 + i) this.lNodes.splice(1 + i, 1);
    this.length = this.lNodes.length
      ? this.lNodes[this.lNodes.length - 1]!.fTotalLength - this.lNodes[0]!.fTotalLength
      : 0;
    return retval;
  }

  getMaxArgument(): number {
    let min = Number.MAX_VALUE;
    if (this.rollFunc.lockedFunc() === -1) min = this.rollFunc.getMaxArgument();
    if (this.normForce?.lockedFunc() === -1) {
      const m = this.normForce.getMaxArgument();
      if (m < min) min = m;
    }
    if (this.latForce?.lockedFunc() === -1) {
      const m = this.latForce.getMaxArgument();
      if (m < min) min = m;
    }
    return min;
  }

  isLockable(f: Func): boolean {
    if (f === this.rollFunc) {
      if (this.normForce!.lockedFunc() !== -1 && this.latForce!.lockedFunc() !== -1) return false;
    } else if (f === this.normForce) {
      if (this.rollFunc.lockedFunc() !== -1 && this.latForce!.lockedFunc() !== -1) return false;
    } else if (f === this.latForce) {
      if (this.rollFunc.lockedFunc() !== -1 && this.normForce!.lockedFunc() !== -1) return false;
    } else {
      return false;
    }
    return true;
  }

  isInFunction(index: number, sf: Subfunc | null): boolean {
    if (!sf) return false;
    if (this.bArgument === DISTANCE) {
      let dist = 0;
      if (index >= this.lNodes.length) return false;
      for (let i = 1; i <= index; i++) dist += this.lNodes[i]!.fHeartDistFromLast;
      return dist >= sf.minArgument && dist <= sf.maxArgument;
    }
    return index / F_HZ >= sf.minArgument && index / F_HZ <= sf.maxArgument;
  }

  saveSection(ws: WriteStream): void {
    ws.writeString('FRC');
    ws.writeBool(this.bSpeed);
    ws.writeInt(this.sName.length);
    ws.writeString(this.sName);
    ws.writeFloat(this.fVel);
    ws.writeInt(this.iTime);
    ws.writeBool(this.bOrientation);
    ws.writeBool(this.bArgument);
    writeFunc(ws, this.rollFunc);
    writeFunc(ws, this.normForce!);
    writeFunc(ws, this.latForce!);
  }

  loadSection(rs: ReadStream): void {
    this.bSpeed = rs.readBool();
    const nlen = rs.readInt();
    this.sName = rs.readString(nlen);
    this.fVel = rs.readFloat();
    this.iTime = rs.readInt();
    this.bOrientation = rs.readBool();
    this.bArgument = rs.readBool();
    loadFunc(rs, this.rollFunc);
    loadFunc(rs, this.normForce!);
    loadFunc(rs, this.latForce!);
  }

  legacyLoadSection(rs: ReadStream): void {
    this.bSpeed = rs.readBool();
    const nlen = rs.readInt();
    this.sName = rs.readString(nlen);
    this.bSpeed = true;
    this.iTime = rs.readInt();
    this.bOrientation = rs.readBool();
    this.bArgument = rs.readBool();
    loadFunc(rs, this.rollFunc);
    loadFunc(rs, this.normForce!);
    loadFunc(rs, this.latForce!);
  }
}

