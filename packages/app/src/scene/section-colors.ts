// SPDX-License-Identifier: AGPL-3.0-only

// Default palette for section indicators (rails + graph boundary markers).
// Shared between the viewport and the graph so section 3 looks like section
// 3 in both places. Hand-picked dark-background-friendly hues.
const PALETTE = [
  '#5cc8ff',
  '#ff9f5c',
  '#9ef1b9',
  '#f58ad3',
  '#ffd24f',
  '#b98af5',
  '#7be0e0',
  '#ff6b6b',
];

/**
 * Deterministic colour for a given section index. Loops through the palette
 * once the section count exceeds PALETTE.length; the user can always
 * override per section via Properties → Color.
 */
export function sectionColor(index: number): string {
  if (index < 0) return PALETTE[0]!;
  return PALETTE[index % PALETTE.length]!;
}

/**
 * Parses a `#rrggbb` colour to a Three.js-friendly 0xRRGGBB integer. Returns
 * `fallback` if the input doesn't match.
 */
export function colorHexToInt(hex: string, fallback = 0x5cc8ff): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return fallback;
  return parseInt(match[1]!, 16);
}
