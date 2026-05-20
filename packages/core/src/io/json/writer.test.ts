// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { createEmptyProject } from '../../model/project.js';

import { stringifyWebFvdJson } from './writer.js';

describe('stringifyWebFvdJson', () => {
  it('puts format and version ahead of project at the top level', () => {
    const out = stringifyWebFvdJson(createEmptyProject());
    const formatIdx = out.indexOf('"format"');
    const versionIdx = out.indexOf('"version"');
    const projectIdx = out.indexOf('"project"');
    expect(formatIdx).toBeGreaterThanOrEqual(0);
    expect(formatIdx).toBeLessThan(versionIdx);
    expect(versionIdx).toBeLessThan(projectIdx);
  });

  it('is idempotent', () => {
    const first = stringifyWebFvdJson(createEmptyProject());
    const parsed = JSON.parse(first) as { project: ReturnType<typeof createEmptyProject> };
    const second = stringifyWebFvdJson(parsed.project);
    expect(second).toBe(first);
  });

  it('sorts nested keys alphabetically', () => {
    const out = stringifyWebFvdJson(createEmptyProject());
    const parsed = JSON.parse(out) as {
      project: { texturePath: string; tracks: unknown[]; fvdCompatibilityMode: boolean };
    };
    const projectKeys = Object.keys(parsed.project);
    expect(projectKeys).toEqual(['fvdCompatibilityMode', 'texturePath', 'tracks']);
  });

  it('throws on non-finite numbers', () => {
    const project = createEmptyProject();
    project.tracks.push({
      name: 'bad',
      style: 0,
      heart: Number.NaN,
      friction: 0,
      resistance: 0,
      sections: [],
      smoothers: [],
    });
    expect(() => stringifyWebFvdJson(project)).toThrow();
  });
});
