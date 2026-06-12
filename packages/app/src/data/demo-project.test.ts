// SPDX-License-Identifier: AGPL-3.0-only
//
// Demo-project smoke: the doc builds through the REAL integrator chain
// (buildProject -> fvd.Track.updateTrack) without NaNs, carries the
// headline sections, and the loop keeps its non-zero fDirection so the
// inversion's exit clears its entry.

import { buildProject } from '@roller-coaster-designer/core';
import { describe, expect, it } from 'vitest';

import { createDemoProject } from './demo-project.ts';

describe('demo project', () => {
  it('has the headline sections and ends with a closure', () => {
    const project = createDemoProject();
    const sections = project.tracks[0]!.sections;
    expect(sections.map((s) => s.name)).toContain('Banked turn');
    expect(sections.map((s) => s.name)).toContain('Loop');
    expect(sections[sections.length - 1]!.kind).toBe('closure');
  });

  it('integrates through the fvd chain without NaN positions', () => {
    const [track] = buildProject(createDemoProject());
    expect(track).toBeDefined();
    let nodes = 0;
    for (const sec of track!.lSections) {
      for (const n of sec.lNodes) {
        expect(Number.isFinite(n.vPos.x)).toBe(true);
        expect(Number.isFinite(n.vPos.y)).toBe(true);
        expect(Number.isFinite(n.vPos.z)).toBe(true);
        nodes++;
      }
    }
    expect(nodes).toBeGreaterThan(1000);
  });

  it('loop fDirection is non-zero so entry/exit do not overlap', () => {
    const loop = createDemoProject().tracks[0]!.sections.find((s) => s.name === 'Loop');
    expect(loop?.kind).toBe('curved');
    if (loop?.kind === 'curved') {
      expect(Math.abs(loop.fDirection)).toBeGreaterThan(5);
    }
  });
});
