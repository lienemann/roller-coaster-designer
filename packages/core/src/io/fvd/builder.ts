// SPDX-License-Identifier: AGPL-3.0-only

// Byte builder for the FVD++ `.fvd` format. The inverse of FvdCursor — every
// primitive is **big-endian on disk** to match FVD++'s `writeBytes`
// (whole-buffer reversal on a little-endian host). vec3 fields have two
// flavours; see writeReversedVec3 vs writeVec3 below.
//
// Lives in core (no DOM dependencies) so the headless CLI (tools/fvd-dump)
// and the browser app share the same writer.

const TEXT_ENCODER = new TextEncoder();
const ASCII_ENCODER = new TextEncoder(); // ASCII is a UTF-8 subset; identical bytes for [0x00..0x7F].

const INITIAL_CAPACITY = 1024;

export class FvdBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  bytes(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  private ensure(n: number): void {
    const needed = this.offset + n;
    if (needed <= this.buffer.byteLength) return;
    let cap = this.buffer.byteLength;
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buffer.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(this.buffer.buffer);
  }

  writeU8(value: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
  }

  writeBool(value: boolean): void {
    this.writeU8(value ? 1 : 0);
  }

  writeI32(value: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, value, false);
    this.offset += 4;
  }

  writeF32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, value, false);
    this.offset += 4;
  }

  /** Three back-to-back BE f32s in (x, y, z) order. Matches readVec3 — used
   *  where FVD++ writes each component via a separate writeBytes(..., 4)
   *  call (NLC nodes; per-component bezier writes). */
  writeVec3(x: number, y: number, z: number): void {
    this.writeF32(x);
    this.writeF32(y);
    this.writeF32(z);
  }

  /** Whole-blob-reversed vec3: matches FVD++'s `writeBytes(ptr, 12)`. Each
   *  component is big-endian in its 4-byte slot, but the components appear
   *  on disk in (z, y, x) order. Used for Track.startPos and the three
   *  bezier_t vec3s. */
  writeReversedVec3(x: number, y: number, z: number): void {
    this.writeF32(z);
    this.writeF32(y);
    this.writeF32(x);
  }

  /** Three-letter ("FVD", "TRC", "EOT", "STR", …) or four-letter ("FUNC")
   *  ASCII tag written verbatim, no length prefix. */
  writeTag(tag: string): void {
    const bytes = ASCII_ENCODER.encode(tag);
    this.ensure(bytes.byteLength);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.byteLength;
  }

  /** Length-prefixed UTF-8 string: i32 length + bytes. */
  writeLstr(value: string): void {
    const bytes = TEXT_ENCODER.encode(value);
    this.writeI32(bytes.byteLength);
    this.ensure(bytes.byteLength);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.byteLength;
  }

  /** `n` zero bytes. Used for the QColor blob (§3.1) and any other opaque
   *  region we round-trip as zeros. */
  writeZeros(n: number): void {
    this.ensure(n);
    // The new region is zero-filled by Uint8Array's ctor when we grow; we
    // still slice() in bytes() so anything in capacity beyond `offset` is
    // ignored.
    this.offset += n;
  }
}
