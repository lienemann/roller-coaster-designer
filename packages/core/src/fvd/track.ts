// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/track.h and the integrator-/IO-relevant
// portions of track.cpp. Skipped: GUI hooks (treeInit, qDebug, mMesh, etc.),
// smoothing (smoothHandler, smoothList, applyRollSmooth), NoLimits CSV
// import — all out of scope for the file→integrate→NL2 path that
// testtrack.fvd exercises.

import { F_G } from './constants.js';
import { type Vec3, vec3 } from './fvec.js';
import { type ReadStream, type WriteStream } from './io-stream.js';
import { MNode } from './mnode.js';
import { SecBezier } from './sec-bezier.js';
import { SecCurved } from './sec-curved.js';
import { SecForced } from './sec-forced.js';
import { SecGeometric } from './sec-geometric.js';
import { SecStraight } from './sec-straight.js';
import { type Section, SecType } from './section.js';

export class Track {
  anchorNode: MNode;
  startPos: Vec3;
  startYaw = 0;
  startPitch = 0;
  povPos = { x: 0, y: 0 };

  fHeart = 0;
  fFriction = 0.03;
  fResistance = 2e-5;

  drawTrack = true;
  drawHeartline = 0;
  style = 0;
  isWireframe = false;

  name = '';
  // 3 × QColor — Qt's in-memory QColor is 16 bytes (spec + 5 ushorts +
  // alpha + padding). FVD writes the raw struct, so on disk it's a 48-byte
  // opaque blob. We preserve it as-is for byte-identical round-trip.
  trackColors: Uint8Array = new Uint8Array(48);

  lSections: Section[] = [];

  constructor(startPos: Vec3 = vec3(0, 0, 0), startYaw = 0, heartLine = 0) {
    // track.cpp:43 — anchor at the origin, facing -Z. Display position
    // lives in startPos/startYaw; the integrator never reads them.
    this.anchorNode = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 10, 1, 0);
    this.startPos = startPos;
    this.startYaw = startYaw;
    this.startPitch = 0;
    this.fHeart = heartLine;
    this.anchorNode.updateNorm();
    this.anchorNode.fEnergy =
      0.5 * this.anchorNode.fVel * this.anchorNode.fVel +
      F_G * this.anchorNode.fPosHearty(0.9 * heartLine);
  }

  // track.cpp:1310
  getNumPoints(until: Section | null = null): number {
    let sum = 0;
    for (const s of this.lSections) {
      if (s === until) return sum;
      sum += s.lNodes.length - 1;
    }
    return sum;
  }

  // track.cpp:1261
  getPoint(index: number): MNode {
    let i = 0;
    if (index < 0) index = 0;
    while (this.lSections.length > i && index > this.lSections[i]!.lNodes.length - 1) {
      index -= this.lSections[i]!.lNodes.length - 1;
      i++;
    }
    if (this.lSections.length === i) {
      if (this.lSections.length) {
        return this.lSections[this.lSections.length - 1]!.lNodes[
          this.lSections[this.lSections.length - 1]!.lNodes.length - 1
        ]!;
      }
      return this.anchorNode;
    }
    return this.lSections[i]!.lNodes[index]!;
  }

  // track.cpp:196 — only the path that matters for a freshly loaded file:
  // run updateSection across the whole chain, stitching each section's
  // first node from the previous section's last node.
  updateTrack(fromIndex = 0, iNode = 0): void {
    if (fromIndex < 0) fromIndex = 0;
    if (this.lSections.length <= fromIndex) return;
    this.lSections[fromIndex]!.updateSection(iNode);
    for (let i = fromIndex + 1; i < this.lSections.length; i++) {
      const prevSection = this.lSections[i - 1]!;
      const prevLast = prevSection.lNodes[prevSection.lNodes.length - 1]!;
      this.lSections[i]!.lNodes.unshift(prevLast.clone());
      this.lSections[i]!.updateSection(0);
    }
  }

  appendSection(type: SecType): Section {
    const startNode = this.lSections.length
      ? this.lSections[this.lSections.length - 1]!.lNodes[
          this.lSections[this.lSections.length - 1]!.lNodes.length - 1
        ]!
      : this.anchorNode;
    let s: Section;
    switch (type) {
      case SecType.Straight:
        s = new SecStraight(this, startNode, 10);
        break;
      case SecType.Curved:
        s = new SecCurved(this, startNode, 90, 15);
        break;
      case SecType.Forced:
        s = new SecForced(this, startNode, 1000);
        break;
      case SecType.Geometric:
        s = new SecGeometric(this, startNode, 1000);
        break;
      case SecType.Bezier:
        s = new SecBezier(this, startNode);
        break;
      default:
        throw new Error(`unsupported section type ${String(type)}`);
    }
    this.lSections.push(s);
    return s;
  }

  // ===========================================================
  // FVD file I/O — track.cpp:968 (saveTrack) and :1025 (loadTrack).
  // The wrapper "FVDvX.YZ" header is handled outside this class.
  // ===========================================================

  // Called with the cursor positioned right after the "TRC" tag.
  loadTRCBody(rs: ReadStream): void {
    const nlen = rs.readInt();
    this.name = rs.readString(nlen);

    // FVD's `readBytes` reverses byte order (exportfuncs.cpp:98); we
    // mirror by reversing here so a save() round-trips byte-identical.
    const raw = rs.readBytes(48);
    this.trackColors = new Uint8Array(48);
    for (let i = 0; i < 48; i++) this.trackColors[i] = raw[47 - i]!;

    this.startPos = rs.readVec3();
    this.anchorNode.fRoll = rs.readFloat();
    this.startPitch = rs.readFloat();
    this.startYaw = rs.readFloat();
    this.anchorNode.fVel = rs.readFloat();
    this.anchorNode.forceNormal = rs.readFloat();
    this.anchorNode.forceLateral = rs.readFloat();

    this.fHeart = rs.readFloat();
    this.fFriction = rs.readFloat();
    this.fResistance = rs.readFloat();

    this.drawTrack = rs.readBool();
    this.drawHeartline = rs.readInt();
    this.style = rs.readInt();
    this.isWireframe = rs.readBool();

    this.povPos.x = rs.readFloat();
    this.povPos.y = rs.readFloat();

    // track.cpp:1052 — recompute energy after fHeart is known.
    this.anchorNode.fEnergy =
      0.5 * this.anchorNode.fVel * this.anchorNode.fVel +
      F_G * this.anchorNode.fPosHearty(0.9 * this.fHeart);

    // track.cpp:1054 — apply the anchor's pitch + roll AFTER everything
    // else, in this order. The order matters: changePitch rotates
    // vDir/vLat first, then setRoll spins vLat around the new vDir.
    this.anchorNode.changePitch(this.startPitch, false);
    this.anchorNode.setRoll(this.anchorNode.fRoll);
    this.anchorNode.updateNorm();

    // Sections
    const numSections = rs.readInt();
    for (let i = 0; i < numSections; i++) {
      const stag = rs.readString(3);
      const s = this.dispatchAndLoad(stag, rs);
      this.lSections.push(s);
    }

    const smoothCount = rs.readInt();
    for (let i = 0; i < smoothCount; i++) {
      this.readSmoothHandler(rs);
    }

    const eot = rs.readString(3);
    if (eot !== 'EOT') throw new Error(`expected EOT at end of TRC, got "${eot}"`);

    // Build node lists.
    this.updateTrack(0, 0);
  }

  private dispatchAndLoad(tag: string, rs: ReadStream): Section {
    const startNode =
      this.lSections.length === 0
        ? this.anchorNode
        : this.lSections[this.lSections.length - 1]!.lNodes[
            this.lSections[this.lSections.length - 1]!.lNodes.length - 1
          ]!;
    let s: Section;
    switch (tag) {
      case 'STR':
        s = new SecStraight(this, startNode, 10);
        break;
      case 'CUR':
        s = new SecCurved(this, startNode, 90, 15);
        break;
      case 'FRC':
        s = new SecForced(this, startNode, 1000);
        break;
      case 'GEO':
        s = new SecGeometric(this, startNode, 1000);
        break;
      case 'BEZ':
        s = new SecBezier(this, startNode);
        break;
      case 'CSV':
        throw new Error('NolimitsCsv sections not supported in this port');
      default:
        throw new Error(`unknown section tag "${tag}"`);
    }
    s.loadSection(rs);
    return s;
  }

  // smoothhandler.cpp:178 — simple flat record:
  //   int nameLen, string name, int from, int to, int length,
  //   int iterations, bool active.
  // We preserve the bytes opaquely so a round-trip is byte-identical.
  private smoothHandlers: {
    name: string;
    from: number;
    to: number;
    length: number;
    iterations: number;
    active: boolean;
  }[] = [];

  private readSmoothHandler(rs: ReadStream): void {
    const nlen = rs.readInt();
    const name = rs.readString(nlen);
    const from = rs.readInt();
    const to = rs.readInt();
    const length = rs.readInt();
    const iterations = rs.readInt();
    const active = rs.readBool();
    this.smoothHandlers.push({ name, from, to, length, iterations, active });
  }

  private writeSmoothHandlers(ws: WriteStream): void {
    ws.writeInt(this.smoothHandlers.length);
    for (const h of this.smoothHandlers) {
      ws.writeInt(h.name.length);
      ws.writeString(h.name);
      ws.writeInt(h.from);
      ws.writeInt(h.to);
      ws.writeInt(h.length);
      ws.writeInt(h.iterations);
      ws.writeBool(h.active);
    }
  }

  saveTRC(ws: WriteStream): void {
    ws.writeString('TRC');
    ws.writeInt(this.name.length);
    ws.writeString(this.name);
    // Round-trip the reverse done in loadTRCBody so the on-disk bytes
    // match what FVD wrote.
    const tcRev = new Uint8Array(48);
    for (let i = 0; i < 48; i++) tcRev[i] = this.trackColors[47 - i]!;
    ws.writeBytes(tcRev);
    ws.writeVec3(this.startPos);
    ws.writeFloat(this.anchorNode.fRoll);
    ws.writeFloat(this.startPitch);
    ws.writeFloat(this.startYaw);
    ws.writeFloat(this.anchorNode.fVel);
    ws.writeFloat(this.anchorNode.forceNormal);
    ws.writeFloat(this.anchorNode.forceLateral);
    ws.writeFloat(this.fHeart);
    ws.writeFloat(this.fFriction);
    ws.writeFloat(this.fResistance);
    ws.writeBool(this.drawTrack);
    ws.writeInt(this.drawHeartline);
    ws.writeInt(this.style);
    ws.writeBool(this.isWireframe);
    ws.writeFloat(this.povPos.x);
    ws.writeFloat(this.povPos.y);
    ws.writeInt(this.lSections.length);
    for (const s of this.lSections) s.saveSection(ws);
    this.writeSmoothHandlers(ws);
    ws.writeString('EOT');
  }
}

