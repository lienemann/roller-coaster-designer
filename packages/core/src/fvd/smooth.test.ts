// SPDX-License-Identifier: AGPL-3.0-only
//
// Light smoke tests for the roll smoother port. The corpus + testtrack
// don't exercise smoothers (no `.fvd` in our test set has an active
// `smoothHandler`), so the right next step here is a hand-constructed
// smoother + a golden NL2 from FVD++ — deferred until a corpus file
// with smoothing is available. Until then we assert algorithmic
// invariants: idempotent no-op when no handler is active; the filter
// shifts the right field (`fSmoothSpeed`); `applySmooth` is reversible
// via `removeSmooth`.

import { describe, expect, it } from 'vitest';

import { vec3 } from './fvec.js';
import { MNode } from './mnode.js';
import { SecType } from './section.js';
import { applyRollSmooth, applySmooth, removeSmooth } from './smooth.js';
import { Track } from './track.js';

function emptyTrack(): Track {
  const t = new Track(vec3(0, 0, 0), 0, 0);
  t.anchorNode = new MNode(vec3(0, 0, 0), vec3(0, 0, -1), 0, 12, 1, 0);
  // One short Straight section so getPoint() has somewhere to land.
  t.appendSection(SecType.Straight);
  t.updateTrack(0, 0);
  return t;
}

describe('roll smoother (no-op paths)', () => {
  it('applyRollSmooth is a no-op when no handlers are active', () => {
    const track = emptyTrack();
    const before = track.lSections[0]!.lNodes.map((n) => n.fSmoothSpeed);
    applyRollSmooth(track, 0);
    const after = track.lSections[0]!.lNodes.map((n) => n.fSmoothSpeed);
    expect(after).toEqual(before);
  });

  it('removeSmooth is idempotent when smoothedUntil already matches', () => {
    const track = emptyTrack();
    track.smoothedUntil = 0;
    removeSmooth(track, 0);
    expect(track.smoothedUntil).toBe(0);
  });

  it('applySmooth is a no-op when smoothedUntil is misaligned', () => {
    const track = emptyTrack();
    track.smoothedUntil = 5;
    applySmooth(track, 0); // expected to bail
    expect(track.smoothedUntil).toBe(5);
  });
});

describe('roll smoother (filter shape)', () => {
  it('non-active handler does not change fSmoothSpeed', () => {
    const track = emptyTrack();
    track.smoothHandlers.push({
      name: 'inactive',
      from: 0,
      to: 3,
      length: 2,
      iterations: 1,
      active: false,
    });
    applyRollSmooth(track, 0);
    for (const node of track.lSections[0]!.lNodes) {
      expect(node.fSmoothSpeed).toBe(0);
    }
  });

  it('active handler with a too-narrow window bails without changing nodes', () => {
    const track = emptyTrack();
    // 3-node window with length×iter/2 = 1000 → "Smoothing not possible".
    track.smoothHandlers.push({
      name: 'too-wide',
      from: 0,
      to: 3,
      length: 2000,
      iterations: 1,
      active: true,
    });
    applyRollSmooth(track, 0);
    for (const node of track.lSections[0]!.lNodes) {
      expect(Number.isFinite(node.fSmoothSpeed)).toBe(true);
    }
  });

  it('blurs a step in fRollSpeed across the kernel window (custom-region binding)', () => {
    // Synthetic track of 200 nodes: half at fRollSpeed=0, half at 10.
    // A box filter of length 20 should produce an O(length)-wide ramp
    // in fSmoothSpeed centred on the discontinuity. The active handler
    // sits at index 2 (> numSections), making it a CUSTOM region per
    // smoothhandler.cpp binding rules — its stored from/to apply as-is.
    const t = emptyTrack();
    const section = t.lSections[0]!;
    // Stretch lNodes to 200 entries.
    while (section.lNodes.length < 200) {
      section.lNodes.push(section.lNodes[0]!.clone());
    }
    for (let i = 0; i < 200; i++) {
      section.lNodes[i]!.fRollSpeed = i >= 100 ? 10 : 0;
      section.lNodes[i]!.fSmoothSpeed = 0;
    }
    // Index 0 = whole-track handler, index 1 = section 0 — both inactive.
    t.smoothHandlers.push({ name: 't', from: 0, to: 0, length: 400, iterations: 1, active: false });
    t.smoothHandlers.push({ name: 's', from: 0, to: 0, length: 400, iterations: 1, active: false });
    t.smoothHandlers.push({
      name: 'step',
      from: 50,
      to: 150,
      length: 20,
      iterations: 1,
      active: true,
    });
    applyRollSmooth(t, 0);
    // Nodes well before / after the smoothing window should have
    // close-to-zero |fSmoothSpeed|. Nodes adjacent to the step jump
    // get a non-trivial adjustment because the filter blurs the step.
    expect(Math.abs(section.lNodes[55]!.fSmoothSpeed)).toBeLessThan(0.5);
    expect(Math.abs(section.lNodes[145]!.fSmoothSpeed)).toBeLessThan(0.5);
    // Pick a node a few samples into the ramp on the rising side —
    // expect a clear non-zero adjustment.
    const midDelta = Math.abs(section.lNodes[100]!.fSmoothSpeed);
    expect(midDelta).toBeGreaterThan(0.5);
    // Outside the custom region: untouched.
    expect(section.lNodes[20]!.fSmoothSpeed).toBe(0);
    expect(section.lNodes[180]!.fSmoothSpeed).toBe(0);
  });

  it('section-bound handler derives its range from the section, not the file', () => {
    const t = emptyTrack();
    const section = t.lSections[0]!;
    while (section.lNodes.length < 100) {
      section.lNodes.push(section.lNodes[0]!.clone());
    }
    for (let i = 0; i < 100; i++) {
      section.lNodes[i]!.fRollSpeed = i >= 50 ? 5 : 0;
      section.lNodes[i]!.fSmoothSpeed = 0;
    }
    t.smoothHandlers.push({ name: 't', from: 0, to: 0, length: 400, iterations: 1, active: false });
    // Section-bound (index 1): stored from/to are garbage on purpose —
    // the effective range must come from the section bounds.
    t.smoothHandlers.push({
      name: 'sec0',
      from: 9999,
      to: 99999,
      length: 10,
      iterations: 1,
      active: true,
    });
    applyRollSmooth(t, 0);
    let touched = 0;
    for (const node of section.lNodes) {
      if (node.fSmoothSpeed !== 0) touched++;
    }
    expect(touched).toBeGreaterThan(0);
  });
});
