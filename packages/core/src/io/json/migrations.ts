// SPDX-License-Identifier: AGPL-3.0-only

import { SecType } from '../../model/enums.js';

// File-format version. Bumped whenever a breaking change lands in the JSON
// shape. Every older version needs a migration function below that rewrites
// its payload into the shape of (version + 1).
export const CURRENT_VERSION = 2;

// Map from the source version N to a function that converts a parsed JSON
// payload at version N into a payload at version N + 1.
export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {
  // v1 → v2: closures were a flag (`isClosure: true`) on a `BezierSection`.
  // v2 promotes them to a dedicated `ClosureSection` with derived control
  // points. The migration drops controlPoints / smoothStart / smoothEnd and
  // synthesises entryHandleLength / exitHandleLength from the old p0..p3.
  1: (raw) => migrateV1ToV2(raw),
};

export function applyMigrations(fromVersion: number, raw: unknown): unknown {
  let version = fromVersion;
  let current = raw;
  while (version < CURRENT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`Missing migration from version ${version} to ${version + 1}.`);
    }
    current = migrate(current);
    version += 1;
    // Bump the embedded version field so the post-migration schema check
    // sees the new shape under the new version literal. Migrators don't
    // need to remember to do this themselves.
    if (isObject(current)) {
      current.version = version;
    }
  }
  return current;
}

function migrateV1ToV2(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const project = raw.project;
  if (!isObject(project)) return raw;
  const tracks = project.tracks;
  if (!Array.isArray(tracks)) return raw;
  for (const track of tracks) {
    if (!isObject(track)) continue;
    const sections = track.sections;
    if (!Array.isArray(sections)) continue;
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i] as unknown;
      if (!isObject(section)) continue;
      if (section.type !== (SecType.Bezier as number)) continue;
      if (section.isClosure !== true) {
        // Strip a stray `isClosure: false` (or any other value): it's no
        // longer part of BezierSection.
        delete section.isClosure;
        continue;
      }
      sections[i] = bezierToClosure(section);
    }
  }
  return raw;
}

function bezierToClosure(bez: Record<string, unknown>): Record<string, unknown> {
  const cps = bez.controlPoints;
  let entryLen = 1;
  let exitLen = 1;
  if (Array.isArray(cps) && cps.length === 4) {
    const [p0, p1, p2, p3] = cps as unknown[];
    entryLen = vec3Distance(p0, p1) ?? entryLen;
    exitLen = vec3Distance(p3, p2) ?? exitLen;
  }
  return {
    type: SecType.Closure,
    name: typeof bez.name === 'string' ? bez.name : 'Closure',
    ...(typeof bez.color === 'string' ? { color: bez.color } : {}),
    entryHandleLength: entryLen,
    exitHandleLength: exitLen,
    rollFunc: bez.rollFunc,
  };
}

function vec3Distance(a: unknown, b: unknown): number | null {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length !== 3 || b.length !== 3) return null;
  const dx = Number(b[0]) - Number(a[0]);
  const dy = Number(b[1]) - Number(a[1]);
  const dz = Number(b[2]) - Number(a[2]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  return Math.hypot(dx, dy, dz);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
