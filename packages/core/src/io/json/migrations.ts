// SPDX-License-Identifier: AGPL-3.0-only

// File-format version. Bumped whenever a breaking change lands in the JSON
// shape. Every older version needs a migration function below that rewrites
// its payload into the shape of (version + 1).
export const CURRENT_VERSION = 1;

// Map from the source version N to a function that converts a parsed JSON
// payload at version N into a payload at version N + 1. v1 is current, so
// the map is empty today; the indirection is here so M-future migrations
// drop in without restructuring the reader.
export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {};

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
  }
  return current;
}
