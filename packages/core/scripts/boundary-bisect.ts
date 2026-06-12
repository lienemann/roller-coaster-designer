// SPDX-License-Identifier: AGPL-3.0-only
//
// Bit-level bisection of the section-boundary anchor values against the
// testtrack byte oracle. The 5 oracle byte diffs are all stitched
// subfunc startValues = fround(fPitchFromLast*1000) / fround(
// fYawFromLast*1000) of forced-section boundary nodes. FVD++'s saved
// bits are ground truth; this script recomputes the candidate values
// from the boundary node's vDir under every plausible x87 semantic
// variant of mnode.h:69-70 + section.cpp:286-287 and reports which
// variant reproduces FVD++'s bits.
//
//   npx tsx scripts/boundary-bisect.ts

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../src/fvd/fvd-file.js';
import { SecType } from '../src/fvd/section.js';

const here = dirname(fileURLToPath(import.meta.url));
const realDir = resolve(here, '../test/golden/data/fvd-real');

const f = Math.fround;
const PI64 = Math.PI;
const PI32 = Math.fround(3.141592653589793);

function bits(v: number): string {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v);
  return '0x' + b.getUint32(0).toString(16).padStart(8, '0');
}

const file = readFvd(new Uint8Array(readFileSync(resolve(realDir, 'testtrack.fvd'))));
const t = file.tracks[0]!;

console.log('sections:');
for (let i = 0; i < t.lSections.length; i++) {
  const s = t.lSections[i]!;
  console.log(
    `  [${i}] ${SecType[s.type]} "${s.sName}" nodes=${s.lNodes.length} ` +
      `normSub0Start=${s.normForce ? bits(s.normForce.funcList[0]!.startValue) : '-'} ` +
      `latSub0Start=${s.latForce ? bits(s.latForce.funcList[0]!.startValue) : '-'}`,
  );
}

// Candidate evaluators for pitch/direction of a node.
interface V {
  x: number;
  y: number;
  z: number;
}
type PitchFn = (d: V) => number;

function mkPitch(roundAtan: boolean, roundSqrt: boolean, pi: number): PitchFn {
  return (d) => {
    let h = Math.sqrt(d.x * d.x + d.z * d.z);
    if (roundSqrt) h = f(h);
    let a = Math.atan2(d.y, h);
    if (roundAtan) a = f(a);
    return (a * 180) / pi;
  };
}
function mkDir(roundAtan: boolean, pi: number): PitchFn {
  return (d) => {
    let a = Math.atan2(-d.x, -d.z);
    if (roundAtan) a = f(a);
    return (a * 180) / pi;
  };
}

// FVD++ oracle targets (from byte-oracle-map):
const TARGET_PITCH = '0x3f673f1e'; // fround(fPitchFromLast*1000) at forced sections
const TARGET_YAW = '0xbd415b6f'; // fround(fYawFromLast*1000)

for (let i = 0; i < t.lSections.length; i++) {
  const s = t.lSections[i]!;
  if (s.type !== SecType.Forced) continue;
  const cur = s.lNodes[0]!;
  // The boundary node IS the previous section's last node (cloned), and
  // its fPitchFromLast was computed by the previous section's
  // calcDirFromLast against ITS prev node. Recover that pair.
  const prevSec = t.lSections[i - 1]!;
  const last = prevSec.lNodes[prevSec.lNodes.length - 1]!;
  const beforeLast = prevSec.lNodes[prevSec.lNodes.length - 2]!;
  console.log(`\n[${i}] Forced "${s.sName}" — boundary pair from [${i - 1}] ${SecType[prevSec.type]}`);
  console.log(`  stored fPitchFromLast*1e3=${bits(f(cur.fPitchFromLast * 1000))} target=${TARGET_PITCH}`);
  console.log(`  stored fYawFromLast*1e3  =${bits(f(cur.fYawFromLast * 1000))} target=${TARGET_YAW}`);
  console.log(`  vDir cur=(${bits(last.vDir.x)},${bits(last.vDir.y)},${bits(last.vDir.z)})`);
  console.log(`  vDir prev=(${bits(beforeLast.vDir.x)},${bits(beforeLast.vDir.y)},${bits(beforeLast.vDir.z)})`);

  for (const pi of [PI64, PI32]) {
    for (const roundAtan of [true, false]) {
      for (const roundSqrt of [true, false]) {
        for (const roundEach of [true, false]) {
          const pf = mkPitch(roundAtan, roundSqrt, pi);
          const df = mkDir(roundAtan, pi);
          let dp: number;
          let dy: number;
          if (roundEach) {
            dp = f(pf(last.vDir)) - f(pf(beforeLast.vDir));
            dy = f(df(last.vDir)) - f(df(beforeLast.vDir));
          } else {
            dp = pf(last.vDir) - pf(beforeLast.vDir);
            dy = df(last.vDir) - df(beforeLast.vDir);
          }
          const p1000 = f(f(dp) * 1000);
          const y1000 = f(f(dy) * 1000);
          const tagP = bits(p1000) === TARGET_PITCH ? ' <<< PITCH MATCH' : '';
          const tagY = bits(y1000) === TARGET_YAW ? ' <<< YAW MATCH' : '';
          console.log(
            `  pi=${pi === PI32 ? '32' : '64'} rAtan=${+roundAtan} rSqrt=${+roundSqrt} rEach=${+roundEach}: ` +
              `pitch=${bits(p1000)}${tagP} yaw=${bits(y1000)}${tagY}`,
          );
        }
      }
    }
  }
}
