// SPDX-License-Identifier: GPL-3.0-only

/**
 * RPC surface exposed by the physics worker.
 *
 * Kept as a type-only module so the main thread can import the shape without
 * bundling the worker implementation. The real methods arrive at M2 (integrator
 * wiring) and grow from there.
 */
export interface PhysicsWorkerApi {
  /** Identity check; returns the input. Used to verify the Comlink round-trip. */
  ping(value: number): Promise<number>;
}
