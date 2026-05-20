// SPDX-License-Identifier: AGPL-3.0-only
//
// `forceLong` is the gravity component along the rider's forward axis
// (vDir). Sign convention: positive means the rider is being pushed
// forward — i.e. downhill. At rest on flat track vDir.y ≈ 0 → forceLong ≈ 0.
// On a vertical drop vDir.y ≈ -1 → forceLong ≈ +1 g.
//
// FVD++ doesn't track this column; it's a WebFVD addition used by the
// forces graph. Computed per integration step; not persisted in .fvd.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { readFvd } from './fvd-file.js';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = resolve(here, '../../test/golden/data/fvd-real');

describe('forceLong (gravity along vDir)', () => {
  it('is zero at the anchor (flat track at rest)', () => {
    const buf = new Uint8Array(readFileSync(resolve(goldenDir, 'testtrack.fvd')));
    const t = readFvd(buf).tracks[0]!;
    // First node of section 0 starts ~flat (anchor has startPitch=2°, so
    // vDir.y ≈ sin(2°) ≈ 0.035 — forceLong ≈ -0.035 g).
    const n0 = t.lSections[0]!.lNodes[0]!;
    expect(Math.abs(n0.forceLong)).toBeLessThan(0.05);
  });

  it('matches -vDir.y at every integrated node', () => {
    const buf = new Uint8Array(readFileSync(resolve(goldenDir, 'testtrack.fvd')));
    const t = readFvd(buf).tracks[0]!;
    for (const section of t.lSections) {
      for (let i = 1; i < section.lNodes.length; i++) {
        const n = section.lNodes[i]!;
        const expected = -n.vDir.y;
        expect(Math.abs(n.forceLong - expected)).toBeLessThan(1e-5);
      }
    }
  });

  it('clones preserve the new fields', () => {
    const buf = new Uint8Array(readFileSync(resolve(goldenDir, 'testtrack.fvd')));
    const t = readFvd(buf).tracks[0]!;
    const src = t.lSections[2]!.lNodes[100]!;
    src.forceLong = 0.42;
    src.smoothLong = -0.17;
    const cloned = src.clone();
    expect(cloned.forceLong).toBe(0.42);
    expect(cloned.smoothLong).toBe(-0.17);
  });
});
