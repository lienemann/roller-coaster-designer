// SPDX-License-Identifier: AGPL-3.0-only

// NoLimits 2 CSV exporter.
//
// NL2's "Track import from CSV" format is **tab-separated**, one row per
// node, with this header:
//
//   No.\tPosX\tPosY\tPosZ\tFrontX\tFrontY\tFrontZ\tLeftX\tLeftY\tLeftZ\tUpX\tUpY\tUpZ
//
// Conventions (matching FVD++'s reader at secnlcsv.cpp:loadTrack and
// confirmed against NL2 documentation):
//   - Position is the **heart-line** position in metres; Y up, +X forward
//     at the anchor, RHS (same as our internal model).
//   - Front = forward unit vector (= our `dir`).
//   - Left  = rider's **left** unit vector (= `-our lat`, since our lat
//     points to the rider's right).
//   - Up    = up unit vector (= our `norm`).
//   - Row 0 is the column header.
//   - Row 1 onward: integer node index in column 0 starting at 0, then
//     12 floats. NL2 accepts arbitrary decimal precision; we emit 6
//     fractional digits.
//
// Output is a plain UTF-8 string with `\n` line endings — NL2 imports both
// `\n` and `\r\n` (we use `\n` for diff-friendliness).

import { type MNodeArrays } from '../../model/mnode.js';

export interface Nl2CsvOptions {
  /**
   * Stride: emit every Nth integration node. 1 = every node (~1 ms apart
   * at 1 kHz integration; produces ~6 MB for a 1-minute track). 100 = a
   * coarser ~100 ms-apart sampling that NL2 still imports cleanly and
   * keeps the file small enough to inspect by hand. Default 100.
   */
  readonly stride?: number;
  /** Number of decimals on positions and unit vectors. Default 6. */
  readonly precision?: number;
}

/**
 * Render an integrated MNodeArrays as an NL2-compatible CSV string. The
 * arrays come from `integrateTrack`/`integrateProject` — we don't reach
 * back into the Project, so there's no chance of a stale dump.
 */
export function writeNl2Csv(arrays: MNodeArrays, options: Nl2CsvOptions = {}): string {
  const stride = Math.max(1, options.stride ?? 100);
  const precision = options.precision ?? 6;
  const n = arrays.length;

  const lines: string[] = [
    [
      'No.',
      'PosX',
      'PosY',
      'PosZ',
      'FrontX',
      'FrontY',
      'FrontZ',
      'LeftX',
      'LeftY',
      'LeftZ',
      'UpX',
      'UpY',
      'UpZ',
    ].join('\t'),
  ];

  let no = 0;
  for (let i = 0; i < n; i += stride) {
    const px = arrays.posX[i] ?? 0;
    const py = arrays.posY[i] ?? 0;
    const pz = arrays.posZ[i] ?? 0;
    const fx = arrays.dirX[i] ?? 0;
    const fy = arrays.dirY[i] ?? 0;
    const fz = arrays.dirZ[i] ?? 0;
    // NL2 Left = -our_lat (lat points to the rider's right in our model).
    const lx = -(arrays.latX[i] ?? 0);
    const ly = -(arrays.latY[i] ?? 0);
    const lz = -(arrays.latZ[i] ?? 0);
    const ux = arrays.normX[i] ?? 0;
    const uy = arrays.normY[i] ?? 0;
    const uz = arrays.normZ[i] ?? 0;
    lines.push(
      [
        String(no),
        fmt(px, precision),
        fmt(py, precision),
        fmt(pz, precision),
        fmt(fx, precision),
        fmt(fy, precision),
        fmt(fz, precision),
        fmt(lx, precision),
        fmt(ly, precision),
        fmt(lz, precision),
        fmt(ux, precision),
        fmt(uy, precision),
        fmt(uz, precision),
      ].join('\t'),
    );
    no += 1;
  }
  // Always include the last node so the export ends at the track terminus
  // even when the stride doesn't land on it.
  if ((n - 1) % stride !== 0 && n > 0) {
    const i = n - 1;
    const px = arrays.posX[i] ?? 0;
    const py = arrays.posY[i] ?? 0;
    const pz = arrays.posZ[i] ?? 0;
    const fx = arrays.dirX[i] ?? 0;
    const fy = arrays.dirY[i] ?? 0;
    const fz = arrays.dirZ[i] ?? 0;
    const lx = -(arrays.latX[i] ?? 0);
    const ly = -(arrays.latY[i] ?? 0);
    const lz = -(arrays.latZ[i] ?? 0);
    const ux = arrays.normX[i] ?? 0;
    const uy = arrays.normY[i] ?? 0;
    const uz = arrays.normZ[i] ?? 0;
    lines.push(
      [
        String(no),
        fmt(px, precision),
        fmt(py, precision),
        fmt(pz, precision),
        fmt(fx, precision),
        fmt(fy, precision),
        fmt(fz, precision),
        fmt(lx, precision),
        fmt(ly, precision),
        fmt(lz, precision),
        fmt(ux, precision),
        fmt(uy, precision),
        fmt(uz, precision),
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}

function fmt(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '0';
  return v.toFixed(precision);
}
