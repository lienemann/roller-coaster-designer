// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/seccurved.cpp.

import { F_G, F_HZ, F_PI, FLOAT_EPSILON, toRad } from './constants.js';
import type { Func } from './func.js';
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
import { Section, SecType, TIME, EULER } from './section.js';
import type { Subfunc } from './subfunction.js';
import type { Track } from './track.js';

export class SecCurved extends Section {
  lAngles: number[] = [];

  constructor(parent: Track, first: MNode, getAngle: number, getRadius: number) {
    super(parent, SecType.Curved, first);
    this.fAngle = getAngle;
    this.fRadius = getRadius;
    this.fLeadIn = getAngle / 3 > 10 ? 10 : getAngle / 3;
    this.fLeadOut = getAngle / 3 > 10 ? 10 : getAngle / 3;
    this.fDirection = 90;
    this.length = 0;
    this.bOrientation = false;
    this.bArgument = TIME;
    this.bSpeed = false;
    this.fVel = 10;
    this.rollFunc.setMaxArgument(getAngle);
  }

  // seccurved.cpp:48
  updateSection(_node = 0): number {
    this.length = 0;
    let numNodes = 1;
    let fRiddenAngle = 0;
    let artificialRoll = 0;

    this.fAngle = this.getMaxArgument();

    while (this.lNodes.length > 1) {
      this.lNodes.pop();
      if (this.lAngles.length > 1) this.lAngles.pop();
    }
    while (this.lAngles.length <= this.lNodes.length) this.lAngles.push(0);
    this.lAngles[0] = 0;
    this.lNodes[0]!.updateNorm();

    let diff = this.lNodes[0]!.fRollSpeed;
    if (this.bOrientation === true) {
      // EULER
      diff += this.lNodes[0]!.vDir.y * this.lNodes[0]!.getYawChange();
    }
    this.rollFunc.funcList[0]!.translateValues(diff);
    this.rollFunc.translateValues(this.rollFunc.funcList[0]!);

    let leadOutNode: MNode | null = null;
    let myLeadOut = 0;

    const tmpAxis: Vec3 = vec3();
    const tmpPos: Vec3 = vec3();
    const tmpPrev: Vec3 = vec3();

    while (fRiddenAngle < this.fAngle - FLOAT_EPSILON) {
      let deltaAngle: number;
      let fTrans: number;
      const prevNode = this.lNodes[numNodes - 1]!;
      deltaAngle = (prevNode.fVel / this.fRadius / F_HZ * 180) / F_PI;

      if (this.fLeadIn > 0) {
        fTrans =
          (prevNode.fTotalLength - this.lNodes[0]!.fTotalLength) /
          ((1.997 / F_HZ) * (prevNode.fVel / deltaAngle) * this.fLeadIn);
        if (fTrans <= 1) {
          deltaAngle *= fTrans * fTrans * (3 + fTrans * -2);
        }
      }

      if (leadOutNode === null && fRiddenAngle > this.fAngle - this.fLeadOut) {
        leadOutNode = prevNode;
        myLeadOut = this.fAngle - fRiddenAngle;
      }
      if (leadOutNode && this.fLeadOut > 0) {
        fTrans =
          1 -
          (prevNode.fTotalLength - leadOutNode.fTotalLength) /
            ((1.997 / F_HZ) * (prevNode.fVel / deltaAngle) * myLeadOut);
        if (fTrans >= 0) {
          deltaAngle *= fTrans * fTrans * (3 + fTrans * -2);
        } else {
          break;
        }
      }

      this.lNodes.push(prevNode.clone());

      const curNode = this.lNodes[numNodes]!;
      const prevNode2 = this.lNodes[numNodes - 1]!;

      if (curNode.fVel < 0.1) {
        break;
      }

      fRiddenAngle += deltaAngle;
      this.lAngles[numNodes] = fRiddenAngle;

      curNode.updateNorm();

      // Axis construction in C++ float32 (seccurved.cpp:119). Each cast
      // through r() forces a float32 store at the same boundaries the C++
      // would have. Without this every binary op accumulates float64
      // precision, and over the 1700-step curve the result drifts ~3 cm
      // beyond what FVD computes.
      const fPureDirection = r(this.fDirection - artificialRoll);
      const cd = r(Math.cos(r(r(-fPureDirection * F_PI) / 180)));
      const sd = r(Math.sin(r(r(-fPureDirection * F_PI) / 180)));
      tmpAxis.x = r(r(cd * prevNode2.vLat.x) + r(sd * prevNode2.vNorm.x));
      tmpAxis.y = r(r(cd * prevNode2.vLat.y) + r(sd * prevNode2.vNorm.y));
      tmpAxis.z = r(r(cd * prevNode2.vLat.z) + r(sd * prevNode2.vNorm.z));

      vec3RotateAxisGlm(prevNode2.vDir, tmpAxis, toRad(deltaAngle), curNode.vDir);
      vec3RotateAxisGlm(prevNode2.vLat, tmpAxis, toRad(deltaAngle), curNode.vLat);
      vec3Normalize(curNode.vDir, curNode.vDir);
      vec3Normalize(curNode.vLat, curNode.vLat);
      curNode.updateNorm();

      // vPos += vDir*(v/2HZ) + prevDir*(v/2HZ) + (prevHeart - curHeart)
      curNode.vPosHeart(this.parent.fHeart, tmpPos);
      prevNode2.vPosHeart(this.parent.fHeart, tmpPrev);
      curNode.vPos.x +=
        curNode.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        prevNode2.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        (tmpPrev.x - tmpPos.x);
      curNode.vPos.y +=
        curNode.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        prevNode2.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        (tmpPrev.y - tmpPos.y);
      curNode.vPos.z +=
        curNode.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        prevNode2.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        (tmpPrev.z - tmpPos.z);

      curNode.setRoll(this.rollFunc.getValue(fRiddenAngle) / F_HZ);
      curNode.fRollSpeed = this.rollFunc.getValue(fRiddenAngle);
      artificialRoll += this.rollFunc.getValue(fRiddenAngle) / F_HZ;

      if (this.bOrientation === EULER) {
        this.calcDirFromLast(numNodes);
        const downY = -this.lNodes[numNodes]!.vDir.y;
        this.lNodes[numNodes]!.setRoll(downY * this.lNodes[numNodes]!.fYawFromLast);
        artificialRoll += downY * this.lNodes[numNodes]!.fYawFromLast;
        curNode.fRollSpeed += downY * this.lNodes[numNodes]!.fYawFromLast * F_HZ;
      }

      curNode.updateNorm();

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

      curNode.updateRoll();

      // Heart-line and rail-spine distances. fDistFromLast is the heart
      // distance (used by fFillPointList for export-point sampling), so
      // its float32-rounded accumulation needs to track FVD exactly —
      // otherwise we sample one node off the gold output.
      curNode.fDistFromLast = r(
        vec3Distance(
          curNode.vPosHeart(this.parent.fHeart),
          prevNode2.vPosHeart(this.parent.fHeart),
        ),
      );
      curNode.fTotalLength = r(curNode.fTotalLength + curNode.fDistFromLast);
      curNode.fHeartDistFromLast = r(vec3Distance(curNode.vPos, prevNode2.vPos));
      curNode.fTotalHeartLength = r(curNode.fTotalHeartLength + curNode.fHeartDistFromLast);

      this.calcDirFromLast(numNodes);

      const tempCos = Math.cos((Math.abs(this.lNodes[numNodes]!.getPitch()) * F_PI) / 180);
      const forceAngle = Math.sqrt(
        tempCos * tempCos * curNode.fYawFromLast * curNode.fYawFromLast +
          curNode.fPitchFromLast * curNode.fPitchFromLast,
      );
      curNode.fAngleFromLast = forceAngle;

      // Force projection
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
      const normLen = Math.sqrt(
        curNode.vNorm.x * curNode.vNorm.x +
          curNode.vNorm.y * curNode.vNorm.y +
          curNode.vNorm.z * curNode.vNorm.z,
      );
      const latLen = Math.sqrt(
        curNode.vLat.x * curNode.vLat.x +
          curNode.vLat.y * curNode.vLat.y +
          curNode.vLat.z * curNode.vLat.z,
      );
      const dotN =
        normLen === 0
          ? 0
          : (fX * curNode.vNorm.x + fY * curNode.vNorm.y + fZ * curNode.vNorm.z) / normLen;
      const dotL =
        latLen === 0
          ? 0
          : (fX * curNode.vLat.x + fY * curNode.vLat.y + fZ * curNode.vLat.z) / latLen;
      curNode.forceNormal = -dotN;
      curNode.forceLateral = -dotL;

      numNodes++;
    }

    if (this.fLeadOut > 0.0001) {
      const last = this.lNodes[this.lNodes.length - 1]!;
      last.fAngleFromLast = 0;
      last.fPitchFromLast = 0;
      last.fYawFromLast = 0;
    }
    this.length = this.lNodes.length
      ? this.lNodes[this.lNodes.length - 1]!.fTotalLength - this.lNodes[0]!.fTotalLength
      : 0;
    return 0;
  }

  getMaxArgument(): number {
    return this.rollFunc.getMaxArgument();
  }

  isLockable(_f: Func): boolean {
    return false;
  }

  isInFunction(index: number, sf: Subfunc | null): boolean {
    if (!sf) return false;
    const angle = this.lAngles[index]!;
    return angle >= sf.minArgument && angle <= sf.maxArgument;
  }

  saveSection(ws: WriteStream): void {
    ws.writeString('CUR');
    ws.writeBool(this.bSpeed);
    ws.writeInt(this.sName.length);
    ws.writeString(this.sName);
    ws.writeFloat(this.fVel);
    ws.writeFloat(this.fAngle);
    ws.writeFloat(this.fRadius);
    ws.writeFloat(this.fDirection);
    ws.writeFloat(this.fLeadIn);
    ws.writeFloat(this.fLeadOut);
    ws.writeBool(this.bOrientation);
    writeFunc(ws, this.rollFunc);
  }

  loadSection(rs: ReadStream): void {
    this.bSpeed = rs.readBool();
    const nlen = rs.readInt();
    this.sName = rs.readString(nlen);
    this.fVel = rs.readFloat();
    this.fAngle = rs.readFloat();
    this.fRadius = rs.readFloat();
    this.fDirection = rs.readFloat();
    this.fLeadIn = rs.readFloat();
    this.fLeadOut = rs.readFloat();
    this.bOrientation = rs.readBool();
    loadFunc(rs, this.rollFunc);
  }

  legacyLoadSection(rs: ReadStream): void {
    this.loadSection(rs);
  }
}
