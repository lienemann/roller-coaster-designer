// SPDX-License-Identifier: AGPL-3.0-only
//
// Smoke test for the handcrafted demo project. The demo carries a 360°
// loop with `fDirection = 12` so the inversion path doesn't fold onto
// the entry. The integrator must run it without producing NaN positions
// (a common failure mode for ill-tuned banking or loop geometry).

import { SecType, integrateProject } from '@roller-coaster-designer/core';
import { describe, expect, it } from 'vitest';

import { createDemoProject } from './demo-project.ts';

describe('demo project', () => {
  it('has all the headline section types we want to show off', () => {
    const project = createDemoProject();
    const sections = project.tracks[0]!.sections;
    const names = sections.map((s) => s.name);
    expect(names).toContain('Drop');
    expect(names).toContain('Banked turn');
    expect(names).toContain('Loop');
    // closeTrack appended a Closure as the final section.
    expect(sections[sections.length - 1]!.type).toBe(SecType.Closure);
  });

  it('integrates without producing NaN positions', () => {
    const project = createDemoProject();
    const [first] = integrateProject(project.tracks);
    expect(first).toBeDefined();
    const { arrays } = first!;
    for (let i = 0; i < arrays.length; i++) {
      expect(Number.isFinite(arrays.posX[i]!)).toBe(true);
      expect(Number.isFinite(arrays.posY[i]!)).toBe(true);
      expect(Number.isFinite(arrays.posZ[i]!)).toBe(true);
    }
  });

  it('loop section has a non-zero fDirection so entry / exit do not overlap', () => {
    const project = createDemoProject();
    const loop = project.tracks[0]!.sections.find((s) => s.name === 'Loop');
    expect(loop).toBeDefined();
    if (loop?.type === SecType.Curved) {
      expect(loop.fDirection).not.toBe(0);
      expect(Math.abs(loop.fDirection)).toBeGreaterThan(5);
    }
  });
});
