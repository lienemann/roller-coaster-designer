// SPDX-License-Identifier: AGPL-3.0-only

import { F_HZ, integrateProject, type Project } from '@roller-coaster-designer/core';
import { expose, transfer } from 'comlink';

import { type PhysicsWorkerApi, type RecomputeResult, type TrackStream } from './api.types.js';

export type { PhysicsWorkerApi, RecomputeResult, TrackStream };

const api: PhysicsWorkerApi = {
  ping: (value) => Promise.resolve(value),

  recompute: (project: Project): Promise<RecomputeResult> => {
    const integrations = integrateProject(project.tracks);

    const tracks: TrackStream[] = integrations.map(({ arrays, sectionStartNodes }) => {
      const count = arrays.length;
      const positions = new Float32Array(count * 3);
      const velocity = new Float32Array(count);
      const forceNormal = new Float32Array(count);
      const forceLateral = new Float32Array(count);
      const cumulativeTime = new Float32Array(count);

      const dt = 1 / F_HZ;
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = arrays.posX[i]!;
        positions[i * 3 + 1] = arrays.posY[i]!;
        positions[i * 3 + 2] = arrays.posZ[i]!;
        velocity[i] = arrays.vel[i]!;
        forceNormal[i] = arrays.forceNormal[i]!;
        forceLateral[i] = arrays.forceLateral[i]!;
        cumulativeTime[i] = i * dt;
      }
      return {
        nodeCount: count,
        positions,
        velocity,
        forceNormal,
        forceLateral,
        cumulativeTime,
        sectionStartNodes,
      };
    });

    const transferList = tracks.flatMap((t) => [
      t.positions.buffer,
      t.velocity.buffer,
      t.forceNormal.buffer,
      t.forceLateral.buffer,
      t.cumulativeTime.buffer,
    ]);
    return Promise.resolve(transfer({ tracks }, transferList) as RecomputeResult);
  },
};

expose(api);
