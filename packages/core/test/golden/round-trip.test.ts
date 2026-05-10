// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseWebFvdJson, stringifyWebFvdJson } from '../../src/io/json/index.js';
import { SecType } from '../../src/model/enums.js';

const goldenPath = fileURLToPath(new URL('./minimal-straight.webfvd.json', import.meta.url));
const goldenText = readFileSync(goldenPath, 'utf8');

describe('golden: minimal-straight.webfvd.json', () => {
  it('parses to a Project with one Anchor and one Straight', () => {
    const { project, fromVersion } = parseWebFvdJson(goldenText);
    expect(fromVersion).toBe(2);
    expect(project.tracks).toHaveLength(1);

    const track = project.tracks[0]!;
    expect(track.sections).toHaveLength(2);
    expect(track.sections[0]!.type).toBe(SecType.Anchor);
    expect(track.sections[1]!.type).toBe(SecType.Straight);
  });

  it('round-trips byte-identical through stringify → parse → stringify', () => {
    const first = parseWebFvdJson(goldenText);
    const rewritten = stringifyWebFvdJson(first.project);
    const second = parseWebFvdJson(rewritten);
    const rewrittenAgain = stringifyWebFvdJson(second.project);

    expect(rewritten).toBe(rewrittenAgain);
    expect(second.project).toEqual(first.project);
  });

  it('matches the on-disk file byte-for-byte after a single stringify', () => {
    const { project } = parseWebFvdJson(goldenText);
    const rewritten = stringifyWebFvdJson(project);
    expect(rewritten.trim()).toBe(goldenText.trim());
  });
});
