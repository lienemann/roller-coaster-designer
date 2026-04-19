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
      const lateralAxis = new Float32Array(count * 3);
      const velocity = new Float32Array(count);
      const forceNormal = new Float32Array(count);
      const forceLateral = new Float32Array(count);
      const forceLong = new Float32Array(count);
      const cumulativeTime = new Float32Array(count);
      const sectionIndex = new Uint16Array(count);

      const dt = 1 / F_HZ;

      // Walk the sectionStartNodes table once to fill sectionIndex cheaply.
      // Out-of-bound section indices are clamped to 0xffff; 65535 sections is
      // well beyond what any realistic track needs (FVD++ caps at a few
      // hundred) and keeps the column packed in 2 bytes per node.
      let currentSection = 0;
      let nextStart = sectionStartNodes[1] ?? count;

      for (let i = 0; i < count; i += 1) {
        while (i >= nextStart && currentSection + 1 < sectionStartNodes.length) {
          currentSection += 1;
          nextStart = sectionStartNodes[currentSection + 1] ?? count;
        }
        sectionIndex[i] = currentSection > 0xffff ? 0xffff : currentSection;

        positions[i * 3] = arrays.posX[i]!;
        positions[i * 3 + 1] = arrays.posY[i]!;
        positions[i * 3 + 2] = arrays.posZ[i]!;
        lateralAxis[i * 3] = arrays.latX[i]!;
        lateralAxis[i * 3 + 1] = arrays.latY[i]!;
        lateralAxis[i * 3 + 2] = arrays.latZ[i]!;
        velocity[i] = arrays.vel[i]!;
        forceNormal[i] = arrays.forceNormal[i]!;
        forceLateral[i] = arrays.forceLateral[i]!;
        forceLong[i] = arrays.forceLong[i]!;
        cumulativeTime[i] = i * dt;
      }
      return {
        nodeCount: count,
        positions,
        lateralAxis,
        velocity,
        forceNormal,
        forceLateral,
        forceLong,
        cumulativeTime,
        sectionIndex,
        sectionStartNodes,
      };
    });

    const transferList = tracks.flatMap((t) => [
      t.positions.buffer,
      t.lateralAxis.buffer,
      t.velocity.buffer,
      t.forceNormal.buffer,
      t.forceLateral.buffer,
      t.forceLong.buffer,
      t.cumulativeTime.buffer,
      t.sectionIndex.buffer,
    ]);
    return Promise.resolve(transfer({ tracks }, transferList) as RecomputeResult);
  },
};

expose(api);
