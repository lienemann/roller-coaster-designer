// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/secstraight.cpp.

import { F_G, F_HZ, FLOAT_EPSILON } from './constants.js';
import type { Func } from './func.js';
import { r, vec3Distance } from './fvec.js';
import type { ReadStream, WriteStream } from './io-stream.js';
import { type MNode } from './mnode.js';
import { Section, SecType, TIME, QUATERNION } from './section.js';
import { type Subfunc, type Subfunc as SubfuncCls, type EDegree } from './subfunction.js';
import type { Track } from './track.js';

export class SecStraight extends Section {
  constructor(parent: Track, first: MNode, getLength: number) {
    super(parent, SecType.Straight, first);
    this.fHLength = getLength;
    this.bArgument = TIME;
    this.bOrientation = QUATERNION;
    this.bSpeed = false;
    this.fVel = 10;
  }

  changeLength(newLength: number): void {
    this.fHLength = newLength;
    this.updateSection();
  }

  // secstraight.cpp:43
  updateSection(_node = 0): number {
    let numNodes = 1;
    this.length = 0;
    this.fHLength = this.getMaxArgument();

    while (this.lNodes.length > 1) this.lNodes.pop();
    this.lNodes[0]!.updateNorm();

    const diff = this.lNodes[0]!.fRollSpeed;
    this.rollFunc.funcList[0]!.translateValues(diff);
    this.rollFunc.translateValues(this.rollFunc.funcList[0]!);

    let lastNode = false;
    let fCurLength = 0;

    while (fCurLength < this.fHLength - FLOAT_EPSILON && !lastNode) {
      this.lNodes.push(this.lNodes[this.lNodes.length - 1]!.clone());

      let dTime: number;
      const prevNode = this.lNodes[numNodes - 1]!;
      const curNode = this.lNodes[numNodes]!;

      if (curNode.fVel < 0.1) {
        break;
      }
      if (curNode.fVel / F_HZ < this.fHLength - fCurLength) {
        dTime = F_HZ;
      } else {
        lastNode = true;
        dTime = (curNode.fVel + FLOAT_EPSILON) / (this.fHLength - fCurLength);
      }

      curNode.vPos.x += curNode.vDir.x * (curNode.fVel / dTime);
      curNode.vPos.y += curNode.vDir.y * (curNode.fVel / dTime);
      curNode.vPos.z += curNode.vDir.z * (curNode.fVel / dTime);

      fCurLength += curNode.fVel / dTime;

      curNode.setRoll(this.rollFunc.getValue(fCurLength) / dTime);

      curNode.forceNormal = -curNode.vNorm.y;
      curNode.forceLateral = -curNode.vLat.y;
      curNode.forceLong = -curNode.vDir.y;

      // Float32-rounded heart-line / spine length accumulators — see
      // sec-curved.ts for the rationale (float64 vs float32 aliasing on
      // fTotalLength would cause fFillPointList to sample one node off).
      curNode.fDistFromLast = r(
        vec3Distance(
          curNode.vPosHeart(this.parent.fHeart),
          prevNode.vPosHeart(this.parent.fHeart),
        ),
      );
      curNode.fTotalLength = r(curNode.fTotalLength + curNode.fDistFromLast);
      curNode.fHeartDistFromLast = r(vec3Distance(curNode.vPos, prevNode.vPos));
      curNode.fTotalHeartLength = r(curNode.fTotalHeartLength + curNode.fHeartDistFromLast);

      curNode.fRollSpeed = this.rollFunc.getValue(fCurLength);

      this.calcDirFromLast(numNodes);
      curNode.fAngleFromLast = 0;
      curNode.fDirFromLast = 0;
      curNode.fYawFromLast = 0;
      curNode.fPitchFromLast = 0;
      if (Math.abs(curNode.fRollSpeed) < 0.001) {
        curNode.fTrackAngleFromLast = 0;
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

      this.length += curNode.fDistFromLast;
      numNodes++;
    }

    while (this.lNodes.length > numNodes) this.lNodes.pop();
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
    if (index >= this.lNodes.length) return false;
    const dist = this.lNodes[index]!.fTotalHeartLength - this.lNodes[0]!.fTotalHeartLength;
    return dist >= sf.minArgument && dist <= sf.maxArgument;
  }

  // FVD on-disk layout: "STR" tag is consumed by Track.load before
  // dispatching here. So this method only reads the section body.
  saveSection(ws: WriteStream): void {
    ws.writeString('STR');
    ws.writeBool(this.bSpeed);
    ws.writeInt(this.sName.length);
    ws.writeString(this.sName);
    ws.writeFloat(this.fVel);
    ws.writeFloat(this.fHLength);
    writeFunc(ws, this.rollFunc);
  }

  loadSection(rs: ReadStream): void {
    this.bSpeed = rs.readBool();
    const nlen = rs.readInt();
    this.sName = rs.readString(nlen);
    this.fVel = rs.readFloat();
    this.fHLength = rs.readFloat();
    loadFunc(rs, this.rollFunc);
  }

  legacyLoadSection(rs: ReadStream): void {
    this.loadSection(rs);
  }
}

// Shared func IO helpers. They write/read the "FUNC<int size><subfunc>*size"
// payload. SubfuncCls and EDegree are re-imported above as aliases to keep
// lint happy about import grouping.

export function writeFunc(ws: WriteStream, f: Func): void {
  ws.writeString('FUNC');
  ws.writeInt(f.funcList.length);
  for (const sub of f.funcList) writeSubfunc(ws, sub);
}

function writeSubfunc(ws: WriteStream, s: SubfuncCls): void {
  ws.writeInt(s.degree);
  ws.writeFloat(s.minArgument);
  ws.writeFloat(s.maxArgument);
  ws.writeFloat(s.startValue);
  ws.writeFloat(s.arg1);
  ws.writeFloat(s.symArg);
  ws.writeFloat(s.centerArg);
  ws.writeFloat(s.tensionArg);
  ws.writeBool(s.locked);
}

export function loadFunc(rs: ReadStream, f: Func): void {
  const tag = rs.readString(4);
  if (tag !== 'FUNC') {
    throw new Error(`expected FUNC, got "${tag}"`);
  }
  const size = rs.readInt();
  loadSubfunc(rs, f.funcList[0]!);
  for (let i = 1; i < size; i++) {
    f.appendSubFunction(1, i - 1);
    loadSubfunc(rs, f.funcList[i]!);
  }
}

function loadSubfunc(rs: ReadStream, s: SubfuncCls): void {
  const degree = rs.readInt() as EDegree;
  const minArg = rs.readFloat();
  const maxArg = rs.readFloat();
  const startValue = rs.readFloat();
  const arg1 = rs.readFloat();
  const symArg = rs.readFloat();
  const centerArg = rs.readFloat();
  const tensionArg = rs.readFloat();
  const locked = rs.readBool();
  // 1:1 port of subfunction.cpp::loadSubFunction (line 317+): direct
  // field assignment, no changeDegree() call. FVD's wire format never
  // persists pointList, so a loaded Freeform subfunc has degree=Freeform
  // but an empty valueList. FVD's evaluator does OOB reads on the empty
  // QList in that state — in QList<float> those return 0, so a loaded
  // Freeform subfunc effectively evaluates to startValue everywhere. We
  // mirror this exactly in subfunction.ts::getValue's Freeform branch.
  s.degree = degree;
  s.minArgument = minArg;
  s.maxArgument = maxArg;
  s.startValue = startValue;
  s.arg1 = arg1;
  s.symArg = symArg;
  s.centerArg = centerArg;
  s.tensionArg = tensionArg;
  s.locked = locked;
}
