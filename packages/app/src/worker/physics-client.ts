// SPDX-License-Identifier: GPL-3.0-only

import { type PhysicsWorkerApi } from '@roller-coaster-designer/worker';
import { wrap, type Remote } from 'comlink';

import PhysicsWorker from './physics.worker?worker';

let remote: Remote<PhysicsWorkerApi> | null = null;

/**
 * Lazy, single-page singleton: one physics worker per tab, shared across
 * recomputes. The worker owns its MNode SoA for the life of the page.
 */
export function getPhysicsWorker(): Remote<PhysicsWorkerApi> {
  if (remote) return remote;
  const worker = new PhysicsWorker({ name: 'rcd-physics' });
  remote = wrap<PhysicsWorkerApi>(worker);
  return remote;
}
