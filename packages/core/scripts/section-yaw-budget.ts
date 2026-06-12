// SPDX-License-Identifier: AGPL-3.0-only
//
// For one corpus file: dump each section's func structure (degree,
// startValue, symArg, arg1, range) and compare the NET yaw turned per
// section in gold vs ours (sum of segment-direction deltas over the
// gold vertices spanning that section).
//
//   npx tsx scripts/section-yaw-budget.ts geo-degree-yaw.fvd

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../src/fvd/fvd-file.js';
import { exportNL2 } from '../src/fvd/nl2-export.js';
import { EDegree } from '../src/fvd/subfunction.js';

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

const fname = process.argv[2] ?? 'geo-degree-yaw.fvd';
const file = readFvd(new Uint8Array(readFileSync(resolve(corpusDir, fname))));
const t = file.tracks[0]!;
const ours = parseVerts(exportNL2(t, 2.0, 0, t.lSections.length - 1));
const gold = parseVerts(
  readFileSync(resolve(corpusDir, fname.replace(/\.fvd$/, '.nl2elem')), 'utf8'),
);

console.log(`sections of ${fname}:`);
for (const s of t.lSections) {
  console.log(`  "${s.sName}" iTime=${s.iTime} nodes=${s.lNodes.length}`);
  for (const [label, fn] of [
    ['roll', s.rollFunc],
    ['pitch', s.normForce],
    ['yaw', s.latForce],
  ] as const) {
    if (!fn) continue;
    const parts = fn.funcList
      .map(
        (sf) =>
          `${EDegree[sf.degree]}[${sf.minArgument.toFixed(3)},${sf.maxArgument.toFixed(3)}] start=${sf.startValue.toPrecision(9)} sym=${sf.symArg.toPrecision(9)} arg1=${sf.arg1}`,
      )
      .join(' | ');
    console.log(`     ${label}: ${parts}`);
  }
}

// Net yaw per section, gold vs ours, using vertex spans.
const totalLen = t.lSections[t.lSections.length - 1]!.lNodes.at(-1)!.fTotalLength;
const N = Math.min(ours.length, gold.length);
function segYaw(v: Vec3[], i: number): number {
  return Math.atan2(-(v[i]!.x - v[i - 1]!.x), -(v[i]!.z - v[i - 1]!.z));
}
console.log('\nnet yaw per section (deg):');
for (const s of t.lSections) {
  const a = s.lNodes[0]!.fTotalLength;
  const b = s.lNodes[s.lNodes.length - 1]!.fTotalLength;
  const i0 = Math.max(1, Math.ceil((a / totalLen) * (N - 1)));
  const i1 = Math.min(N - 1, Math.floor((b / totalLen) * (N - 1)));
  let g = 0;
  let o = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    let dg = segYaw(gold, i) - segYaw(gold, i - 1);
    let dol = segYaw(ours, i) - segYaw(ours, i - 1);
    if (dg > Math.PI) dg -= 2 * Math.PI;
    if (dg < -Math.PI) dg += 2 * Math.PI;
    if (dol > Math.PI) dol -= 2 * Math.PI;
    if (dol < -Math.PI) dol += 2 * Math.PI;
    g += dg;
    o += dol;
  }
  const gd = (g * 180) / Math.PI;
  const od = (o * 180) / Math.PI;
  console.log(
    `  ${s.sName.padEnd(16)} gold=${gd.toFixed(6).padStart(12)} ours=${od.toFixed(6).padStart(12)}  Δ=${((od - gd) * 1e6).toFixed(1).padStart(9)} µdeg  rel=${(g !== 0 ? (o - g) / g : 0).toExponential(2)}`,
  );
}
