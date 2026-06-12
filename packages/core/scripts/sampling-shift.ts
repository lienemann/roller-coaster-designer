// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests the node-sampling-shift hypothesis: for each gold NL2 vertex,
// find the index of OUR node whose position is closest, and compare it
// with the node index our fFillPointList actually selected. A growing
// offset means FVD++ sampled different nodes (fTotalLength / length
// accumulation bias), not that our geometry diverges.
//
//   npx tsx scripts/sampling-shift.ts geo-degree-yaw.fvd

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../src/fvd/fvd-file.js';

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
const gold = parseVerts(
  readFileSync(resolve(corpusDir, fname.replace(/\.fvd$/, '.nl2elem')), 'utf8'),
);

// Build the flat node array (chronological), mirroring track.getPoint.
const nodes: { x: number; y: number; z: number }[] = [];
for (const s of t.lSections) {
  for (let i = s === t.lSections[0] ? 0 : 1; i < s.lNodes.length; i++) {
    const n = s.lNodes[i]!;
    nodes.push({ x: n.vPos.x, y: n.vPos.y, z: n.vPos.z });
  }
}
const anchor = t.lSections[0]!.lNodes[0]!;

// Gold vertices are spline control points; interior control points
// satisfy (P[k-1] + 4 P[k] + P[k+1])/6 = nodePos[k]. Reconstruct the
// implied node positions from the gold control polygon, then match.
const implied: Vec3[] = [];
for (let k = 0; k < gold.length; k++) {
  if (k === 0 || k === gold.length - 1) {
    implied.push(gold[k]!);
  } else {
    implied.push({
      x: (gold[k - 1]!.x + 4 * gold[k]!.x + gold[k + 1]!.x) / 6,
      y: (gold[k - 1]!.y + 4 * gold[k]!.y + gold[k + 1]!.y) / 6,
      z: (gold[k - 1]!.z + 4 * gold[k]!.z + gold[k + 1]!.z) / 6,
    });
  }
}

console.log(`${fname}: ${gold.length} gold vertices, ${nodes.length} our nodes`);
let prevBest = 0;
for (let k = 0; k < implied.length; k++) {
  const g = implied[k]!;
  let best = -1;
  let bestD = Infinity;
  const lo = Math.max(0, prevBest - 50);
  const hi = Math.min(nodes.length, prevBest + 800);
  for (let i = lo; i < hi; i++) {
    const dx = nodes[i]!.x - anchor.vPos.x - g.x;
    const dy = nodes[i]!.y - anchor.vPos.y - g.y;
    const dz = nodes[i]!.z - anchor.vPos.z - g.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = i;
    }
  }
  prevBest = best;
  console.log(
    `  v${String(k).padStart(3)}: bestNode=${String(best).padStart(6)} dist=${(Math.sqrt(bestD) * 1000).toFixed(2)} mm`,
  );
}
