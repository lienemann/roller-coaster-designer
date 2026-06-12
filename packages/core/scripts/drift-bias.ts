// SPDX-License-Identifier: AGPL-3.0-only
//
// Per-vertex drift VECTOR (not magnitude) across the worst-three
// corpus files. Tells us whether the drift is a systematic bias
// (always pushes in the same direction → constant correction
// possible) or random walk (sign flips between sections → only
// integrator-level fixes help).

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../src/fvd/fvd-file.js';
import { exportNL2 } from '../src/fvd/nl2-export.js';

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

const targets = [
  'geo-degree-yaw.fvd',
  'geo-warp.fvd',
  'geo-degree-pitch.fvd',
  'geo-trig-isolation.fvd',
];

for (const fname of targets) {
  const fvdBuf = new Uint8Array(readFileSync(resolve(corpusDir, fname)));
  const t = readFvd(fvdBuf).tracks[0]!;
  const ours = parseVerts(exportNL2(t, 2.0, 0, t.lSections.length - 1));
  const gold = parseVerts(readFileSync(resolve(corpusDir, fname.replace(/\.fvd$/, '.nl2elem')), 'utf8'));

  const N = Math.min(ours.length, gold.length);
  let sumDx = 0,
    sumDy = 0,
    sumDz = 0;
  let absDx = 0,
    absDy = 0,
    absDz = 0;
  let posDxCount = 0,
    posDyCount = 0,
    posDzCount = 0;
  let endDx = 0,
    endDy = 0,
    endDz = 0;
  for (let i = 0; i < N; i++) {
    const dx = ours[i]!.x - gold[i]!.x;
    const dy = ours[i]!.y - gold[i]!.y;
    const dz = ours[i]!.z - gold[i]!.z;
    sumDx += dx;
    sumDy += dy;
    sumDz += dz;
    absDx += Math.abs(dx);
    absDy += Math.abs(dy);
    absDz += Math.abs(dz);
    if (dx > 0) posDxCount++;
    if (dy > 0) posDyCount++;
    if (dz > 0) posDzCount++;
    if (i === N - 1) {
      endDx = dx;
      endDy = dy;
      endDz = dz;
    }
  }

  console.log(`\n=== ${fname} ===`);
  console.log(`  vertices: ${N}`);
  console.log(
    `  end-of-track drift (mm): Δx=${(endDx * 1000).toFixed(2)}, Δy=${(endDy * 1000).toFixed(2)}, Δz=${(endDz * 1000).toFixed(2)}`,
  );
  console.log(
    `  mean signed drift (μm):  Δx=${((sumDx / N) * 1e6).toFixed(1)}, Δy=${((sumDy / N) * 1e6).toFixed(1)}, Δz=${((sumDz / N) * 1e6).toFixed(1)}`,
  );
  console.log(
    `  mean abs drift (μm):     Δx=${((absDx / N) * 1e6).toFixed(1)}, Δy=${((absDy / N) * 1e6).toFixed(1)}, Δz=${((absDz / N) * 1e6).toFixed(1)}`,
  );
  console.log(
    `  +sign fraction:          x=${(posDxCount / N).toFixed(2)}, y=${(posDyCount / N).toFixed(2)}, z=${(posDzCount / N).toFixed(2)}`,
  );
  console.log(
    `  signed/abs ratio:        x=${((sumDx / (absDx || 1)) * 100).toFixed(0)}%, y=${((sumDy / (absDy || 1)) * 100).toFixed(0)}%, z=${((sumDz / (absDz || 1)) * 100).toFixed(0)}%   (100% = pure systematic, 0% = pure random)`,
  );
}
