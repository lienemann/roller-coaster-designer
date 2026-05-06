// SPDX-License-Identifier: AGPL-3.0-only

// Bounds-checked byte cursor for the legacy FVD++ `.fvd` format.
//
// Two oddities of the on-disk encoding live here (see docs/fvd-binary-format.md
// for the full reasoning):
//
// 1. **Big-endian primitives.** FVD++ runs `writeBytes(ptr, sizeof(T))` which
//    reverses the buffer byte-by-byte before writing. On a little-endian host
//    a 4-byte primitive comes out as the big-endian byte order. We use
//    DataView's BE getters directly.
//
// 2. **Whole-blob-reversed vec3 / colour fields.** A handful of call sites
//    pass `sizeof(glm::vec3)` (12) or `3*sizeof(QColor)` (48) to writeBytes,
//    reversing the entire blob as one unit. For a vec3 stored as `x, y, z`
//    in memory this puts `z, y, x` on disk, with each component still
//    big-endian inside its 4-byte slot. The matching readers rely on
//    compiler argument-evaluation order in C++ — we make the swap explicit
//    via `readReversedVec3()` so behaviour does not depend on JS evaluation
//    order, which `readVec3()` does.
//
// Bounds-check every read. A garbage `nameLen` in the file otherwise triggers
// gigabyte allocations (see spec doc §11 bug #8).

import { WebFvdError } from '../../errors.js';

const ASCII_DECODER = new TextDecoder('ascii');
const UTF8_DECODER = new TextDecoder('utf-8');

export class FvdCursor {
  private offset = 0;
  private readonly view: DataView;

  constructor(public readonly buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buffer.byteLength - this.offset;
  }

  get atEnd(): boolean {
    return this.offset >= this.buffer.byteLength;
  }

  /** Skip `n` bytes forward. Used for `readNulls` regions where FVD++ writes
   *  zeros that the reader is documented to ignore (§11 bug #7). */
  skip(n: number): void {
    this.requireRemaining(n, 'skip');
    this.offset += n;
  }

  /** 1-byte unsigned. */
  readU8(): number {
    this.requireRemaining(1, 'u8');
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  /** FVD++ `readBool`: one byte, non-zero is true. */
  readBool(): boolean {
    return this.readU8() !== 0;
  }

  /** 4-byte signed int, **big-endian on disk**. */
  readI32(): number {
    this.requireRemaining(4, 'i32');
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  /** 4-byte float, **big-endian on disk**. */
  readF32(): number {
    this.requireRemaining(4, 'f32');
    const v = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return v;
  }

  /** Read three back-to-back big-endian f32s in `x, y, z` order.
   *  Matches the FVD++ call sites that write each component separately
   *  (secnlcsv, section.cpp NLC nodes). */
  readVec3(): [number, number, number] {
    const x = this.readF32();
    const y = this.readF32();
    const z = this.readF32();
    return [x, y, z];
  }

  /** Read a 12-byte glm::vec3 that was written via writeBytes(ptr, 12) —
   *  the **whole-blob-reversed** flavor. On disk the 12 bytes are
   *  `z[3] z[2] z[1] z[0] y[3] y[2] y[1] y[0] x[3] x[2] x[1] x[0]`, each
   *  component still big-endian inside its slot. We read in stored order
   *  (z, y, x) and return as (x, y, z). */
  readReversedVec3(): [number, number, number] {
    const z = this.readF32();
    const y = this.readF32();
    const x = this.readF32();
    return [x, y, z];
  }

  /** Read `n` raw bytes and return an opaque slice. Used for the QColor
   *  blob (3 × 16 bytes) we treat as opaque per the spec. */
  readRaw(n: number): Uint8Array {
    this.requireRemaining(n, `raw(${n})`);
    const out = this.buffer.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /** ASCII tag (3 or 4 bytes) — used for "FVD", "TRC", "EOT", "EOP",
   *  "STR"…"CSV", "FUNC". No length prefix. */
  readTag(length: number): string {
    this.requireRemaining(length, `tag(${length})`);
    const tag = ASCII_DECODER.decode(this.buffer.subarray(this.offset, this.offset + length));
    this.offset += length;
    return tag;
  }

  /** Length-prefixed UTF-8 string (i32 length + bytes). The length must
   *  fit within the remaining buffer; otherwise we raise rather than
   *  attempt a multi-gigabyte allocation (§11 bug #8). */
  readLstr(): string {
    const len = this.readI32();
    if (len < 0 || len > this.remaining) {
      throw new WebFvdError(
        'io.fvdMalformed',
        { reason: 'string-length-overflow', length: len, remaining: this.remaining },
      );
    }
    const bytes = this.buffer.subarray(this.offset, this.offset + len);
    this.offset += len;
    return UTF8_DECODER.decode(bytes);
  }

  /** Peek the next `length` bytes as an ASCII tag without advancing. */
  peekTag(length: number): string {
    if (this.offset + length > this.buffer.byteLength) {
      return '';
    }
    return ASCII_DECODER.decode(this.buffer.subarray(this.offset, this.offset + length));
  }

  private requireRemaining(n: number, what: string): void {
    if (n < 0 || this.offset + n > this.buffer.byteLength) {
      throw new WebFvdError(
        'io.fvdMalformed',
        {
          reason: 'unexpected-eof',
          field: what,
          offset: this.offset,
          need: n,
          remaining: this.remaining,
        },
      );
    }
  }
}
