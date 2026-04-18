// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';

import { createEmptyProject } from './project.js';

describe('Project', () => {
  it('createEmptyProject returns a project with no tracks and an empty texture path', () => {
    const p = createEmptyProject();
    expect(p.texturePath).toBe('');
    expect(p.tracks).toEqual([]);
  });
});
