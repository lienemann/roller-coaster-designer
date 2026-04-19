// SPDX-License-Identifier: AGPL-3.0-only

// Struct-of-arrays layout for the 1000 Hz node stream. Spec §4.2 is explicit:
// one MNode per integration tick, ~60k nodes on a two-minute coaster. An
// array-of-structs allocation (new MNode()) inside the integrator would move
// about a million objects per recompute; we want zero allocation in the hot
// loop, so every field becomes its own typed-array column.

export const MNODE_FIELDS = [
  // Pose (position, forward, lateral, normal). vec3s flattened to three columns.
  'posX',
  'posY',
  'posZ',
  'dirX',
  'dirY',
  'dirZ',
  'latX',
  'latY',
  'latZ',
  'normX',
  'normY',
  'normZ',
  // Pose scalar: roll (radians internally, degrees in UI).
  'roll',
  // Kinematics.
  'vel',
  'energy',
  // Forces: raw output of the Force functions, then the smoothed variant.
  // Three rider-frame components: normal (into-seat), lateral (to the right),
  // longitudinal (forward along dir). All three are dimensionless g multiples.
  'forceNormal',
  'forceLateral',
  'forceLong',
  'smoothNormal',
  'smoothLateral',
  'smoothLong',
  // Per-step deltas.
  'distFromLast',
  'heartDistFromLast',
  'angleFromLast',
  'trackAngleFromLast',
  'dirFromLast',
  'pitchFromLast',
  'yawFromLast',
  'rollSpeed',
  'smoothSpeed',
  // Running totals.
  'totalLength',
  'totalHeartLength',
] as const;

export type MNodeField = (typeof MNODE_FIELDS)[number];

export type MNodeArrays = {
  readonly capacity: number;
  length: number;
} & Record<MNodeField, Float32Array>;

export function allocateMNodeArrays(capacity: number): MNodeArrays {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError(`MNode capacity must be a non-negative integer, got ${capacity}`);
  }

  const columns = {} as Record<MNodeField, Float32Array>;
  for (const field of MNODE_FIELDS) {
    columns[field] = new Float32Array(capacity);
  }

  return {
    capacity,
    length: 0,
    ...columns,
  };
}

// Memory footprint helper used by the worker to decide whether it can grow
// a buffer in place or needs to reallocate. Spec §4.2: 60k × 29 × 4 ≈ 7 MB.
export function mnodeByteLength(capacity: number): number {
  return capacity * MNODE_FIELDS.length * Float32Array.BYTES_PER_ELEMENT;
}

// Collect the underlying ArrayBuffers so the worker can transfer them to the
// main thread in one postMessage. Order is stable across calls.
export function mnodeBuffers(arrays: MNodeArrays): ArrayBufferLike[] {
  return MNODE_FIELDS.map((field) => arrays[field].buffer);
}
