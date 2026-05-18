// SPDX-License-Identifier: AGPL-3.0-only
//
// Scalar precision toggle and vec3/quaternion helpers used by the 1:1 FVD
// port. Lives outside `model/` so the port is self-contained and can be
// verified against the reference C++ before we wire it back into the worker.
//
// Precision: FVD++ uses `glm::vec3` (single-precision float) for all geometry.
// JavaScript `number` is double-precision, so to mimic C++ float arithmetic
// faithfully we round every assignment through `Math.fround`. Toggle via
// `setFloatPrecision('float32' | 'float64')`. Tests run both ways and report
// max/mean error.
//
// No allocations in hot loops: every vector op offers an out-parameter form.
// The "by-value" form (returns a new Vec3) exists for readability when the
// surrounding C++ used `glm::vec3` return-by-value.

export type Scalar = number;

export interface Vec3 {
  x: Scalar;
  y: Scalar;
  z: Scalar;
}

export type Precision = 'float32' | 'float64';

let currentPrecision: Precision = 'float32';

const identity = (x: number): number => x;

let roundFn: (x: number) => number = Math.fround;

export function setFloatPrecision(p: Precision): void {
  currentPrecision = p;
  roundFn = p === 'float32' ? Math.fround : identity;
}

export function getFloatPrecision(): Precision {
  return currentPrecision;
}

// `r(x)` is the single point where C++ "store-to-float" rounding happens.
// Inline math runs in float64 (JS native); writing back to a Vec3 field
// passes through r() so the next read sees what a C++ float would have seen.
export function r(x: Scalar): Scalar {
  return roundFn(x);
}

export const FvecArray = Float32Array;

export function vec3(x: Scalar = 0, y: Scalar = 0, z: Scalar = 0): Vec3 {
  return { x: r(x), y: r(y), z: r(z) };
}

export function vec3Set(out: Vec3, x: Scalar, y: Scalar, z: Scalar): Vec3 {
  out.x = r(x);
  out.y = r(y);
  out.z = r(z);
  return out;
}

export function vec3Copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function vec3Clone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function vec3Add(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  return vec3Set(out, a.x + b.x, a.y + b.y, a.z + b.z);
}

export function vec3Sub(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  return vec3Set(out, a.x - b.x, a.y - b.y, a.z - b.z);
}

export function vec3Scale(a: Vec3, s: Scalar, out: Vec3 = vec3()): Vec3 {
  return vec3Set(out, a.x * s, a.y * s, a.z * s);
}

export function vec3AddScaled(a: Vec3, b: Vec3, s: Scalar, out: Vec3 = vec3()): Vec3 {
  return vec3Set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

export function vec3Dot(a: Vec3, b: Vec3): Scalar {
  return r(a.x * b.x + a.y * b.y + a.z * b.z);
}

export function vec3LengthSq(a: Vec3): Scalar {
  return r(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vec3Length(a: Vec3): Scalar {
  return r(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z));
}

export function vec3Distance(a: Vec3, b: Vec3): Scalar {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return r(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

export function vec3Cross(a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 {
  // NOTE: write to locals first so cross(a, b, a) or cross(a, b, b) work.
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return vec3Set(out, x, y, z);
}

export function vec3Normalize(a: Vec3, out: Vec3 = vec3()): Vec3 {
  const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  if (len === 0) {
    return vec3Set(out, 0, 0, 0);
  }
  const inv = 1 / len;
  return vec3Set(out, a.x * inv, a.y * inv, a.z * inv);
}

// Rotate vector v around (already-normalized) axis k by angle radians.
// Rodrigues' formula. Equivalent to `glm::angleAxis(angle, axis) * v` in FVD,
// which builds a unit quaternion and multiplies — same result, fewer ops.
//
// FVD always normalizes its rotation axes before passing them in (see
// mnode.cpp lines 102, 113), so we assume a unit axis here too. Callers
// that pass a non-unit axis are bugs.
export function vec3RotateAxis(v: Vec3, axis: Vec3, angle: Scalar, out: Vec3 = vec3()): Vec3 {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  const oneMinus = 1 - cosA;
  const crossX = axis.y * v.z - axis.z * v.y;
  const crossY = axis.z * v.x - axis.x * v.z;
  const crossZ = axis.x * v.y - axis.y * v.x;
  return vec3Set(
    out,
    v.x * cosA + crossX * sinA + axis.x * dot * oneMinus,
    v.y * cosA + crossY * sinA + axis.y * dot * oneMinus,
    v.z * cosA + crossZ * sinA + axis.z * dot * oneMinus,
  );
}

// Mirrors GLM's `glm::angleAxis(angle, k) * v` byte-for-byte (subject to
// float64 vs float32 — see r() above): build the unit quaternion (cos(θ/2),
// sin(θ/2)*k), then apply via the cross-cross formulation glm uses in
// gtc/quaternion.inl. Equivalent to Rodrigues but with a different
// rounding path that better matches FVD when called in tight integrator
// loops where the float-precision details accumulate.
//
// Reference: glm/gtc/quaternion.inl, operator*(qua<T>, vec3<T>):
//   vec3 uv  = cross(q.xyz, v);
//   vec3 uuv = cross(q.xyz, uv);
//   return v + ((uv * q.w) + uuv) * 2;
export function vec3RotateAxisGlm(
  v: Vec3,
  axis: Vec3,
  angle: Scalar,
  out: Vec3 = vec3(),
): Vec3 {
  const half = r(angle * 0.5);
  const s = r(Math.sin(half));
  const c = r(Math.cos(half));
  const qx = r(s * axis.x);
  const qy = r(s * axis.y);
  const qz = r(s * axis.z);
  const qw = c;
  const uvx = r(qy * v.z - qz * v.y);
  const uvy = r(qz * v.x - qx * v.z);
  const uvz = r(qx * v.y - qy * v.x);
  const uuvx = r(qy * uvz - qz * uvy);
  const uuvy = r(qz * uvx - qx * uvz);
  const uuvz = r(qx * uvy - qy * uvx);
  return vec3Set(
    out,
    v.x + r(r(uvx * qw + uuvx) * 2),
    v.y + r(r(uvy * qw + uuvy) * 2),
    v.z + r(r(uvz * qw + uuvz) * 2),
  );
}

// Signed angle between two vectors. FVD uses `glm::angle(a, b)` which is the
// unsigned acos(dot/|a||b|) — provide both.
export function vec3UnsignedAngle(a: Vec3, b: Vec3): Scalar {
  const la = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  const lb = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
  if (la === 0 || lb === 0) return 0;
  let c = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  if (c > 1) c = 1;
  else if (c < -1) c = -1;
  return Math.acos(c);
}
