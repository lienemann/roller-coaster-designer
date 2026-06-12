// SPDX-License-Identifier: AGPL-3.0-only
//
// FVD file-format round-trip: read testtrack.fvd, write it back via our
// writer, read again, and check that every numeric field comes through
// unchanged. The on-disk bytes won't be 100% identical (FVD's writer
// emits some fields that we don't preserve exactly, e.g. unused smoother
// slots), but the loaded Track structure must match.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { readFvd, writeFvd } from './fvd-file.js';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = resolve(here, '../../test/golden/data/fvd-real');

describe('FVD file round-trip', () => {
  it('preserves track structure across read → write → read', () => {
    const original = new Uint8Array(readFileSync(resolve(goldenDir, 'testtrack.fvd')));
    const file = readFvd(original);

    const rewritten = writeFvd(file);
    const reread = readFvd(rewritten);

    expect(reread.tracks.length).toBe(file.tracks.length);

    for (let ti = 0; ti < file.tracks.length; ti++) {
      const a = file.tracks[ti]!;
      const b = reread.tracks[ti]!;
      expect(b.name).toBe(a.name);
      expect(b.fHeart).toBeCloseTo(a.fHeart, 6);
      expect(b.fFriction).toBeCloseTo(a.fFriction, 6);
      expect(b.fResistance).toBeCloseTo(a.fResistance, 6);
      expect(b.lSections.length).toBe(a.lSections.length);
      for (let si = 0; si < a.lSections.length; si++) {
        const sa = a.lSections[si]!;
        const sb = b.lSections[si]!;
        expect(sb.type).toBe(sa.type);
        expect(sb.bSpeed).toBe(sa.bSpeed);
        expect(sb.fVel).toBeCloseTo(sa.fVel, 6);
        if (sa.rollFunc) {
          expect(sb.rollFunc.funcList.length).toBe(sa.rollFunc.funcList.length);
        }
      }
    }
  });

  it('first write reproduces the FVD++-authored bytes except ULP drift in stitched fields', () => {
    // testtrack.fvd was saved by FVD++ 0.79 itself, so the original
    // bytes are an ORACLE for the full load→integrate→save chain: any
    // field FVD++ derives at save time (e.g. subfunc startValues
    // stitched to the integrator's node-0 roll speed) must come out of
    // our chain with the same bits. Current state: 2 bytes differ, both
    // the low mantissa byte of the SAME quantity — the forceLateral
    // anchor of the two forced sections, i.e. the curved boundary
    // node's vLat.y, ≈25 ULP after 2413 curved roll steps (see
    // docs/parity-campaign.md, "remaining oracle residual"). The
    // forceNormal anchors are bit-exact since F_G became float32.
    // Anything beyond 2 diffs / 25 ULP is a regression.
    const original = new Uint8Array(readFileSync(resolve(goldenDir, 'testtrack.fvd')));
    const pass1 = writeFvd(readFvd(original));
    expect(pass1.length).toBe(original.length);
    const diffs: number[] = [];
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== pass1[i]) diffs.push(i);
    }
    expect(diffs.length).toBeLessThanOrEqual(2);
    for (const i of diffs) {
      // Low mantissa byte only: the three preceding bytes (BE float32
      // sign/exponent/high mantissa) must agree.
      expect(original[i - 1]).toBe(pass1[i - 1]);
      expect(original[i - 2]).toBe(pass1[i - 2]);
      expect(original[i - 3]).toBe(pass1[i - 3]);
      expect(Math.abs(original[i]! - pass1[i]!)).toBeLessThanOrEqual(25);
    }
  });

  it('produces byte-identical output for the track-data portion', () => {
    // The header preamble (FVD magic + version + background filename int +
    // background filename) and the EOP footer are bytewise stable. The
    // track payload is the interesting target: we run the load + save and
    // expect the second save's bytes to equal the bytes the file format
    // produced on the first load → save cycle.
    const original = new Uint8Array(readFileSync(resolve(goldenDir, 'testtrack.fvd')));
    const file1 = readFvd(original);
    const pass1 = writeFvd(file1);
    const file2 = readFvd(pass1);
    const pass2 = writeFvd(file2);
    expect(pass2.length).toBe(pass1.length);
    let firstDiff = -1;
    for (let i = 0; i < pass1.length; i++) {
      if (pass1[i] !== pass2[i]) {
        firstDiff = i;
        break;
      }
    }
    expect(firstDiff).toBe(-1);
  });
});
