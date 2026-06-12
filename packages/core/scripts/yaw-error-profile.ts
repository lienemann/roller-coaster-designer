// SPDX-License-Identifier: AGPL-3.0-only
//
// Angular localization of corpus drift: for each adjacent gold-vertex
// pair, compare the segment direction (yaw in the XZ plane, pitch) of
// gold vs ours. Prints the cumulative direction error per vertex with
// section attribution — this separates "one section injects a direction
// error" (anchoring/branch bug) from "every step drifts a little"
// (rotation primitive bias).
//
//   npx tsx scripts/yaw-error-profile.ts <file.fvd> [...]

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../src/fvd/fvd-file.js';
import { exportNL2 } from '../src/fvd/nl2-export.js';
import { DISTANCE } from '../src/fvd/section.js';

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = resolve(here, '../test/golden/data/fvd-corpus');

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function parseVerts(xml: string): Vec3[] {
  const out: Vec3[] = [];
  const re = /<vertex>\s*<x>([^<]+)<\/x>\s*<y>([^<]+)<\/y>\s*<z>([^<]+)<\/z>/g;
  for (const m of xml.matchAll(re)) {
    out.push({
      x: Number.parseFloat(m[1]!),
      y: Number.parseFloat(m[2]!),
      z: Number.parseFloat(m[3]!),
    });
  }
  return out;
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['geo-degree-yaw.fvd'];

for (const fname of targets) {
  const fvdBuf = new Uint8Array(readFileSync(resolve(corpusDir, fname)));
  const file = readFvd(fvdBuf);
  const t = file.tracks[0]!;
  const ours = parseVerts(exportNL2(t, 2.0, 0, t.lSections.length - 1));
  const gold = parseVerts(
    readFileSync(resolve(corpusDir, fname.replace(/\.fvd$/, '.nl2elem')), 'utf8'),
  );

  const ranges: { name: string; start: number; end: number }[] = [];
  for (const s of t.lSections) {
    if (s.bArgument === DISTANCE) continue;
    ranges.push({
      name: s.sName || '(unnamed)',
      start: s.lNodes[0]!.fTotalLength,
      end: s.lNodes[s.lNodes.length - 1]!.fTotalLength,
    });
  }
  const totalLen = ranges[ranges.length - 1]!.end;

  console.log(`\n=== ${fname} === (segment direction error, µrad)`);
  const N = Math.min(ours.length, gold.length);
  let prevYawErr = 0;
  for (let i = 1; i < N; i++) {
    const gd = {
      x: gold[i]!.x - gold[i - 1]!.x,
      y: gold[i]!.y - gold[i - 1]!.y,
      z: gold[i]!.z - gold[i - 1]!.z,
    };
    const od = {
      x: ours[i]!.x - ours[i - 1]!.x,
      y: ours[i]!.y - ours[i - 1]!.y,
      z: ours[i]!.z - ours[i - 1]!.z,
    };
    const gYaw = Math.atan2(-gd.x, -gd.z);
    const oYaw = Math.atan2(-od.x, -od.z);
    let yawErr = (oYaw - gYaw) * 1e6;
    if (yawErr > Math.PI * 1e6) yawErr -= 2 * Math.PI * 1e6;
    if (yawErr < -Math.PI * 1e6) yawErr += 2 * Math.PI * 1e6;
    const gPitch = Math.asin(gd.y / Math.hypot(gd.x, gd.y, gd.z));
    const oPitch = Math.asin(od.y / Math.hypot(od.x, od.y, od.z));
    const pitchErr = (oPitch - gPitch) * 1e6;
    const arc = (i / (N - 1)) * totalLen;
    const r = ranges.find((x) => arc >= x.start && arc <= x.end);
    const dYaw = yawErr - prevYawErr;
    prevYawErr = yawErr;
    console.log(
      `  v${String(i).padStart(3)} (~${arc.toFixed(1).padStart(7)} m): yawErr=${yawErr.toFixed(1).padStart(9)} (Δ${dYaw.toFixed(1).padStart(8)})  pitchErr=${pitchErr.toFixed(1).padStart(9)}  [${r ? r.name : '?'}]`,
    );
  }
}
