// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EFuncType, SecType, TrackStyle } from '../../model/enums.js';
import { createEmptyFunc } from '../../model/function.js';
import { type Project } from '../../model/project.js';
import { createLinearSubFunc } from '../../model/subfunction.js';

import { lintFvdCompatibility, sectionHasFvdCompatIssue } from './compat.js';

function projectWith(...sections: Project['tracks'][0]['sections']): Project {
  return {
    texturePath: '',
    tracks: [
      {
        name: 't',
        style: TrackStyle.Generic,
        heart: 1.1,
        friction: 0,
        resistance: 0,
        sections,
        smoothers: [],
      },
    ],
  };
}

function rollFunc(length: number) {
  const f = createEmptyFunc(EFuncType.Roll, 'Roll');
  f.subfuncs.push(createLinearSubFunc({ length, startValue: 0, endValue: 0 }));
  return f;
}

describe('lintFvdCompatibility', () => {
  it('reports nothing for a pure FVD-compatible project', () => {
    const project = projectWith(
      {
        type: SecType.Anchor,
        name: 'a',
        position: [0, 10, 0],
        pitch: 0,
        yaw: 0,
        roll: 0,
        speed: 12,
      },
      {
        type: SecType.Straight,
        name: 's',
        length: 10,
        rollFunc: rollFunc(10),
      },
    );
    expect(lintFvdCompatibility(project)).toHaveLength(0);
  });

  it('flags per-section colour as not round-trippable through FVD', () => {
    const project = projectWith(
      {
        type: SecType.Anchor,
        name: 'a',
        position: [0, 10, 0],
        pitch: 0,
        yaw: 0,
        roll: 0,
        speed: 12,
      },
      {
        type: SecType.Straight,
        name: 's',
        color: '#ff00aa',
        length: 10,
        rollFunc: rollFunc(10),
      },
    );
    const notes = lintFvdCompatibility(project);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.code).toBe('sectionColor');
    expect(notes[0]!.sectionIndex).toBe(1);
    expect(sectionHasFvdCompatIssue(notes, 0, 1)).toBe(true);
    expect(sectionHasFvdCompatIssue(notes, 0, 0)).toBe(false);
  });

  it('flags closure sections as lossy on round-trip', () => {
    const project = projectWith(
      {
        type: SecType.Anchor,
        name: 'a',
        position: [0, 10, 0],
        pitch: 0,
        yaw: 0,
        roll: 0,
        speed: 12,
      },
      {
        type: SecType.Straight,
        name: 's',
        length: 10,
        rollFunc: rollFunc(10),
      },
      {
        type: SecType.Closure,
        name: 'c',
        entryHandleLength: 3,
        exitHandleLength: 3,
        rollFunc: rollFunc(0.1),
      },
    );
    const notes = lintFvdCompatibility(project);
    expect(notes.some((n) => n.code === 'closure')).toBe(true);
  });
});
