// SPDX-License-Identifier: AGPL-3.0-only

// Ambient declarations for runtime globals shared between Node and browsers
// that the standard lib targets (`ES2022`) don't pull in. Adding them here
// instead of widening `lib` to `DOM` keeps DOM-only types (`window`,
// `document`, …) out of `core`, which must stay DOM-free per CLAUDE.md
// rule 2.

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

declare class TextEncoder {
  constructor();
  encode(input?: string): Uint8Array;
}
