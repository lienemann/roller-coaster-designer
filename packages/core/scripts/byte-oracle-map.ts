// SPDX-License-Identifier: AGPL-3.0-only
//
// Maps each differing byte of the testtrack first-write oracle to the
// structural field it belongs to. testtrack.fvd was saved by FVD++ 0.79,
// so every diff byte is a bit-level disagreement between FVD++'s
// integrator-derived save fields and ours — the closest thing we have to
// a per-node ground truth.
//
//   npx tsx scripts/byte-oracle-map.ts

/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFvd, writeFvd } from '../src/fvd/fvd-file.js';
import { ReadStream } from '../src/fvd/io-stream.js';

const here = dirname(fileURLToPath(import.meta.url));
const realDir = resolve(here, '../test/golden/data/fvd-real');

const original = new Uint8Array(readFileSync(resolve(realDir, 'testtrack.fvd')));
const pass1 = writeFvd(readFvd(original));

const diffs: number[] = [];
for (let i = 0; i < original.length; i++) {
  if (original[i] !== pass1[i]) diffs.push(i);
}
console.log(`diff offsets: ${diffs.join(', ')}`);

// Instrument readFloat to log every float read with its position and the
// call stack, then re-parse the original.
interface FloatRead {
  pos: number;
  value: number;
  stack: string;
}
const reads: FloatRead[] = [];
// eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound via .call below
const origReadFloat = ReadStream.prototype.readFloat;
ReadStream.prototype.readFloat = function (this: ReadStream): number {
  const pos = this.pos;
  const v = origReadFloat.call(this);
  const stack = (new Error().stack ?? '')
    .split('\n')
    .slice(2, 6)
    .map((l) => l.trim().replace(/^at /, '').replace(/\(.*\/src\//, '(src/'))
    .join(' < ');
  reads.push({ pos, value: v, stack });
  return v;
};
readFvd(original);
ReadStream.prototype.readFloat = origReadFloat;

function bits(v: number): string {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v);
  return b.getUint32(0).toString(16).padStart(8, '0');
}

const view = new DataView(pass1.buffer, pass1.byteOffset, pass1.byteLength);
for (const off of diffs) {
  const read = reads.find((r) => off >= r.pos && off < r.pos + 4);
  if (!read) {
    console.log(`offset ${off}: NOT a float read`);
    continue;
  }
  const ourVal = view.getFloat32(read.pos, false);
  const ulps =
    Math.abs(
      Math.round((ourVal - read.value) / (Math.abs(read.value) * 2 ** -23 || 2 ** -149)),
    );
  console.log(`\noffset ${off} (float at ${read.pos}):`);
  console.log(`  FVD++: ${read.value} (0x${bits(read.value)})`);
  console.log(`  ours : ${ourVal} (0x${bits(ourVal)})  Δ≈${ulps} ULP`);
  console.log(`  ${read.stack}`);
}
