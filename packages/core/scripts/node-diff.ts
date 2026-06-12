// SPDX-License-Identifier: AGPL-3.0-only
//
// Node-level bit diff against the parity oracle (tools/fvd-oracle).
// Runs our integrator chain on a .fvd file, parses the oracle's per-node
// dump, and reports the FIRST diverging float32 field per section — the
// campaign's "first diverging node" instrument.
//
//   cd tools/fvd-oracle && make
//   ./fvd-oracle dump path/to/file.fvd > /tmp/dump.txt
//   npx tsx scripts/node-diff.ts path/to/file.fvd /tmp/dump.txt [maxPerSection]

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';

import { readFvd } from '../src/fvd/fvd-file.js';
import type { MNode } from '../src/fvd/mnode.js';

const FIELDS = [
  'vPos.x', 'vPos.y', 'vPos.z',
  'vDir.x', 'vDir.y', 'vDir.z',
  'vLat.x', 'vLat.y', 'vLat.z',
  'vNorm.x', 'vNorm.y', 'vNorm.z',
  'fRoll', 'fVel', 'fEnergy', 'fRollSpeed',
  'fDistFromLast', 'fTotalLength', 'fHeartDistFromLast', 'fTotalHeartLength',
  'fPitchFromLast', 'fYawFromLast', 'fAngleFromLast', 'fTrackAngleFromLast',
  'forceNormal',
] as const;

function ourField(n: MNode, name: (typeof FIELDS)[number]): number {
  const [a, b] = name.split('.') as [keyof MNode, string?];
  const v = n[a];
  return b ? (v as { x: number; y: number; z: number })[b as 'x'] : (v as number);
}

function f32bits(v: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, Math.fround(v));
  return dv.getUint32(0);
}

function hex(u: number): string {
  return u.toString(16).padStart(8, '0');
}

const [fvdPath, dumpPath, maxPerSectionArg] = process.argv.slice(2);
if (!fvdPath || !dumpPath) {
  console.error('usage: node-diff.ts <file.fvd> <oracle-dump.txt> [maxPerSection]');
  process.exit(1);
}
const maxPerSection = Number(maxPerSectionArg ?? '3');

// Oracle node lines: "<sec> <node> <25 hex fields>"; func lines:
// "F <sec> <roll|norm|lat> <k> <start> <sym> <min> <max>".
interface OracleNode {
  sec: number;
  node: number;
  bits: number[];
}
const oracleNodes: OracleNode[] = [];
const oracleFuncs: { sec: number; fn: string; k: number; bits: number[] }[] = [];
for (const line of readFileSync(dumpPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const parts = line.trim().split(/\s+/);
  if (parts[0] === 'F') {
    oracleFuncs.push({
      sec: Number(parts[1]),
      fn: parts[2]!,
      k: Number(parts[3]),
      bits: parts.slice(4).map((p) => parseInt(p, 16)),
    });
  } else {
    oracleNodes.push({
      sec: Number(parts[0]!),
      node: Number(parts[1]!),
      bits: parts.slice(2).map((p) => parseInt(p, 16)),
    });
  }
}

const t = readFvd(new Uint8Array(readFileSync(fvdPath))).tracks[0]!;

let totalDiffs = 0;
const perSection = new Map<number, number>();
const shown = new Map<number, number>();
for (const on of oracleNodes) {
  const sec = t.lSections[on.sec];
  if (!sec) {
    console.log(`section ${on.sec} missing on our side`);
    break;
  }
  const ours = sec.lNodes[on.node];
  if (!ours) {
    console.log(`s${on.sec} n${on.node}: missing on our side (we have ${sec.lNodes.length})`);
    continue;
  }
  for (let f = 0; f < FIELDS.length; f++) {
    const ob = on.bits[f]!;
    const ub = f32bits(ourField(ours, FIELDS[f]!));
    if (ob !== ub) {
      totalDiffs++;
      perSection.set(on.sec, (perSection.get(on.sec) ?? 0) + 1);
      const k = shown.get(on.sec) ?? 0;
      if (k < maxPerSection) {
        shown.set(on.sec, k + 1);
        const ulp = Math.abs((ob & 0x7fffffff) - (ub & 0x7fffffff));
        console.log(
          `s${on.sec} n${String(on.node).padStart(5)} ${FIELDS[f]!.padEnd(20)} oracle=${hex(ob)} ours=${hex(ub)} Δ≈${ulp} ulp`,
        );
      }
    }
  }
}

console.log('\nper-section diff counts (of node-fields):');
for (const [s, c] of [...perSection.entries()].sort((a, b) => a[0] - b[0])) {
  const total = t.lSections[s]!.lNodes.length * FIELDS.length;
  console.log(`  s${s} (${t.lSections[s]!.sName || 'unnamed'}): ${c} / ${total}`);
}
console.log(`total: ${totalDiffs}`);

// Stitched func values (the anchor quantities).
console.log('\nfunc stitched-value diffs:');
for (const of_ of oracleFuncs) {
  const sec = t.lSections[of_.sec];
  if (!sec) continue;
  const fn = of_.fn === 'roll' ? sec.rollFunc : of_.fn === 'norm' ? sec.normForce : sec.latForce;
  const sf = fn?.funcList[of_.k];
  if (!sf) continue;
  const ours = [sf.startValue, sf.symArg, sf.minArgument, sf.maxArgument].map(f32bits);
  const names = ['startValue', 'symArg', 'minArg', 'maxArg'];
  for (let i = 0; i < 4; i++) {
    if (ours[i] !== of_.bits[i]) {
      console.log(
        `  s${of_.sec} ${of_.fn}[${of_.k}].${names[i]}: oracle=${hex(of_.bits[i]!)} ours=${hex(ours[i]!)}`,
      );
    }
  }
}
