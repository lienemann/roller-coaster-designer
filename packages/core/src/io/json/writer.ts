// SPDX-License-Identifier: GPL-3.0-only

import { type Project } from '../../model/project.js';

import { CURRENT_VERSION } from './migrations.js';
import { webFvdFileV1Schema, type WebFvdFileV1 } from './schema.js';

// Key order defines the on-disk diff. Keep it stable so a round-trip produces
// byte-identical output for a byte-identical input — two-way round-trip
// without gratuitous version-control churn is a first-class property of the
// native format (spec §8.1 "human-diffable").
const TOP_LEVEL_KEYS = ['format', 'version', 'project'] as const;

export interface WriteOptions {
  /** 0 for single-line; 2 is the default (pretty, diffable). */
  indent?: number;
}

export function stringifyWebFvdJson(project: Project, options: WriteOptions = {}): string {
  const payload: WebFvdFileV1 = {
    format: 'webfvd',
    version: CURRENT_VERSION,
    project,
  };

  // Double-check the payload we're about to write parses back — a silent
  // corruption here would surface only on the next load. Fast enough to keep
  // in the hot path since recompute does not go through the writer.
  webFvdFileV1Schema.parse(payload);

  const indent = options.indent ?? 2;
  return JSON.stringify(sortKeys(payload), replacer, indent);
}

// Deterministic key order: top-level follows TOP_LEVEL_KEYS; every nested
// object's keys are alphabetical. Arrays preserve their insertion order (the
// model's order is semantically meaningful — sections run in sequence).
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    // Top-level detection: presence of `format` plus `version` plus `project`.
    const isTop = keys.includes('format') && keys.includes('version') && keys.includes('project');
    const ordered = isTop
      ? TOP_LEVEL_KEYS.filter((k) => keys.includes(k))
      : [...keys].sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of ordered) {
      out[k] = sortKeys(source[k]);
    }
    return out;
  }
  return value;
}

// JSON.stringify would already reject NaN/Infinity by emitting `null`. Catch
// that earlier with a replacer that throws so the writer fails loudly rather
// than producing an invalid file.
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Cannot serialise non-finite number (${String(value)}).`);
  }
  return value;
}
