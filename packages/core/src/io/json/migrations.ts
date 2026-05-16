// SPDX-License-Identifier: AGPL-3.0-only

import { SecType } from '../../model/enums.js';

// File-format version. Bumped whenever a breaking change lands in the JSON
// shape. Every older version needs a migration function below that rewrites
// its payload into the shape of (version + 1).
export const CURRENT_VERSION = 4;

// Map from the source version N to a function that converts a parsed JSON
// payload at version N into a payload at version N + 1.
export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {
  // v1 → v2: closures were a flag (`isClosure: true`) on a `BezierSection`.
  // v2 promotes them to a dedicated `ClosureSection`.
  1: (raw) => migrateV1ToV2(raw),
  // v2 → v3: CurvedSection switched from rate-per-metre to FVD++-shape
  // {fAngle, fRadius, fDirection, fLeadIn, fLeadOut}.
  2: (raw) => migrateV2ToV3(raw),
  // v3 → v4: BezierSection's `controlPoints` collapsed to a 2-segment
  // chain via `segments[]` matching FVD++'s `bezier_t` exactly. This
  // makes Bezier the single source of truth between reader, integrator,
  // and writer — no `fvdSegments` shadow representation.
  3: (raw) => migrateV3ToV4(raw),
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

function migrateV2ToV3(raw: unknown): unknown {
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
      if (section.type !== (SecType.Curved as number)) continue;
      sections[i] = oldCurvedToNew(section);
    }
  }
  return raw;
}

/** Convert {length, pitchRate, yawRate, leadIn, leadOut} to FVD++-shape
 *  {fAngle, fRadius, fDirection, fLeadIn, fLeadOut}. Combined rate magnitude
 *  becomes 1/fRadius; fDirection is atan2(pitchRate, yawRate). */
function oldCurvedToNew(section: Record<string, unknown>): Record<string, unknown> {
  const length = Number(section.length ?? 0);
  const pitchRate = Number(section.pitchRate ?? 0);
  const yawRate = Number(section.yawRate ?? 0);
  const leadIn = Number(section.leadIn ?? 0);
  const leadOut = Number(section.leadOut ?? 0);
  const combinedRate = Math.hypot(pitchRate, yawRate);
  const RAD = 180 / Math.PI;
  let fAngle = 0;
  let fRadius = 100;
  let fDirection = 90;
  if (combinedRate > 0 && length > 0) {
    fAngle = combinedRate * length * RAD;
    fRadius = 1 / combinedRate;
    // pitchRate at fDirection=0; yawRate at fDirection=90. atan2(yaw, pitch)
    // gives 0 for pure pitch, π/2 for pure yaw — matches FVD++'s convention.
    fDirection = Math.atan2(yawRate, pitchRate) * RAD;
  }
  // Old leadIn/leadOut were in metres of arc; convert to degrees via fRadius.
  const fLeadIn = fRadius > 0 ? Math.abs((leadIn / fRadius) * RAD) : 0;
  const fLeadOut = fRadius > 0 ? Math.abs((leadOut / fRadius) * RAD) : 0;
  return {
    type: SecType.Curved,
    name: typeof section.name === 'string' ? section.name : 'Curved',
    ...(typeof section.color === 'string' ? { color: section.color } : {}),
    fAngle,
    fRadius,
    fDirection,
    fLeadIn,
    fLeadOut,
    rollFunc: section.rollFunc,
  };
}

function migrateV3ToV4(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const project = raw.project;
  if (!isObject(project)) return raw;
  const tracks = project.tracks;
  if (!Array.isArray(tracks)) return raw;
  for (const track of tracks) {
    if (!isObject(track)) continue;
    const sections = track.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections as unknown[]) {
      if (!isObject(section)) continue;
      if (section.type !== (SecType.Bezier as number)) continue;
      if (Array.isArray(section.segments)) {
        // Already v4-shaped.
        delete section.controlPoints;
        continue;
      }
      const cps = section.controlPoints;
      if (!Array.isArray(cps) || cps.length !== 4) continue;
      const [p0, p1, p2, p3] = cps as unknown[];
      if (!isVec3(p0) || !isVec3(p1) || !isVec3(p2) || !isVec3(p3)) continue;
      section.segments = [
        { P1: [...p0], Kp1: [...p0], Kp2: [...p0] },
        { P1: [...p3], Kp1: [...p1], Kp2: [...p2] },
      ];
      delete section.controlPoints;
    }
  }
  return raw;
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
