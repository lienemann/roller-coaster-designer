// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';

import { WebFvdError } from '../../errors.js';

import { parseWebFvdJson } from './reader.js';

const VALID_MINIMAL = JSON.stringify({
  format: 'webfvd',
  version: 1,
  project: { texturePath: '', tracks: [] },
});

describe('parseWebFvdJson — happy path', () => {
  it('accepts the minimal empty project', () => {
    const { project, fromVersion } = parseWebFvdJson(VALID_MINIMAL);
    expect(fromVersion).toBe(1);
    expect(project.tracks).toEqual([]);
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
      parseWebFvdJson(JSON.stringify({ version: 1, project: { texturePath: '', tracks: [] } }));
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
          version: 1,
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
      expect((err as WebFvdError).context.expected).toBe(1);
    }
  });

  it('throws schema.invalid when the project shape is wrong', () => {
    try {
      parseWebFvdJson(
        JSON.stringify({ format: 'webfvd', version: 1, project: { texturePath: 42, tracks: [] } }),
      );
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WebFvdError);
      expect((err as WebFvdError).code).toBe('schema.invalid');
      expect((err as WebFvdError).context.path).toContain('texturePath');
    }
  });
});
