// SPDX-License-Identifier: AGPL-3.0-only
//
// Per-vertex 3D drift profile across the worst corpus files.
// For each file, parses both gold and ours, computes |gold_i - ours_i| in
// position, and prints a per-vertex table plus which section each vertex
// falls into.
//
// Goal: distinguish "drift grows linearly through the entire track"
// (rotation primitive bias) from "drift jumps in one specific section"
// (subfunc evaluator divergence for that degree).

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd } from '../dist/fvd/fvd-file.js';
import { exportNL2 } from '../dist/fvd/nl2-export.js';
import { DISTANCE } from '../dist/fvd/section.js';

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

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// For each section, return its [startLength, endLength] in heart-line
// distance. The exporter samples at fixed 2m intervals, so a vertex at
// arc length L belongs to the section whose [start, end] contains L.
function sectionRanges(fvdBuf: Uint8Array): { name: string; start: number; end: number }[] {
  const t = readFvd(fvdBuf).tracks[0]!;
  const ranges: { name: string; start: number; end: number }[] = [];
  for (const s of t.lSections) {
    if (s.bArgument === DISTANCE) continue;
    const start = s.lNodes[0]!.fTotalLength;
    const end = s.lNodes[s.lNodes.length - 1]!.fTotalLength;
    ranges.push({ name: s.sName || `(unnamed ${s.type})`, start, end });
  }
  return ranges;
}

const targets = [
  'geo-degree-yaw.fvd',
  'geo-warp.fvd',
  'geo-degree-pitch.fvd',
  'geo-trig-isolation.fvd',
  'geo-arg1.fvd',
  'geo-kinematics.fvd',
  'geo-length-threshold.fvd',
];

for (const fname of targets) {
  const fvdPath = resolve(corpusDir, fname);
  const goldPath = resolve(corpusDir, fname.replace(/\.fvd$/, '.nl2elem'));
  const fvdBuf = new Uint8Array(readFileSync(fvdPath));
  const file = readFvd(fvdBuf);
  const t = file.tracks[0]!;
  const ours = exportNL2(t, 2.0, 0, t.lSections.length - 1);
  const gold = readFileSync(goldPath, 'utf8');

  const ourV = parseVerts(ours);
  const goldV = parseVerts(gold);
  const ranges = sectionRanges(fvdBuf);

  console.log(`\n=== ${fname} ===`);
  console.log(`  sections (heart-line arc length, m):`);
  for (const r of ranges) {
    console.log(`    [${r.start.toFixed(3)}, ${r.end.toFixed(3)}] ${r.name}`);
  }

  // Assume the exporter samples by node count of 2 m heart-line steps,
  // so the vertex's arc length ≈ vertex_index * (track_length / numVerts).
  const totalLen = ranges[ranges.length - 1]!.end;
  console.log(`  total heart-line length: ${totalLen.toFixed(3)} m`);
  console.log(`  vertices: ours=${ourV.length} gold=${goldV.length}`);

  const N = Math.min(ourV.length, goldV.length);
  // Print every 4th vertex + the worst vertex.
  let worstI = -1;
  let worstD = 0;
  const drifts = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const d = dist3(ourV[i]!, goldV[i]!);
    drifts[i] = d;
    if (d > worstD) {
      worstD = d;
      worstI = i;
    }
  }

  console.log(`  worst drift: vertex ${worstI} / ${N - 1}, |Δ| = ${(worstD * 1000).toFixed(2)} mm`);
  console.log(`  per-vertex (mm), and which section:`);
  for (let i = 0; i < N; i += Math.max(1, Math.floor(N / 16))) {
    const approxArc = (i / (N - 1)) * totalLen;
    const r = ranges.find((x) => approxArc >= x.start && approxArc <= x.end);
    const tag = r ? r.name : '?';
    console.log(
      `    v${i.toString().padStart(2)} (arc ~${approxArc.toFixed(1).padStart(7)} m): ${(drifts[i]! * 1000).toFixed(2).padStart(7)} mm   [${tag}]`,
    );
  }
}
