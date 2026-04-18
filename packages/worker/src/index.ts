// SPDX-License-Identifier: GPL-3.0-only
import { expose } from 'comlink';

import { type PhysicsWorkerApi } from './api.types.js';

// M0 stub. Real recompute API lands at M2 (straight + anchor integrator).
const api: PhysicsWorkerApi = {
  ping: (value) => Promise.resolve(value),
};

// `self` is the DedicatedWorkerGlobalScope in a Web Worker.
expose(api);
