#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

// fvd-dump — read a legacy `.fvd` file and emit either:
//   - a JSON dump of the parsed Project (default), or
//   - a CSV per-node integration trace (--csv) suitable for diffing
//     against an FVD++ reference dump.
//
// Usage:
//   fvd-dump path/to/track.fvd                     # JSON of the parsed Project
//   fvd-dump path/to/track.fvd --csv               # CSV of the integrated nodes
//   fvd-dump path/to/track.fvd --csv --track 0     # specific track index
//   fvd-dump --version
//
// Exit codes:
//   0 — success
//   1 — argument error / file not found
//   2 — parse error (malformed .fvd or unsupported version)

import { readFileSync } from 'node:fs';

import {
  CORE_VERSION,
  F_HZ,
  readFvd,
  trackToDoc,
  type Track,
} from '@roller-coaster-designer/core';

interface CliOptions {
  readonly path: string | null;
  readonly mode: 'json' | 'csv';
  readonly trackIndex: number;
  readonly help: boolean;
  readonly version: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const out: {
    path: string | null;
    mode: 'json' | 'csv';
    trackIndex: number;
    help: boolean;
    version: boolean;
  } = {
    path: null,
    mode: 'json',
    trackIndex: 0,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--version' || arg === '-v') out.version = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--csv') out.mode = 'csv';
    else if (arg === '--json') out.mode = 'json';
    else if (arg === '--track') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--track requires a numeric argument');
      out.trackIndex = Number.parseInt(next, 10);
      if (!Number.isFinite(out.trackIndex)) throw new Error('--track requires a number');
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      if (out.path !== null) throw new Error('Only one input file may be given');
      out.path = arg;
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      'fvd-dump — parse legacy .fvd binary files (FVD++ 0.77 / 0.79).',
      '',
      'Usage:',
      '  fvd-dump <file.fvd>                      Print the parsed project as JSON',
      '  fvd-dump <file.fvd> --csv                Integrate and print a per-node CSV trace',
      '  fvd-dump <file.fvd> --csv --track <i>    CSV for track index i (default 0)',
      '  fvd-dump --version                       Print version and exit',
      '  fvd-dump --help                          Show this help',
      '',
      'CSV columns:',
      '  node, t_s, posX, posY, posZ, dirX, dirY, dirZ, latX, latY, latZ,',
      '  vel_mps, forceN_g, forceL_g, forceLong_g, roll_rad, rollSpeed_radps',
      '',
    ].join('\n'),
  );
}

function main(argv: readonly string[]): number {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`fvd-dump: ${(err as Error).message}\n`);
    return 1;
  }

  if (opts.version) {
    process.stdout.write(`fvd-dump 0.0.0 (core ${CORE_VERSION})\n`);
    return 0;
  }
  if (opts.help || opts.path === null) {
    printHelp();
    return opts.help ? 0 : 1;
  }

  let bytes: Uint8Array;
  try {
    const buffer = readFileSync(opts.path);
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (err) {
    process.stderr.write(`fvd-dump: cannot read ${opts.path}: ${(err as Error).message}\n`);
    return 1;
  }

  let file;
  try {
    file = readFvd(bytes);
  } catch (err) {
    process.stderr.write(`fvd-dump: ${(err as Error).message}\n`);
    return 2;
  }

  if (opts.mode === 'json') {
    const docs = file.tracks.map(trackToDoc);
    process.stdout.write(
      `${JSON.stringify({ version: file.version, tracks: docs }, null, 2)}\n`,
    );
    return 0;
  }

  // CSV: stream the integrated nodes (readFvd already ran updateTrack).
  const tracks = file.tracks;
  if (tracks.length === 0) {
    process.stderr.write('fvd-dump: file contains no tracks\n');
    return 2;
  }
  if (opts.trackIndex < 0 || opts.trackIndex >= tracks.length) {
    process.stderr.write(
      `fvd-dump: --track ${opts.trackIndex} out of range (have ${tracks.length} tracks)\n`,
    );
    return 1;
  }
  emitCsv(tracks[opts.trackIndex]!);
  return 0;
}

function emitCsv(track: Track): void {
  const rows: string[] = [
    'node,t_s,posX,posY,posZ,dirX,dirY,dirZ,latX,latY,latZ,vel_mps,forceN_g,forceL_g,forceLong_g,roll_deg,rollSpeed_degps',
  ];
  let i = 0;
  for (let si = 0; si < track.lSections.length; si += 1) {
    const sec = track.lSections[si]!;
    for (let j = si === 0 ? 0 : 1; j < sec.lNodes.length; j += 1, i += 1) {
      const n = sec.lNodes[j]!;
      rows.push(
        [
          i,
          i / F_HZ,
          n.vPos.x,
          n.vPos.y,
          n.vPos.z,
          n.vDir.x,
          n.vDir.y,
          n.vDir.z,
          n.vLat.x,
          n.vLat.y,
          n.vLat.z,
          n.fVel,
          n.forceNormal,
          n.forceLateral,
          n.forceLong,
          n.fRoll,
          n.fRollSpeed + n.fSmoothSpeed,
        ].join(','),
      );
    }
  }
  process.stdout.write(`${rows.join('\n')}\n`);
}

process.exit(main(process.argv.slice(2)));
