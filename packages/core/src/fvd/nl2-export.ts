// SPDX-License-Identifier: AGPL-3.0-only
//
// 1:1 port of reference/openfvd/core/track.cpp::exportNL2Track (lines 796–966).
// Emits the same .nl2elem XML structure FVD++ 0.79 writes via fprintf("%e").
//
// Output format quirks faithfully preserved:
//   - Vertex / roll values use "%e" — 6 fractional digits, exponent with a
//     SIGN and exactly 3 digits ("1.234567e+001"). C printf default; JS does
//     not produce this shape, so we format manually.
//   - Indentation is tabs (\t), matching FVD's literal printf templates.
//   - Strict markers only emitted as "<strict>true</strict>" for true; the
//     false case emits no strict tag (vertex) or "<strict>false</strict>"
//     (roll).

import { r, type Vec3, vec3 } from './fvec.js';
import type { MNode } from './mnode.js';
import { type Section, SecType } from './section.js';
import type { Track } from './track.js';

// Mimic C printf("%e", v) — 6 fractional digits and a 3-digit signed exponent.
// e.g. 1.5 → "1.500000e+000", -0.001 → "-1.000000e-003", 0 → "0.000000e+000".
export function formatE(v: number): string {
  if (!Number.isFinite(v) || v === 0) {
    return '0.000000e+000';
  }
  const neg = v < 0;
  const abs = Math.abs(v);
  let exp = Math.floor(Math.log10(abs));
  let mantissa = abs / Math.pow(10, exp);
  // Correct for floating-point edge cases — log10 may give exp where
  // mantissa rounds to 10, which we then normalize.
  if (mantissa >= 10) {
    mantissa /= 10;
    exp += 1;
  } else if (mantissa < 1) {
    mantissa *= 10;
    exp -= 1;
  }
  const mantissaStr = mantissa.toFixed(6);
  // Re-handle rollover from rounding (e.g. 9.9999996 → 10.000000).
  if (mantissaStr.startsWith('10')) {
    return (neg ? '-' : '') + '1.000000e' + formatExp(exp + 1);
  }
  return (neg ? '-' : '') + mantissaStr + 'e' + formatExp(exp);
}

function formatExp(exp: number): string {
  const sign = exp < 0 ? '-' : '+';
  const abs = Math.abs(exp);
  return sign + abs.toString().padStart(3, '0');
}

// Run `section.iFillPointList(...)` then `section.fFillPointList(...)` — the
// list-building methods from section.cpp:209 (iFillPointList) and 237
// (fFillPointList). For testtrack we only need fFillPointList.
function fFillPointList(
  list: number[],
  section: Section,
  mPerNode: number,
  track: Track,
): void {
  section.lNodes[0]!.updateNorm();
  let fThreshold = 0;
  let numNodes = (section.length / mPerNode) | 0;
  if (numNodes < 2) numNodes = 2;
  // FVD's short-circuit: straight section with constant zero roll emits
  // negated bounds (section.cpp:248). We replicate.
  if (
    section.type === SecType.Straight &&
    section.rollFunc?.funcList.length === 1 &&
    section.rollFunc.funcList[0]!.symArg === 0
  ) {
    if (list.length) list[list.length - 1] = -list[list.length - 1]!;
    list.push(-(track.getNumPoints(section) + section.lNodes.length - 2));
    return;
  }
  for (let i = 1; i < section.lNodes.length; i++) {
    section.lNodes[i]!.updateNorm();
    fThreshold += section.lNodes[i]!.fDistFromLast;
    if (i === section.lNodes.length - 1 || fThreshold > section.length / numNodes) {
      list.push(track.getNumPoints(section) + i - 1);
      fThreshold -= section.length / numNodes;
    }
  }
  if (list.length > 1) {
    const lastIdx = Math.abs(list[list.length - 1]!) - track.getNumPoints(section) + 1;
    const prevIdx = Math.abs(list[list.length - 2]!) - track.getNumPoints(section) + 1;
    if (lastIdx >= 0 && lastIdx < section.lNodes.length && prevIdx >= 0 && prevIdx < section.lNodes.length) {
      const d =
        section.lNodes[lastIdx]!.fTotalLength - section.lNodes[prevIdx]!.fTotalLength;
      if (d < mPerNode / 2) list.splice(list.length - 2, 1);
    }
  }
}

export function exportNL2(
  track: Track,
  mPerNode: number,
  fromIndex = 0,
  toIndex: number = track.lSections.length - 1,
): string {
  const exportPoints: number[] = [];
  const anchor: MNode = track.lSections[fromIndex]!.lNodes[0]!;
  exportPoints.push(track.getNumPoints(track.lSections[fromIndex]));
  for (let i = fromIndex; i <= toIndex; i++) {
    fFillPointList(exportPoints, track.lSections[i]!, mPerNode, track);
  }

  const size = exportPoints.length;
  const a = new Array<number>(size).fill(0);
  const b = new Array<number>(size).fill(0);
  const c = new Array<number>(size).fill(0);
  const d: Vec3[] = new Array<Vec3>(size);
  for (let i = 0; i < size; i++) d[i] = vec3();

  for (let i = 0; i < size; i++) {
    const point = exportPoints[i]!;
    const curNode = track.getPoint(point < 0 ? -point : point);
    d[i]!.x = r(curNode.vPos.x - anchor.vPos.x);
    d[i]!.y = r(curNode.vPos.y - anchor.vPos.y);
    d[i]!.z = r(curNode.vPos.z - anchor.vPos.z);
    if (i === 0 || i === size - 1 || point < 0) {
      a[i] = 0;
      b[i] = 1;
      c[i] = 0;
    } else {
      a[i] = r(1 / 6);
      b[i] = r(4 / 6);
      c[i] = r(1 / 6);
    }
  }

  // Thomas algorithm. `m` is a float local (stays extended on x87);
  // c[] / d[] writes are QVector<float> / glm::vec3 stores → float32.
  c[0] = r(c[0]! / b[0]!);
  d[0]!.x = r(d[0]!.x / b[0]!);
  d[0]!.y = r(d[0]!.y / b[0]!);
  d[0]!.z = r(d[0]!.z / b[0]!);
  for (let i = 1; i < size; i++) {
    const m = 1 / (b[i]! - a[i]! * c[i - 1]!);
    c[i] = r(c[i]! * m);
    d[i]!.x = r(m * (d[i]!.x - a[i]! * d[i - 1]!.x));
    d[i]!.y = r(m * (d[i]!.y - a[i]! * d[i - 1]!.y));
    d[i]!.z = r(m * (d[i]!.z - a[i]! * d[i - 1]!.z));
  }
  for (let i = size - 1; i-- > 0; ) {
    d[i]!.x = r(d[i]!.x - c[i]! * d[i + 1]!.x);
    d[i]!.y = r(d[i]!.y - c[i]! * d[i + 1]!.y);
    d[i]!.z = r(d[i]!.z - c[i]! * d[i + 1]!.z);
  }

  // Resolve strictness — track.cpp:849–921.
  interface E {
    p: Vec3;
    strict: number; // 1=true, 0=false
  }
  const e: E[] = [];
  e.push({ p: d[0]!, strict: 1 });
  for (let i = 1; i < size - 1; i++) {
    let point = exportPoints[i]!;
    let ppoint = exportPoints[i - 1]!;
    let npoint = exportPoints[i + 1]!;
    let strict = 0;
    if (ppoint <= 0) {
      strict |= 1;
      ppoint *= -1;
    }
    if (point < 0) {
      strict |= 2;
      point *= -1;
    }
    if (npoint <= 0) {
      strict |= 4;
      npoint *= -1;
    }

    // strict==0: normal (loose). strict==2: "can't happen" in FVD (qDebug
     // warning, no e.append) — preserve that, otherwise we get one extra
     // vertex at every zero-roll-straight → next-section boundary.
    if (strict === 2) {
      continue;
    }
    if (strict === 0) {
      e.push({ p: d[i]!, strict: 0 });
      continue;
    }
    if (strict === 1) {
      const dir = track.getPoint(ppoint).vDir;
      const nP = track.getPoint(npoint).vPos;
      const dx0 = nP.x - d[i - 1]!.x;
      const dy0 = nP.y - d[i - 1]!.y;
      const dz0 = nP.z - d[i - 1]!.z;
      const al = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0);
      const inv = al === 0 ? 0 : 1 / al;
      const cosa = dx0 * inv * dir.x + dy0 * inv * dir.y + dz0 * inv * dir.z;
      const k = al / (2 * cosa);
      e.push({
        p: {
          x: d[i - 1]!.x + dir.x * k,
          y: d[i - 1]!.y + dir.y * k,
          z: d[i - 1]!.z + dir.z * k,
        },
        strict: 0,
      });
    } else if (strict === 3) {
      e.push({ p: d[i]!, strict: 1 });
    } else if (strict === 4) {
      const dir = track.getPoint(npoint).vDir;
      const pP = track.getPoint(ppoint).vPos;
      const dx0 = d[i + 1]!.x - pP.x;
      const dy0 = d[i + 1]!.y - pP.y;
      const dz0 = d[i + 1]!.z - pP.z;
      const al = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0);
      const inv = al === 0 ? 0 : 1 / al;
      const cosa = dx0 * inv * dir.x + dy0 * inv * dir.y + dz0 * inv * dir.z;
      const k = al / (2 * cosa);
      e.push({
        p: {
          x: d[i + 1]!.x - dir.x * k,
          y: d[i + 1]!.y - dir.y * k,
          z: d[i + 1]!.z - dir.z * k,
        },
        strict: 0,
      });
    } else if (strict === 5) {
      const npNode = track.getPoint(npoint);
      const ppNode = track.getPoint(ppoint);
      const dpX = npNode.vPos.x - ppNode.vPos.x;
      const dpY = npNode.vPos.y - ppNode.vPos.y;
      const dpZ = npNode.vPos.z - ppNode.vPos.z;
      const dvX = npNode.vDir.x + ppNode.vDir.x;
      const dvY = npNode.vDir.y + ppNode.vDir.y;
      const dvZ = npNode.vDir.z + ppNode.vDir.z;
      const aQ = dvX * dvX + dvY * dvY + dvZ * dvZ - 1;
      let bQ = (dvX * dpX + dvY * dpY + dvZ * dpZ) * 2;
      let cQ = dpX * dpX + dpY * dpY + dpZ * dpZ;
      bQ /= aQ;
      cQ /= aQ;
      const p2 = bQ / 2;
      const x0 = -p2 + Math.sqrt(p2 * p2 - cQ);
      e.push({
        p: {
          x: ppNode.vPos.x - x0 * ppNode.vDir.x,
          y: ppNode.vPos.y - x0 * ppNode.vDir.y,
          z: ppNode.vPos.z - x0 * ppNode.vDir.z,
        },
        strict: 0,
      });
      e.push({
        p: {
          x: npNode.vPos.x + x0 * npNode.vDir.x,
          y: npNode.vPos.y + x0 * npNode.vDir.y,
          z: npNode.vPos.z + x0 * npNode.vDir.z,
        },
        strict: 0,
      });
    } else if (strict === 6 || strict === 7) {
      e.push({ p: d[i]!, strict: 1 });
    }
  }
  e.push({ p: d[size - 1]!, strict: 1 });

  // Anchor base — track.cpp:924–927. This builds a 3x3 rotation that lays
  // the anchor's forward direction along +Z, treating anchor.vDir's
  // horizontal projection as the yaw.
  const temp = Math.sqrt(anchor.vDir.x * anchor.vDir.x + anchor.vDir.z * anchor.vDir.z);
  // glm::transpose(mat3(-dz/t, 0, dx/t, 0, 1, 0, -dx/t, 0, -dz/t))
  // glm stores column-major, so the literal is rows of the transpose,
  // i.e. the matrix as written. Building the transposed-then-not matrix:
  // result rows:
  //   [-dz/t,  0,    -dx/t]
  //   [ 0,     1,     0  ]
  //   [ dx/t,  0,    -dz/t]
  const m00 = -anchor.vDir.z / temp;
  const m01 = 0;
  const m02 = -anchor.vDir.x / temp;
  const m10 = 0;
  const m11 = 1;
  const m12 = 0;
  const m20 = anchor.vDir.x / temp;
  const m21 = 0;
  const m22 = -anchor.vDir.z / temp;

  function apply(v: Vec3): Vec3 {
    return {
      x: m00 * v.x + m01 * v.y + m02 * v.z,
      y: m10 * v.x + m11 * v.y + m12 * v.z,
      z: m20 * v.x + m21 * v.y + m22 * v.z,
    };
  }

  // Emit XML
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += '<root>\n';
  out += '\t<element>\n';
  out += '\t\t<description>FVD++ Export Data</description>\n';

  for (const ev of e) {
    const ex = apply(ev.p);
    out += '\t\t\t<vertex>\n';
    out += `\t\t\t\t<x>${formatE(ex.x)}</x>\n`;
    out += `\t\t\t\t<y>${formatE(ex.y)}</y>\n`;
    out += `\t\t\t\t<z>${formatE(ex.z)}</z>\n`;
    if (ev.strict > 0.5) {
      out += '\t\t\t\t<strict>true</strict>\n';
    }
    out += '\t\t\t</vertex>\n';
  }

  const startLen = track.getPoint(exportPoints[0]!).fTotalHeartLength;
  const lp = Math.abs(exportPoints[exportPoints.length - 1]!);
  const endLen = track.getPoint(lp).fTotalHeartLength;

  for (let i = 0; i < size; i++) {
    const point = exportPoints[i]!;
    const curNode = track.getPoint(point < 0 ? -point : point);
    const up = apply({ x: -curNode.vNorm.x, y: -curNode.vNorm.y, z: -curNode.vNorm.z });
    const right = apply(curNode.vLat);
    const coord = (curNode.fTotalHeartLength - startLen) / (endLen - startLen);
    out += '\t\t\t<roll>\n';
    out += `\t\t\t\t<ux>${formatE(up.x)}</ux>\n`;
    out += `\t\t\t\t<uy>${formatE(up.y)}</uy>\n`;
    out += `\t\t\t\t<uz>${formatE(up.z)}</uz>\n`;
    out += `\t\t\t\t<rx>${formatE(right.x)}</rx>\n`;
    out += `\t\t\t\t<ry>${formatE(right.y)}</ry>\n`;
    out += `\t\t\t\t<rz>${formatE(right.z)}</rz>\n`;
    out += `\t\t\t\t<coord>${formatE(coord)}</coord>\n`;
    out += '\t\t\t\t<strict>false</strict>\n';
    out += '\t\t\t</roll>\n';
  }

  out += '\t</element>\n';
  out += '</root>\n';
  return out;
}
