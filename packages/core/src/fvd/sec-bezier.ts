// SPDX-License-Identifier: AGPL-3.0-only
//
// Stub port of reference/openfvd/core/secbezier.cpp. testtrack.fvd does not
// contain a BEZ section, so the integrator path is left as a TODO. The
// loader / saver are wired up so Track.load can still dispatch the tag if
// it appears (it will be parsed but updateSection will throw).
//
// Full port: secbezier.cpp's per-segment fvdRoll / contRoll / relRoll
// integration. Land that with the Bezier corpus tests (M-future).

import type { Func } from './func.js';
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

  updateSection(_node = 0): number {
    throw new Error('SecBezier.updateSection: not yet ported (no bezier in testtrack)');
  }

  getMaxArgument(): number {
    return this.bezList.length > 0 ? this.bezList[this.bezList.length - 1]!.ptf : 0;
  }

  isLockable(_f: Func): boolean {
    return false;
  }

  isInFunction(_index: number, _sf: Subfunc | null): boolean {
    return false;
  }

  saveSection(ws: WriteStream): void {
    ws.writeString('BEZ');
    ws.writeBool(this.bSpeed);
    ws.writeInt(this.sName.length);
    ws.writeString(this.sName);
    ws.writeFloat(this.fVel);
    ws.writeInt(this.bezList.length);
    for (const b of this.bezList) {
      ws.writeVec3(b.Kp1);
      ws.writeVec3(b.Kp2);
      ws.writeVec3(b.P1);
      ws.writeFloat(b.roll);
      ws.writeBool(b.contRoll);
      ws.writeBool(b.equalDist);
      ws.writeBool(b.relRoll);
    }
  }

  loadSection(rs: ReadStream): void {
    this.bSpeed = rs.readBool();
    const nlen = rs.readInt();
    this.sName = rs.readString(nlen);
    this.fVel = rs.readFloat();
    const count = rs.readInt();
    this.bezList = [];
    for (let i = 0; i < count; i++) {
      const b: BezierT = {
        Kp1: rs.readVec3(),
        Kp2: rs.readVec3(),
        P1: rs.readVec3(),
        roll: rs.readFloat(),
        contRoll: rs.readBool(),
        equalDist: rs.readBool(),
        relRoll: rs.readBool(),
        ptf: 0,
        fvdRoll: 0,
        length: 0,
        numNodes: 0,
        fVel: 0,
      };
      this.bezList.push(b);
    }
  }

  legacyLoadSection(rs: ReadStream): void {
    this.loadSection(rs);
  }
}

