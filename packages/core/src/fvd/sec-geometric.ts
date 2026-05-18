// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/secgeometric.cpp (TIME mode).

import { F_G, F_HZ, F_PI, FLOAT_EPSILON } from './constants.js';
import { Func, EFunctype } from './func.js';
import { vec3Distance } from './fvec.js';
import type { ReadStream, WriteStream } from './io-stream.js';
import { type MNode } from './mnode.js';
import { loadFunc, writeFunc } from './sec-straight.js';
import { Section, SecType, TIME, EULER, DISTANCE } from './section.js';
import { type Subfunc, EDegree } from './subfunction.js';
import type { Track } from './track.js';

export class SecGeometric extends Section {
  constructor(parent: Track, first: MNode, getTime: number) {
    super(parent, SecType.Geometric, first);
    this.iTime = (getTime + 0.5) | 0;
    this.length = 0;
    this.rollFunc.changeLength(1, 0);
    const dPitch = this.lNodes[0]!.getPitchChange();
    const dYaw = this.lNodes[0]!.getYawChange();
    this.normForce = new Func(0, 1, dPitch, dPitch, this, EFunctype.FuncPitch);
    this.latForce = new Func(0, 1, dYaw, dYaw, this, EFunctype.FuncYaw);
    this.bOrientation = EULER;
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
      throw new Error('SecGeometric: DISTANCE mode not yet ported');
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
      let diff = this.lNodes[0]!.getPitchChange();
      this.normForce!.funcList[0]!.translateValues(diff);
      this.normForce!.translateValues(this.normForce!.funcList[0]!);

      diff = this.lNodes[0]!.getYawChange();
      this.latForce!.funcList[0]!.translateValues(diff);
      this.latForce!.translateValues(this.latForce!.funcList[0]!);

      diff = this.lNodes[0]!.fRollSpeed;
      if (this.bOrientation === EULER) {
        diff += this.lNodes[0]!.vDir.y * this.lNodes[0]!.getYawChange();
      }
      this.rollFunc.funcList[0]!.translateValues(diff);
      this.rollFunc.translateValues(this.rollFunc.funcList[0]!);
    }

    // Bring artificialRoll up to `node` by replaying the polynomial.
    let artificialRoll = this.lNodes[0]!.fRoll;
    for (let k = 0; k < node; k++) {
      if (this.bOrientation === false) {
        const downY = -this.lNodes[k + 1]!.vDir.y;
        artificialRoll -= downY * this.latForce!.getValue((k + 1) / F_HZ) / F_HZ;
      }
      artificialRoll += this.rollFunc.getValue((k + 1) / F_HZ) / F_HZ;
      while (artificialRoll > 180) artificialRoll -= 360;
      while (artificialRoll < -180) artificialRoll += 360;
    }

    let i: number;
    for (i = node; i < numNodes; i++) {
      if (i >= this.lNodes.length - 1) this.lNodes.push(this.lNodes[i]!.clone());

      const prevNode = this.lNodes[i]!;
      const curNode = this.lNodes[i + 1]!;

      curNode.vPos.x = prevNode.vPos.x;
      curNode.vPos.y = prevNode.vPos.y;
      curNode.vPos.z = prevNode.vPos.z;
      curNode.vDir.x = prevNode.vDir.x;
      curNode.vDir.y = prevNode.vDir.y;
      curNode.vDir.z = prevNode.vDir.z;
      curNode.vLat.x = prevNode.vLat.x;
      curNode.vLat.y = prevNode.vLat.y;
      curNode.vLat.z = prevNode.vLat.z;
      curNode.vNorm.x = prevNode.vNorm.x;
      curNode.vNorm.y = prevNode.vNorm.y;
      curNode.vNorm.z = prevNode.vNorm.z;
      curNode.fVel = prevNode.fVel;
      curNode.fEnergy = prevNode.fEnergy;

      const pitchChange = this.normForce!.getValue((i + 1) / F_HZ) / F_HZ;
      const yawChange = this.latForce!.getValue((i + 1) / F_HZ) / F_HZ;
      const sign = Math.abs(artificialRoll) >= 90 ? -1 : 1;

      curNode.changePitch(pitchChange, sign === -1);
      curNode.changeYaw(yawChange);

      const pureYawChange = (1 - Math.abs(curNode.vDir.y)) * yawChange;
      const pureRollChange = -curNode.vDir.y * yawChange * F_HZ;
      const deltaAngle = Math.sqrt(pitchChange * pitchChange + pureYawChange * pureYawChange);

      curNode.setRoll(-pureRollChange / F_HZ);
      artificialRoll -= pureRollChange / F_HZ;

      const phx = prevNode.fPosHeartx(this.parent.fHeart);
      const phy = prevNode.fPosHearty(this.parent.fHeart);
      const phz = prevNode.fPosHeartz(this.parent.fHeart);
      const chx = curNode.fPosHeartx(this.parent.fHeart);
      const chy = curNode.fPosHearty(this.parent.fHeart);
      const chz = curNode.fPosHeartz(this.parent.fHeart);
      curNode.vPos.x +=
        curNode.vDir.x * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.x * (prevNode.fVel / (2 * F_HZ)) +
        (phx - chx);
      curNode.vPos.y +=
        curNode.vDir.y * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.y * (prevNode.fVel / (2 * F_HZ)) +
        (phy - chy);
      curNode.vPos.z +=
        curNode.vDir.z * (curNode.fVel / (2 * F_HZ)) +
        prevNode.vDir.z * (prevNode.fVel / (2 * F_HZ)) +
        (phz - chz);

      curNode.updateNorm();

      curNode.setRoll(this.rollFunc.getValue((i + 1) / F_HZ) / F_HZ);

      const subDeg = this.rollFunc.getSubfunc((i + 1) / F_HZ).degree;
      if (this.bOrientation === EULER || subDeg === EDegree.ToZero) {
        curNode.setRoll(pureRollChange / F_HZ);
        artificialRoll += pureRollChange / F_HZ;
      }

      artificialRoll += this.rollFunc.getValue((i + 1) / F_HZ) / F_HZ;
      while (artificialRoll > 180) artificialRoll -= 360;
      while (artificialRoll < -180) artificialRoll += 360;
      curNode.updateNorm();

      curNode.fDistFromLast = vec3Distance(
        curNode.vPosHeart(this.parent.fHeart),
        prevNode.vPosHeart(this.parent.fHeart),
      );
      curNode.fTotalLength = prevNode.fTotalLength + curNode.fDistFromLast;
      curNode.fHeartDistFromLast = vec3Distance(curNode.vPos, prevNode.vPos);
      curNode.fTotalHeartLength = prevNode.fTotalHeartLength + curNode.fHeartDistFromLast;
      curNode.fRollSpeed = this.rollFunc.getValue((i + 1) / F_HZ);

      if (this.bOrientation === EULER || subDeg === EDegree.ToZero) {
        curNode.fRollSpeed += pureRollChange;
      }

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

      this.calcDirFromLast(i + 1);
      const tempCos = Math.cos((Math.abs(curNode.getPitch()) * F_PI) / 180);
      const forceAngle = Math.sqrt(
        tempCos * tempCos * curNode.fYawFromLast * curNode.fYawFromLast +
          curNode.fPitchFromLast * curNode.fPitchFromLast,
      );
      curNode.fAngleFromLast = forceAngle;

      let fX: number;
      let fY: number;
      let fZ: number;
      if (Math.abs(deltaAngle) < FLOAT_EPSILON) {
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
    }
    while (this.lNodes.length > 1 + i) this.lNodes.splice(1 + i, 1);
    this.length = this.lNodes.length
      ? this.lNodes[this.lNodes.length - 1]!.fTotalLength - this.lNodes[0]!.fTotalLength
      : 0;
    return node;
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
    ws.writeString('GEO');
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
    this.loadSection(rs);
  }
}
