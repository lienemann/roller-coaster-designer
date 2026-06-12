// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/secbezier.cpp.
//
// A Bezier section is a chain of cubic segments. `bezList[i]` carries the
// knot `P1` plus the outgoing handle `Kp2` (toward the next knot) and the
// incoming handle `Kp1` (from the previous knot): the cubic between knot b
// and knot b+1 is (P1[b], Kp2[b], Kp1[b+1], P1[b+1]).
//
// updateSection runs three passes over the curve (secbezier.cpp:38):
//   1. Sample nodes along the chain at dt = vel/(3000·|dC/dt|) — i.e.
//      1000 Hz spatial stepping with the cubic-derivative factor 3 folded
//      into the 3000 constant. Computes pose, velocity, energy.
//   2. Resolve each segment's absolute roll (`fvdRoll`) from the authored
//      `roll`, the relRoll flag, and the yaw-induced roll `correction`;
//      bank every node to its segment's base roll.
//   3. Integrate the per-segment roll transition polynomial (ptf) and
//      apply it on top, fill distance/rollspeed/force columns.

import { F_G, F_HZ, F_PI, FLOAT_EPSILON } from './constants.js';
import type { Func } from './func.js';
import { r, vec3Distance } from './fvec.js';
import type { ReadStream, WriteStream } from './io-stream.js';
import { type MNode } from './mnode.js';
import { Section, SecType, TIME, QUATERNION, type BezierT } from './section.js';
import type { Subfunc } from './subfunction.js';
import type { Track } from './track.js';

export class SecBezier extends Section {
  constructor(parent: Track, first: MNode) {
    super(parent, SecType.Bezier, first);
    this.bOrientation = QUATERNION;
    this.bArgument = TIME;
    this.bSpeed = false;
    this.fVel = 10;
  }

  // secbezier.cpp:38
  updateSection(node = 0): number {
    const tList: number[] = [];

    // QList::removeAt(1) in a loop — keeps node 0, drops the rest.
    while (this.lNodes.length > 1) this.lNodes.splice(1, 1);
    this.lNodes[0]!.updateNorm();

    let cur = 0;
    let lastcur = 0;
    let t = 0;

    const bezList = this.bezList;
    const fHeart = this.parent.fHeart;

    // ----- pass 1: sample the chain (secbezier.cpp:57) -----
    for (let b = 0; b < bezList.length - 1; b++) {
      const seg = bezList[b]!;
      while (t < 1) {
        tList.push(t);

        const bnext = (b + 1) % bezList.length;
        const next = bezList[bnext]!;
        const t1 = r(1 - t);
        if (cur >= this.lNodes.length) {
          this.lNodes.push(this.lNodes[this.lNodes.length - 1]!.clone());
        }
        const prevNode = this.lNodes[Math.max(cur - 1, 0)]!;
        const curNode = this.lNodes[cur]!;
        curNode.fEnergy = prevNode.fEnergy;

        // vPos = t1³·P1[b] + 3·t1²·t·Kp2[b] + 3·t1·t²·Kp1[b+1] + t³·P1[b+1]
        const w0 = r(t1 * t1 * t1);
        const w1 = r(3 * t1 * t1 * t);
        const w2 = r(3 * t1 * t * t);
        const w3 = r(t * t * t);
        curNode.vPos.x = r(w0 * seg.P1.x + w1 * seg.Kp2.x + w2 * next.Kp1.x + w3 * next.P1.x);
        curNode.vPos.y = r(w0 * seg.P1.y + w1 * seg.Kp2.y + w2 * next.Kp1.y + w3 * next.P1.y);
        curNode.vPos.z = r(w0 * seg.P1.z + w1 * seg.Kp2.z + w2 * next.Kp1.z + w3 * next.P1.z);

        // fRoll = lerp of the segments' absolute rolls (radians → deg).
        curNode.fRoll = r(((t1 * seg.fvdRoll + t * next.fvdRoll) * 180) / F_PI);

        // Quadratic derivative (the cubic-derivative ×3 is folded into
        // the 3000 in the t-step below).
        const d1x = seg.Kp2.x - seg.P1.x;
        const d1y = seg.Kp2.y - seg.P1.y;
        const d1z = seg.Kp2.z - seg.P1.z;
        const d2x = next.Kp1.x - seg.Kp2.x;
        const d2y = next.Kp1.y - seg.Kp2.y;
        const d2z = next.Kp1.z - seg.Kp2.z;
        const d3x = next.P1.x - next.Kp1.x;
        const d3y = next.P1.y - next.Kp1.y;
        const d3z = next.P1.z - next.Kp1.z;
        const q0 = r(t1 * t1);
        const q1 = r(2 * t1 * t);
        const q2 = r(t * t);
        let dirX = r(q0 * d1x + q1 * d2x + q2 * d3x);
        let dirY = r(q0 * d1y + q1 * d2y + q2 * d3y);
        let dirZ = r(q0 * d1z + q1 * d2z + q2 * d3z);

        const lengthDir = r(Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ));
        if (lengthDir > 0) {
          dirX = r(dirX / lengthDir);
          dirY = r(dirY / lengthDir);
          dirZ = r(dirZ / lengthDir);
        }
        curNode.vDir.x = dirX;
        curNode.vDir.y = dirY;
        curNode.vDir.z = dirZ;

        curNode.vLat.x = r(-curNode.vDir.z);
        curNode.vLat.y = 0;
        curNode.vLat.z = curNode.vDir.x;

        const latLen = Math.sqrt(
          curNode.vLat.x * curNode.vLat.x +
            curNode.vLat.y * curNode.vLat.y +
            curNode.vLat.z * curNode.vLat.z,
        );
        if (latLen < FLOAT_EPSILON) {
          // vLat = normalize(cross(vNorm, vDir))
          const cx = curNode.vNorm.y * curNode.vDir.z - curNode.vNorm.z * curNode.vDir.y;
          const cy = curNode.vNorm.z * curNode.vDir.x - curNode.vNorm.x * curNode.vDir.z;
          const cz = curNode.vNorm.x * curNode.vDir.y - curNode.vNorm.y * curNode.vDir.x;
          const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
          curNode.vLat.x = r(cx / cl);
          curNode.vLat.y = r(cy / cl);
          curNode.vLat.z = r(cz / cl);
        }

        curNode.setRoll(0);

        if (cur) {
          curNode.fHeartDistFromLast = r(
            vec3Distance(curNode.vPos, this.lNodes[cur - 1]!.vPos),
          );
          curNode.fTotalHeartLength = r(
            curNode.fTotalHeartLength + curNode.fHeartDistFromLast,
          );
          curNode.fDistFromLast = r(
            vec3Distance(curNode.vPosHeart(fHeart), prevNode.vPosHeart(fHeart)),
          );
          curNode.fTotalLength = r(prevNode.fTotalLength + curNode.fDistFromLast);
        }

        // secbezier.cpp:108 — per-segment held velocity; 0 = energy-driven.
        let vel = seg.fVel;
        if (vel === 0) {
          curNode.fEnergy = r(
            curNode.fEnergy -
              (curNode.fVel * curNode.fVel * curNode.fVel) / F_HZ * this.parent.fResistance,
          );
          vel = r(
            Math.sqrt(
              2 *
                (curNode.fEnergy -
                  9.80665 *
                    (curNode.vPosHeart(fHeart * 0.9).y +
                      curNode.fTotalLength * this.parent.fFriction)),
            ),
          );
        } else {
          curNode.fEnergy = r(
            0.5 * vel * vel +
              F_G *
                (curNode.vPosHeart(fHeart * 0.9).y +
                  curNode.fTotalLength * this.parent.fFriction),
          );
        }
        if (vel < 1) {
          vel = 1;
          curNode.fEnergy = r(
            0.5 * vel * vel +
              F_G *
                (curNode.vPosHeart(fHeart * 0.9).y +
                  curNode.fTotalLength * this.parent.fFriction),
          );
        }
        if (Number.isNaN(vel)) {
          vel = 10;
          curNode.fEnergy = r(
            0.5 * vel * vel +
              F_G *
                (curNode.vPosHeart(fHeart * 0.9).y +
                  curNode.fTotalLength * this.parent.fFriction),
          );
        }
        curNode.fVel = vel;
        t = r(t + 1 / ((3000 * lengthDir) / vel));
        cur++;
      }
      t = r(t - 1);
      seg.length = r(
        this.lNodes[cur - 1]!.fTotalHeartLength - this.lNodes[lastcur]!.fTotalHeartLength,
      );
      seg.numNodes = cur - 1 - lastcur;
      lastcur = cur - 1;
    }

    if (!tList.length) return 0;

    // ----- pass 2: resolve fvdRoll / ptf per segment (secbezier.cpp:143) -----
    let b2 = 0;
    let correction = 0;
    bezList[0]!.fvdRoll = bezList[0]!.roll;

    for (let i = 0; i < this.lNodes.length; i++) {
      this.calcDirFromLast(i);
      if (i && tList[i]! < tList[i - 1]!) {
        b2++;
        const segB = bezList[b2]!;
        const segPrev = bezList[b2 - 1]!;
        if (segB.relRoll) {
          segB.fvdRoll = r(segPrev.fvdRoll + (correction * F_PI) / 180 + segB.roll);
          segPrev.ptf = segB.roll;
        } else {
          segB.fvdRoll = segB.roll;
          segPrev.ptf = r(segB.fvdRoll - segPrev.fvdRoll - (correction * F_PI) / 180);
          if (Math.abs(segPrev.ptf) > F_PI) {
            segPrev.ptf = r(segPrev.ptf + (segPrev.ptf > 0 ? -2 * F_PI : 2 * F_PI));
          }
        }
        correction = 0;
      }
      const node = this.lNodes[i]!;
      // correction -= dot(vDir, (0,-1,0)) * fYawFromLast
      correction = r(correction - -node.vDir.y * node.fYawFromLast);

      const fRoll = r((bezList[b2]!.fvdRoll * 180) / F_PI);
      node.setRoll(fRoll + correction);
    }

    // ----- pass 3: roll transition polynomial + columns (secbezier.cpp:177) -----
    let b3 = 0;
    let bNext = 1;
    let startVal = 0;
    let endVal = 0;
    let area = 0;
    let a1 = 0;
    let b1 = 0;
    let c1 = 0;
    let value = 0;
    for (let i = 0; i < this.lNodes.length; i++) {
      const node = this.lNodes[i]!;
      let tNext: number;
      if (i === this.lNodes.length - 1 || tList[i + 1]! < tList[i]!) {
        tNext = 1;
      } else {
        tNext = tList[i + 1]!;
      }

      if (i && tList[i]! < tList[i - 1]!) {
        b3++;
        bNext = (b3 + 1) % bezList.length;
        value = 0;
        startVal = endVal;
        if (bezList[bNext]!.contRoll) {
          endVal = r(
            (bezList[b3]!.length * bezList[b3]!.ptf +
              bezList[bNext]!.length * bezList[bNext]!.ptf) /
              (bezList[b3]!.length + bezList[bNext]!.length),
          );
        } else {
          endVal = 0;
        }
        area = bezList[b3]!.ptf;
        a1 = r(3 * startVal + 3 * endVal - 6 * area);
        b1 = r(6 * area - 4 * startVal - 2 * endVal);
        c1 = startVal;
      } else if (!i) {
        startVal = 0;
        value = 0;
        if (bezList.length > 1 && bezList[1]!.contRoll) {
          endVal = r(
            (bezList[b3]!.length * bezList[b3]!.ptf +
              bezList[bNext]!.length * bezList[bNext]!.ptf) /
              (bezList[b3]!.length + bezList[bNext]!.length),
          );
        } else {
          endVal = 0;
        }
        area = bezList[0]!.ptf;
        a1 = r(3 * startVal + 3 * endVal - 6 * area);
        b1 = r(6 * area - 4 * startVal - 2 * endVal);
        c1 = startVal;
      }
      const ti = tList[i]!;
      value = r(value + (((c1 + ti * (b1 + a1 * ti)) * 180) / F_PI) * (tNext - ti));

      node.setRoll(value);

      if (i) {
        const prev = this.lNodes[i - 1]!;
        node.fDistFromLast = r(
          vec3Distance(node.vPosHeart(fHeart), prev.vPosHeart(fHeart)),
        );
        node.fTotalLength = r(prev.fTotalLength + node.fDistFromLast);
        node.fRollSpeed = r(
          (((c1 + ti * (b1 + a1 * ti)) * F_HZ * 180) / F_PI) * (tNext - ti),
        );
        node.fHeartDistFromLast = r(vec3Distance(node.vPos, prev.vPos));
        // NOTE: matches FVD++ 0.79 — `+=` onto pass 1's running total, so
        // the final fTotalHeartLength double-counts the last delta.
        node.fTotalHeartLength = r(node.fTotalHeartLength + node.fHeartDistFromLast);
      }

      this.calcDirFromLast(i);
      const temp = Math.cos((Math.abs(node.getPitch()) * F_PI) / 180);
      const forceAngle = Math.sqrt(
        temp * temp * node.fYawFromLast * node.fYawFromLast +
          node.fPitchFromLast * node.fPitchFromLast,
      );
      node.fAngleFromLast = r(forceAngle);

      let fX: number;
      let fY: number;
      let fZ: number;
      if (Math.abs(forceAngle) < FLOAT_EPSILON) {
        fX = 0;
        fY = 1;
        fZ = 0;
      } else {
        const rollRad = (node.fRoll * F_PI) / 180;
        const cosR = Math.cos(rollRad);
        const sinR = Math.sin(rollRad);
        const normalDAngle =
          (F_PI / 180) * (-node.fPitchFromLast * cosR - temp * node.fYawFromLast * sinR);
        const lateralDAngle =
          (F_PI / 180) * (node.fPitchFromLast * sinR - temp * node.fYawFromLast * cosR);
        const latCoef = (lateralDAngle * node.fVel * F_HZ) / F_G;
        const normCoef = (normalDAngle * node.fHeartDistFromLast * F_HZ * F_HZ) / F_G;
        fX = 0 + latCoef * node.vLat.x + normCoef * node.vNorm.x;
        fY = 1 + latCoef * node.vLat.y + normCoef * node.vNorm.y;
        fZ = 0 + latCoef * node.vLat.z + normCoef * node.vNorm.z;
      }
      const normLen = Math.sqrt(
        node.vNorm.x * node.vNorm.x + node.vNorm.y * node.vNorm.y + node.vNorm.z * node.vNorm.z,
      );
      const latLen2 = Math.sqrt(
        node.vLat.x * node.vLat.x + node.vLat.y * node.vLat.y + node.vLat.z * node.vLat.z,
      );
      const dotN =
        normLen === 0
          ? 0
          : (fX * node.vNorm.x + fY * node.vNorm.y + fZ * node.vNorm.z) / normLen;
      const dotL =
        latLen2 === 0
          ? 0
          : (fX * node.vLat.x + fY * node.vLat.y + fZ * node.vLat.z) / latLen2;
      node.forceNormal = r(-dotN);
      node.forceLateral = r(-dotL);
      node.forceLong = r(-node.vDir.y);
    }

    this.length = this.lNodes.length
      ? this.lNodes[this.lNodes.length - 1]!.fTotalLength - this.lNodes[0]!.fTotalLength
      : 0;
    return node;
  }

  // secbezier.cpp:414
  getMaxArgument(): number {
    return 0;
  }

  // secbezier.cpp:419
  isLockable(_f: Func): boolean {
    return false;
  }

  // secbezier.cpp:425
  isInFunction(_index: number, _sf: Subfunc | null): boolean {
    return false;
  }

  // secbezier.cpp:281 — wire format is: "BEZ", nameLen, name, bezcount,
  // per segment (P1, Kp1, Kp2, contRoll, relRoll, roll), supcount, supList.
  // No bSpeed / fVel / equalDist on disk.
  saveSection(ws: WriteStream): void {
    ws.writeString('BEZ');
    ws.writeInt(this.sName.length);
    ws.writeString(this.sName);
    ws.writeInt(this.bezList.length);
    for (const b of this.bezList) {
      ws.writeVec3(b.P1);
      ws.writeVec3(b.Kp1);
      ws.writeVec3(b.Kp2);
      ws.writeBool(b.contRoll);
      ws.writeBool(b.relRoll);
      ws.writeFloat(b.roll);
    }
    ws.writeInt(this.supList.length);
    for (const s of this.supList) {
      ws.writeVec3(s);
    }
  }

  // secbezier.cpp:310
  loadSection(rs: ReadStream): void {
    const nlen = rs.readInt();
    this.sName = rs.readString(nlen);
    const count = rs.readInt();
    this.bezList = [];
    for (let i = 0; i < count; i++) {
      const b: BezierT = {
        P1: rs.readVec3(),
        Kp1: rs.readVec3(),
        Kp2: rs.readVec3(),
        contRoll: rs.readBool(),
        relRoll: rs.readBool(),
        roll: rs.readFloat(),
        equalDist: false,
        ptf: 0,
        fvdRoll: 0,
        length: 0,
        numNodes: 0,
        fVel: 0,
      };
      this.bezList.push(b);
    }
    const supCount = rs.readInt();
    this.supList = [];
    for (let i = 0; i < supCount; i++) {
      this.supList.push(rs.readVec3());
    }
  }

  // secbezier.cpp:335 — identical to loadSection.
  legacyLoadSection(rs: ReadStream): void {
    this.loadSection(rs);
  }
}
