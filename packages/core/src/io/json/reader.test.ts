// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { WebFvdError } from '../../errors.js';
import { SecType } from '../../model/enums.js';

import { parseWebFvdJson } from './reader.js';

const VALID_MINIMAL = JSON.stringify({
  format: 'webfvd',
  version: 2,
  project: { texturePath: '', tracks: [] },
});

describe('parseWebFvdJson — happy path', () => {
  it('accepts the minimal empty project', () => {
    const { project, fromVersion } = parseWebFvdJson(VALID_MINIMAL);
    expect(fromVersion).toBe(2);
    expect(project.tracks).toEqual([]);
  });

  it('migrates a v1 file forward (closure flag → ClosureSection)', () => {
    const v1 = JSON.stringify({
      format: 'webfvd',
      version: 1,
      project: {
        texturePath: '',
        tracks: [
          {
            name: 't',
            style: 0,
            heart: 1.1,
            friction: 0,
            resistance: 0,
            sections: [
              {
                type: 0,
                name: 'a',
                position: [0, 10, 0],
                pitch: 0,
                yaw: 0,
                roll: 0,
                speed: 12,
              },
              {
                type: 5,
                name: 'closure',
                isClosure: true,
                controlPoints: [
                  [0, 10, 0],
                  [3, 10, 0],
                  [-3, 10, 0],
                  [0, 10, 0],
                ],
                rollFunc: { kind: 0, name: 'r', locked: false, subfuncs: [] },
                smoothStart: true,
                smoothEnd: true,
              },
            ],
            smoothers: [],
          },
        ],
      },
    });
    const { project, fromVersion } = parseWebFvdJson(v1);
    expect(fromVersion).toBe(1);
    const last = project.tracks[0]!.sections[1]!;
    expect(last.type).toBe(SecType.Closure);
    if (last.type !== SecType.Closure) return;
    expect(last.entryHandleLength).toBeCloseTo(3, 5);
    expect(last.exitHandleLength).toBeCloseTo(3, 5);
  });
});

describe('parseWebFvdJson — error paths', () => {
  it('throws schema.invalid on malformed JSON', () => {
    try {
      parseWebFvdJson('{not json');
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.invalid');
    }
  });

  it('throws schema.invalid when the format marker is missing', () => {
    try {
      parseWebFvdJson(JSON.stringify({ version: 2, project: { texturePath: '', tracks: [] } }));
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.invalid');
    }
  });

  it('throws schema.invalid when the format marker is wrong', () => {
    try {
      parseWebFvdJson(
        JSON.stringify({
          format: 'not-webfvd',
          version: 2,
          project: { texturePath: '', tracks: [] },
        }),
      );
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.invalid');
      expect((err as WebFvdError).context.got).toBe('not-webfvd');
    }
  });

  it('throws schema.versionUnsupported for a future version', () => {
    try {
      parseWebFvdJson(
        JSON.stringify({ format: 'webfvd', version: 99, project: { texturePath: '', tracks: [] } }),
      );
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.versionUnsupported');
      expect((err as WebFvdError).context.got).toBe(99);
      expect((err as WebFvdError).context.expected).toBe(2);
    }
  });

  it('throws schema.invalid when the project shape is wrong', () => {
    try {
      parseWebFvdJson(
        JSON.stringify({ format: 'webfvd', version: 2, project: { texturePath: 42, tracks: [] } }),
      );
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.invalid');
      expect((err as WebFvdError).context.path).toContain('texturePath');
    }
  });
});
