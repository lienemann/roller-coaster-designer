// SPDX-License-Identifier: AGPL-3.0-only

import { z } from 'zod';

import { WebFvdError } from '../../errors.js';
import { type Project } from '../../model/project.js';

import { CURRENT_VERSION, applyMigrations } from './migrations.js';
import { webFvdFileV1Schema } from './schema.js';

// Lightweight probe to pull the format/version fields before running the full
// schema. Lets us emit a clean versionUnsupported error before wading into
// shape validation.
const versionProbeSchema = z.object({
  format: z.string(),
  version: z.number().int(),
});

export interface ReadResult {
  readonly project: Project;
  readonly fromVersion: number;
}

export function parseWebFvdJson(text: string): ReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new WebFvdError(
      'schema.invalid',
      { reason: err instanceof Error ? err.message : String(err) },
      'Malformed JSON.',
    );
  }

  const probe = versionProbeSchema.safeParse(parsed);
  if (!probe.success) {
    throw new WebFvdError(
      'schema.invalid',
      { path: '$', reason: 'missing format or version' },
      'File is not a webfvd project (missing format/version).',
    );
  }

  if (probe.data.format !== 'webfvd') {
    throw new WebFvdError(
      'schema.invalid',
      { path: 'format', got: probe.data.format },
      `Unknown format: ${probe.data.format}.`,
    );
  }

  const fromVersion = probe.data.version;
  if (fromVersion < 1 || fromVersion > CURRENT_VERSION) {
    throw new WebFvdError(
      'schema.versionUnsupported',
      { got: fromVersion, expected: CURRENT_VERSION },
      `Unsupported version ${fromVersion} (expected <= ${CURRENT_VERSION}).`,
    );
  }

  const migrated = applyMigrations(fromVersion, parsed);
  const validated = webFvdFileV1Schema.safeParse(migrated);
  if (!validated.success) {
    const first = validated.error.issues[0];
    const joined = first?.path.join('.');
    const path = joined && joined.length > 0 ? joined : '$';
    const reason = first?.message ?? 'validation failed';
    throw new WebFvdError('schema.invalid', { path, reason }, `Invalid at ${path}: ${reason}.`);
  }

  return { project: validated.data.project, fromVersion };
}
