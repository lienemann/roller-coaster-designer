// SPDX-License-Identifier: AGPL-3.0-only
//
// NoLimits 2 CSV export from an integrated fvd.Track. NL2's CSV import
// wants tab-separated No./Pos/Front/Left/Up rows; Up = −vNorm (vNorm
// points to the rider's feet), Left = vLat mirrored.

import { type Track } from './track.js';

export interface Nl2CsvOptions {
  /** Node stride — 100 ≈ one row per 10 cm·s at 1000 Hz. */
  stride?: number;
  precision?: number;
}

export function writeNl2Csv(track: Track, options: Nl2CsvOptions = {}): string {
  const stride = Math.max(1, options.stride ?? 100);
  const precision = options.precision ?? 6;

  const lines: string[] = [
    ['No.', 'PosX', 'PosY', 'PosZ', 'FrontX', 'FrontY', 'FrontZ', 'LeftX', 'LeftY', 'LeftZ', 'UpX', 'UpY', 'UpZ'].join(
      '\t',
    ),
  ];
  const f = (v: number): string => v.toFixed(precision);

  let no = 0;
  let globalIdx = 0;
  for (let si = 0; si < track.lSections.length; si++) {
    const sec = track.lSections[si]!;
    // Skip each section's node 0 (it duplicates the previous last node),
    // except for the very first section.
    for (let i = si === 0 ? 0 : 1; i < sec.lNodes.length; i++, globalIdx++) {
      if (globalIdx % stride !== 0) continue;
      const n = sec.lNodes[i]!;
      lines.push(
        [
          String(no),
          f(n.vPos.x),
          f(n.vPos.y),
          f(n.vPos.z),
          f(n.vDir.x),
          f(n.vDir.y),
          f(n.vDir.z),
          f(-n.vLat.x),
          f(-n.vLat.y),
          f(-n.vLat.z),
          f(-n.vNorm.x),
          f(-n.vNorm.y),
          f(-n.vNorm.z),
        ].join('\t'),
      );
      no += 1;
    }
  }
  return lines.join('\n') + '\n';
}
