// SPDX-License-Identifier: AGPL-3.0-only
//
// Smoke test: flip `setFloatPrecision('float64')` and re-run the
// geometric corpus + testtrack. Reports drift in both modes side by
// side. Confirms the toggle works end-to-end and gives us a baseline
// for what "precise mode" buys.

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../dist/fvd/fvd-file.js';
import { setFloatPrecision } from '../dist/fvd/fvec.js';
import { exportNL2 } from '../dist/fvd/nl2-export.js';

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

function maxDist(a: Vec3[], b: Vec3[]): number {
  let max = 0;
  const N = Math.min(a.length, b.length);
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y, a[i]!.z - b[i]!.z);
    if (d > max) max = d;
  }
  return max;
}

function runOne(fname: string, mode: 'float32' | 'float64'): Vec3[] {
  setFloatPrecision(mode);
  const buf = new Uint8Array(readFileSync(resolve(corpusDir, fname)));
  const t = readFvd(buf).tracks[0]!;
  return parseVerts(exportNL2(t, 2.0, 0, t.lSections.length - 1));
}

const files = [
  'geo-arg1.fvd',
  'geo-degree-pitch.fvd',
  'geo-degree-roll.fvd',
  'geo-degree-yaw.fvd',
  'geo-freeform-only.fvd',
  'geo-kinematics.fvd',
  'geo-length-threshold.fvd',
  'geo-multisub.fvd',
  'geo-options.fvd',
  'geo-trig-isolation.fvd',
  'geo-warp.fvd',
];

console.log('Corpus drift vs FVD gold (peak position drift, mm)');
console.log('file                          float32  float64  Δ');
console.log('-'.repeat(56));
for (const f of files) {
  const gold = parseVerts(readFileSync(resolve(corpusDir, f.replace(/\.fvd$/, '.nl2elem')), 'utf8'));
  const ours32 = runOne(f, 'float32');
  const drift32 = maxDist(ours32, gold) * 1000;
  const ours64 = runOne(f, 'float64');
  const drift64 = maxDist(ours64, gold) * 1000;
  console.log(
    `${f.padEnd(30)}${drift32.toFixed(2).padStart(7)}  ${drift64.toFixed(2).padStart(7)}  ${(drift64 - drift32).toFixed(2).padStart(7)}`,
  );
}

// Reset for any downstream callers.
setFloatPrecision('float32');
