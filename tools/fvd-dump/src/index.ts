#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

// Stub. The real CLI lands at M9 alongside the binary .fvd reader. Until then
// it exists to prove the workspace wiring (TypeScript build, bin entry, deps
// on the core package).

import { CORE_VERSION } from '@roller-coaster-designer/core';

function main(argv: readonly string[]): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`fvd-dump 0.0.0 (core ${CORE_VERSION})\n`);
    return 0;
  }
  process.stderr.write(
    'fvd-dump: not yet implemented (lands at M9 with the binary .fvd reader).\n',
  );
  return 1;
}

process.exit(main(process.argv.slice(2)));
