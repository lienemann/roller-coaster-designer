// SPDX-License-Identifier: AGPL-3.0-only
//
// Recompute forceNormal/forceLateral of the testtrack curved→forced
// boundary node under x87 semantic variants of the seccurved.cpp:151-175
// force block, and report which variant reproduces FVD++'s saved bits
// (the byte-oracle targets 0x3f673f1e / 0xbd415b6f).
//
//   npx tsx scripts/force-bisect.ts

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
const PI32 = f(3.141592653589793);
const G64 = 9.80665;
const G32 = f(9.80665);

function bits(v: number): string {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v);
  return '0x' + b.getUint32(0).toString(16).padStart(8, '0');
}

const TARGET_N = '0x3f673f1e';
const TARGET_L = '0xbd415b6f';

const file = readFvd(new Uint8Array(readFileSync(resolve(realDir, 'testtrack.fvd'))));
const t = file.tracks[0]!;
const curved = t.lSections[3]!;
if (curved.type !== SecType.Curved) throw new Error('expected curved at [3]');
const n = curved.lNodes[curved.lNodes.length - 1]!;

console.log('boundary node fields:');
for (const [k, v] of Object.entries({
  fPitchFromLast: n.fPitchFromLast,
  fYawFromLast: n.fYawFromLast,
  fRoll: n.fRoll,
  fVel: n.fVel,
  fHeartDistFromLast: n.fHeartDistFromLast,
})) {
  console.log(`  ${k} = ${v} (${bits(v)})`);
}
console.log(`  vLat  = (${bits(n.vLat.x)}, ${bits(n.vLat.y)}, ${bits(n.vLat.z)})`);
console.log(`  vNorm = (${bits(n.vNorm.x)}, ${bits(n.vNorm.y)}, ${bits(n.vNorm.z)})`);
console.log(`  current forceNormal=${bits(n.forceNormal)} target=${TARGET_N}`);
console.log(`  current forceLateral=${bits(n.forceLateral)} target=${TARGET_L}`);

// getPitch of the node: atan2f rounds (real libm call), *180/F_PI ext.
function pitchExt(pi: number, roundSqrt: boolean): number {
  let h = Math.sqrt(n.vDir.x * n.vDir.x + n.vDir.z * n.vDir.z);
  if (roundSqrt) h = f(h);
  return (f(Math.atan2(n.vDir.y, h)) * 180) / pi;
}

let found = 0;
for (const pi of [PI64, PI32]) {
  for (const g of [G64, G32]) {
    for (const roundSqrt of [true, false]) {
      for (const roundForceVec of [true, false]) {
        for (const roundTemp of [true, false]) {
          // float temp = cos(fabs(getPitch())*F_PI/180.f) — double cos,
          // float local → register (no round) unless roundTemp.
          let temp = Math.cos((Math.abs(pitchExt(pi, roundSqrt)) * pi) / 180);
          if (roundTemp) temp = f(temp);
          const rollRad = (n.fRoll * pi) / 180;
          const cosR = Math.cos(rollRad);
          const sinR = Math.sin(rollRad);
          const normalDAngle =
            (pi / 180) * (-n.fPitchFromLast * cosR - temp * n.fYawFromLast * sinR);
          const lateralDAngle =
            (pi / 180) * (n.fPitchFromLast * sinR - temp * n.fYawFromLast * cosR);
          const latCoef = (lateralDAngle * n.fVel * 1000) / g;
          const normCoef = (normalDAngle * n.fHeartDistFromLast * 1000 * 1000) / g;
          let fX = 0 + latCoef * n.vLat.x + normCoef * n.vNorm.x;
          let fY = 1 + latCoef * n.vLat.y + normCoef * n.vNorm.y;
          let fZ = 0 + latCoef * n.vLat.z + normCoef * n.vNorm.z;
          if (roundForceVec) {
            fX = f(fX);
            fY = f(fY);
            fZ = f(fZ);
          }
          const normLen = Math.sqrt(
            n.vNorm.x * n.vNorm.x + n.vNorm.y * n.vNorm.y + n.vNorm.z * n.vNorm.z,
          );
          const latLen = Math.sqrt(
            n.vLat.x * n.vLat.x + n.vLat.y * n.vLat.y + n.vLat.z * n.vLat.z,
          );
          const fN = f(-((fX * n.vNorm.x + fY * n.vNorm.y + fZ * n.vNorm.z) / normLen));
          const fL = f(-((fX * n.vLat.x + fY * n.vLat.y + fZ * n.vLat.z) / latLen));
          const okN = bits(fN) === TARGET_N;
          const okL = bits(fL) === TARGET_L;
          if (okN || okL) found++;
          console.log(
            `pi=${pi === PI32 ? '32' : '64'} g=${g === G32 ? '32' : '64'} rSqrt=${+roundSqrt} rFV=${+roundForceVec} rTemp=${+roundTemp}: ` +
              `N=${bits(fN)}${okN ? ' <<<' : ''} L=${bits(fL)}${okL ? ' <<<' : ''}`,
          );
        }
      }
    }
  }
}
console.log(`matches: ${found}`);
