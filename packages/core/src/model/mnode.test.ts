// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';

import { MNODE_FIELDS, allocateMNodeArrays, mnodeBuffers, mnodeByteLength } from './mnode.js';

describe('MNode SoA', () => {
  it('allocates one Float32Array per declared field', () => {
    const arrays = allocateMNodeArrays(64);
    expect(arrays.capacity).toBe(64);
    expect(arrays.length).toBe(0);
    for (const field of MNODE_FIELDS) {
      expect(arrays[field]).toBeInstanceOf(Float32Array);
      expect(arrays[field].length).toBe(64);
    }
  });

  it('rejects negative or non-integer capacity', () => {
    expect(() => allocateMNodeArrays(-1)).toThrow(RangeError);
    expect(() => allocateMNodeArrays(1.5)).toThrow(RangeError);
  });

  it('reports a byte length consistent with the field count', () => {
    const capacity = 60_000;
    const expected = capacity * MNODE_FIELDS.length * 4;
    expect(mnodeByteLength(capacity)).toBe(expected);
  });

  it('exposes every column as a transferable ArrayBuffer', () => {
    const arrays = allocateMNodeArrays(8);
    const buffers = mnodeBuffers(arrays);
    expect(buffers).toHaveLength(MNODE_FIELDS.length);
    for (const buffer of buffers) {
      expect(buffer.byteLength).toBe(8 * 4);
    }
  });
});
