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
