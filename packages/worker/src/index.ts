// SPDX-License-Identifier: AGPL-3.0-only

import { integrateProject, type Project } from '@roller-coaster-designer/core';
import { expose, transfer } from 'comlink';

import { type PhysicsWorkerApi, type RecomputeResult, type TrackStream } from './api.types.js';

export type { PhysicsWorkerApi, RecomputeResult, TrackStream };

const api: PhysicsWorkerApi = {
  ping: (value) => Promise.resolve(value),

  recompute: (project: Project): Promise<RecomputeResult> => {
    const integrations = integrateProject(project.tracks);

    const tracks: TrackStream[] = integrations.map(({ arrays, sectionStartNodes }) => {
      const count = arrays.length;
      // Pack only the XYZ positions — that's all the M2 viewport draws.
      // Force + velocity columns stay inside the worker for now; they ride
      // along on later milestones when the UI needs them.
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = arrays.posX[i]!;
        positions[i * 3 + 1] = arrays.posY[i]!;
        positions[i * 3 + 2] = arrays.posZ[i]!;
      }
      return { nodeCount: count, positions, sectionStartNodes };
    });

    const transferList = tracks.map((t) => t.positions.buffer);
    return Promise.resolve(transfer({ tracks }, transferList) as RecomputeResult);
  },
};

expose(api);
