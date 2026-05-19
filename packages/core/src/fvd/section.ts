// SPDX-License-Identifier: AGPL-3.0-only
//
// Port of reference/openfvd/core/section.{h,cpp}. The base class owns the
// per-section node list, the roll function, and a shared `calcDirFromLast`
// (which references `parent.fHeart`). Concrete section types (Straight,
// Curved, Forced, Geometric, Bezier) extend it.

import { F_PI, FLOAT_EPSILON } from './constants.js';
import { Func, EFunctype } from './func.js';
import { type Vec3, vec3 } from './fvec.js';
import type { ReadStream, WriteStream } from './io-stream.js';
import { type MNode } from './mnode.js';
import type { Subfunc } from './subfunction.js';
import type { Track } from './track.js';

export enum SecType {
  Anchor = 0,
  Straight = 1,
  Curved = 2,
  Forced = 3,
  Geometric = 4,
  Bezier = 5,
  NolimitsCsv = 6,
}

// section.h:28-29
export const EULER = true;
export const QUATERNION = false;

// section.h:31-32
export const TIME = false;
export const DISTANCE = true;

export interface BezierT {
  Kp1: Vec3;
  Kp2: Vec3;
  P1: Vec3;
  roll: number;
  contRoll: boolean;
  equalDist: boolean;
  relRoll: boolean;
  ptf: number;
  fvdRoll: number;
  length: number;
  numNodes: number;
  fVel: number;
}

export abstract class Section {
  parent: Track;
  type: SecType;
  length = 0;

  lNodes: MNode[] = [];

  rollFunc!: Func;
  normForce: Func | null = null;
  latForce: Func | null = null;

  bSpeed = false;
  fVel = 10;
  bOrientation = QUATERNION;
  bArgument = TIME;

  fHLength = 0;
  fAngle = 0;
  fRadius = 0;
  fDirection = 0;
  fLeadIn = 0;
  fLeadOut = 0;

  iTime = 0;
  sName = '';

  bezList: BezierT[] = [];
  supList: Vec3[] = [];

  // section.cpp:31
  constructor(parent: Track, type: SecType, first: MNode) {
    this.parent = parent;
    this.type = type;
    this.lNodes.push(first.clone());
    if (type !== SecType.Bezier) {
      this.rollFunc = new Func(0, 10, 0, 0, this, EFunctype.FuncRoll);
    }
  }

  abstract updateSection(node?: number): number;
  abstract getMaxArgument(): number;
  abstract isLockable(f: Func): boolean;
  abstract isInFunction(index: number, sf: Subfunc | null): boolean;
  abstract saveSection(ws: WriteStream): void;
  abstract loadSection(rs: ReadStream): void;
  abstract legacyLoadSection(rs: ReadStream): void;

  // section.cpp:270 — recompute the per-step pitch/yaw/track-angle deltas
  // for node i. Mutates lNodes[i] in place.
  calcDirFromLast(i: number): void {
    if (i <= 0 || i >= this.lNodes.length) return;
    const cur = this.lNodes[i]!;
    const prev = this.lNodes[i - 1]!;
    const dx = cur.vDir.x - prev.vDir.x;
    const dy = cur.vDir.y - prev.vDir.y;
    const dz = cur.vDir.z - prev.vDir.z;
    const diffLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (diffLen <= FLOAT_EPSILON) {
      cur.fDirFromLast = 0;
      cur.fPitchFromLast = 0;
      cur.fYawFromLast = 0;
    } else {
      // section.cpp:282–289
      cur.fPitchFromLast = cur.getPitch() - prev.getPitch();
      cur.fYawFromLast = cur.getDirection() - prev.getDirection();
      cur.fDirFromLast =
        (Math.atan2(cur.fYawFromLast, cur.fPitchFromLast) * 180) / F_PI - cur.fRoll;
    }

    // section.cpp:291–296 — heart-line track angle
    const curDirHeart = cur.vDirHeart(this.parent.fHeart, vec3());
    const prevDirHeart = prev.vDirHeart(this.parent.fHeart, vec3());
    const curYsafe = Math.max(-1, Math.min(1, curDirHeart.y));
    const prevYsafe = Math.max(-1, Math.min(1, prevDirHeart.y));
    const fTrackPitchFromLast = (180 / F_PI) * (Math.asin(curYsafe) - Math.asin(prevYsafe));
    const fTrackYawFromLast =
      (180 / F_PI) *
      (Math.atan2(-curDirHeart.x, -curDirHeart.z) -
        Math.atan2(-prevDirHeart.x, -prevDirHeart.z));
    const temp = Math.cos(Math.abs(Math.asin(curYsafe)));
    cur.fTrackAngleFromLast = Math.sqrt(
      temp * temp * fTrackYawFromLast * fTrackYawFromLast +
        fTrackPitchFromLast * fTrackPitchFromLast,
    );
    if (cur.fYawFromLast > 270) cur.fYawFromLast -= 360;
    else if (cur.fYawFromLast < -270) cur.fYawFromLast += 360;
  }

  getSpeed(): number {
    return this.bSpeed ? this.lNodes[this.lNodes.length - 1]!.fVel : this.fVel;
  }
}
