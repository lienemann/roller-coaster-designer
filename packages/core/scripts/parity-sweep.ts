// SPDX-License-Identifier: AGPL-3.0-only
//
// One-shot parity gate table for the FVD++ float-emulation campaign.
// Prints, for every gold-backed corpus file, the max |Δ| over all emitted
// NL2 floats, plus the testtrack byte-oracle diff count and peak vertex
// drift. Run after `pnpm build`:
//
//   node scripts/parity-sweep.js   (compiled by tsc alongside dist)
//   — or —
//   npx tsx scripts/parity-sweep.ts
//
// Usage per experiment: edit src/fvd/*, `pnpm build`, re-run, compare
// tables. Accept only Pareto improvements (no file worse).

/* eslint-disable no-console */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd, writeFvd } from '../src/fvd/fvd-file.js';
import { setFloatPrecision } from '../src/fvd/fvec.js';
import { exportNL2 } from '../src/fvd/nl2-export.js';

if (process.env.FVDX_F64 === '1') setFloatPrecision('float64');

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = resolve(here, '../test/golden/data/fvd-corpus');
const realDir = resolve(here, '../test/golden/data/fvd-real');

function extractFloats(xml: string): number[] {
  const out: number[] = [];
  const re = /<(?:x|y|z|ux|uy|uz|rx|ry|rz|coord)>([^<]+)<\/(?:x|y|z|ux|uy|uz|rx|ry|rz|coord)>/g;
  for (const m of xml.matchAll(re)) out.push(Number.parseFloat(m[1]!));
  return out;
}

function parseVerts(s: string): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  const re = /<vertex>\s*<x>([^<]+)<\/x>\s*<y>([^<]+)<\/y>\s*<z>([^<]+)<\/z>/g;
  for (const m of s.matchAll(re)) {
    out.push({
      x: Number.parseFloat(m[1]!),
      y: Number.parseFloat(m[2]!),
      z: Number.parseFloat(m[3]!),
    });
  }
  return out;
}

const rows: { name: string; maxAbs: number; at: number }[] = [];
for (const file of readdirSync(corpusDir)
  .filter((f) => f.endsWith('.fvd'))
  .sort()) {
  const goldPath = resolve(corpusDir, file.replace(/\.fvd$/, '.nl2elem'));
  if (!existsSync(goldPath)) continue;
  const t = readFvd(new Uint8Array(readFileSync(resolve(corpusDir, file)))).tracks[0]!;
  const ours = extractFloats(exportNL2(t, 2.0, 0, t.lSections.length - 1));
  const gold = extractFloats(readFileSync(goldPath, 'utf8'));
  if (ours.length !== gold.length) {
    rows.push({ name: `${file} COUNT ${ours.length}!=${gold.length}`, maxAbs: NaN, at: -1 });
    continue;
  }
  let maxAbs = 0;
  let at = -1;
  for (let i = 0; i < ours.length; i++) {
    const d = Math.abs(ours[i]! - gold[i]!);
    if (d > maxAbs) {
      maxAbs = d;
      at = i;
    }
  }
  rows.push({ name: file, maxAbs, at });
}

console.log('corpus (max |Δ| over all emitted floats, mm):');
for (const r of rows.sort((a, b) => b.maxAbs - a.maxAbs)) {
  console.log(
    `  ${r.name.padEnd(28)} ${(r.maxAbs * 1000).toFixed(3).padStart(10)} mm  @${r.at}`,
  );
}

// testtrack gates
const original = new Uint8Array(readFileSync(resolve(realDir, 'testtrack.fvd')));
const pass1 = writeFvd(readFvd(original));
let byteDiffs = 0;
for (let i = 0; i < original.length; i++) if (original[i] !== pass1[i]) byteDiffs++;

const t = readFvd(original).tracks[0]!;
const ourV = parseVerts(exportNL2(t, 2.0));
const goldV = parseVerts(readFileSync(resolve(realDir, 'testtrack.nl2elem'), 'utf8'));
let peak = 0;
const n = Math.min(ourV.length, goldV.length);
for (let i = 0; i < n; i++) {
  const d = Math.hypot(
    ourV[i]!.x - goldV[i]!.x,
    ourV[i]!.y - goldV[i]!.y,
    ourV[i]!.z - goldV[i]!.z,
  );
  if (d > peak) peak = d;
}
console.log(
  `testtrack: byteDiffs=${byteDiffs} (budget 5), peakPos=${(peak * 1000).toFixed(3)} mm (budget 2), verts ours=${ourV.length} gold=${goldV.length}`,
);
