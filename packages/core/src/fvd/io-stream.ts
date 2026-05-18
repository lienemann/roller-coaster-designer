// SPDX-License-Identifier: AGPL-3.0-only
//
// Port of reference/openfvd/core/exportfuncs.h (and the bodies in
// exportfuncs.cpp). FVD reads and writes everything in little-endian:
// floats are IEEE 754 binary32, ints are 32-bit, bools are a single byte,
// vec3 is three contiguous floats. Strings are length-prefixed elsewhere
// (see Track.load): the helper here is just a fixed-length byte read.

import type { Vec3 } from './fvec.js';
import { vec3 } from './fvec.js';

export class ReadStream {
  readonly view: DataView;
  pos = 0;
  constructor(public readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  // Read N bytes and return them as a Latin-1 string. FVD stores ASCII
  // section tags ("STR", "CUR", "FRC", "GEO", "BEZ", "CSV") and names.
  readString(length: number): string {
    let s = '';
    for (let i = 0; i < length; i++) {
      s += String.fromCharCode(this.view.getUint8(this.pos + i));
    }
    this.pos += length;
    return s;
  }

  // Consume `length` zero bytes; throw if any byte is nonzero. FVD uses
  // these to reserve space and asserts the slots stay null.
  readNulls(length: number): boolean {
    for (let i = 0; i < length; i++) {
      if (this.view.getUint8(this.pos + i) !== 0) {
        // FVD just returns false; same here.
        this.pos += length;
        return false;
      }
    }
    this.pos += length;
    return true;
  }

  // FVD writes multi-byte values byte-reversed (exportfuncs.cpp:24-29
  // writes data[length-1-i] for each byte), so on disk floats and ints
  // appear big-endian even though x86 is little-endian. We read big-endian
  // to undo the reversal.
  readFloat(): number {
    const v = this.view.getFloat32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readInt(): number {
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readBool(): boolean {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v !== 0;
  }

  readVec3(out: Vec3 = vec3()): Vec3 {
    out.x = this.readFloat();
    out.y = this.readFloat();
    out.z = this.readFloat();
    return out;
  }

  readBytes(length: number): Uint8Array {
    const v = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return v;
  }

  eof(): boolean {
    return this.pos >= this.buf.length;
  }
}

export class WriteStream {
  private chunks: Uint8Array[] = [];
  private scratch = new ArrayBuffer(4);
  private scratchView = new DataView(this.scratch);

  writeString(s: string): void {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    this.chunks.push(bytes);
  }

  // See ReadStream.readFloat — FVD's byte-reversal makes the disk format
  // big-endian for floats and ints. Write big-endian here to match.
  writeFloat(v: number): void {
    this.scratchView.setFloat32(0, v, false);
    this.chunks.push(new Uint8Array(this.scratch.slice(0, 4)));
  }

  writeInt(v: number): void {
    this.scratchView.setInt32(0, v, false);
    this.chunks.push(new Uint8Array(this.scratch.slice(0, 4)));
  }

  writeBool(v: boolean): void {
    this.chunks.push(new Uint8Array([v ? 1 : 0]));
  }

  writeNulls(length: number): void {
    this.chunks.push(new Uint8Array(length));
  }

  writeVec3(v: Vec3): void {
    this.writeFloat(v.x);
    this.writeFloat(v.y);
    this.writeFloat(v.z);
  }

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }

  toUint8Array(): Uint8Array {
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}
