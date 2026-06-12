// SPDX-License-Identifier: AGPL-3.0-only

import { F_HZ, buildProject, type ProjectDoc, type Track } from '@roller-coaster-designer/core';
import { expose, transfer } from 'comlink';

import { type PhysicsWorkerApi, type RecomputeResult, type TrackStream } from './api.types.js';

export type { PhysicsWorkerApi, RecomputeResult, TrackStream };

function streamTrack(track: Track): TrackStream {
  // Node 0 of every section duplicates the previous section's last node;
  // count each section's contribution as lNodes.length − 1 except the first.
  const sectionStartNodes: number[] = [];
  let count = 0;
  for (let si = 0; si < track.lSections.length; si++) {
    sectionStartNodes.push(count === 0 ? 0 : count - 1);
    count += track.lSections[si]!.lNodes.length - (si === 0 ? 0 : 1);
  }
  if (count === 0) {
    return {
      nodeCount: 0,
      positions: new Float32Array(0),
      lateralAxis: new Float32Array(0),
      velocity: new Float32Array(0),
      forceNormal: new Float32Array(0),
      forceLateral: new Float32Array(0),
      forceLong: new Float32Array(0),
      rollSpeed: new Float32Array(0),
      cumulativeTime: new Float32Array(0),
      sectionIndex: new Uint16Array(0),
      sectionStartNodes,
    };
  }

  const positions = new Float32Array(count * 3);
  const lateralAxis = new Float32Array(count * 3);
  const velocity = new Float32Array(count);
  const forceNormal = new Float32Array(count);
  const forceLateral = new Float32Array(count);
  const forceLong = new Float32Array(count);
  const rollSpeed = new Float32Array(count);
  const cumulativeTime = new Float32Array(count);
  const sectionIndex = new Uint16Array(count);

  // Display placement: FVD integrates from the origin facing −Z and the
  // renderer translates by startPos. Apply it here so the viewport shows
  // world coordinates.
  const ox = track.startPos.x;
  const oy = track.startPos.y;
  const oz = track.startPos.z;

  const dt = 1 / F_HZ;
  let i = 0;
  for (let si = 0; si < track.lSections.length; si++) {
    const sec = track.lSections[si]!;
    for (let j = si === 0 ? 0 : 1; j < sec.lNodes.length; j++, i++) {
      const n = sec.lNodes[j]!;
      positions[i * 3] = ox + n.vPos.x;
      positions[i * 3 + 1] = oy + n.vPos.y;
      positions[i * 3 + 2] = oz + n.vPos.z;
      lateralAxis[i * 3] = n.vLat.x;
      lateralAxis[i * 3 + 1] = n.vLat.y;
      lateralAxis[i * 3 + 2] = n.vLat.z;
      velocity[i] = n.fVel;
      forceNormal[i] = n.forceNormal;
      forceLateral[i] = n.forceLateral;
      forceLong[i] = n.forceLong;
      // fRollSpeed is °/s in the FVD model; stream stays rad/s.
      rollSpeed[i] = ((n.fRollSpeed + n.fSmoothSpeed) * Math.PI) / 180;
      cumulativeTime[i] = i * dt;
      sectionIndex[i] = si > 0xffff ? 0xffff : si;
    }
  }

  return {
    nodeCount: count,
    positions,
    lateralAxis,
    velocity,
    forceNormal,
    forceLateral,
    forceLong,
    rollSpeed,
    cumulativeTime,
    sectionIndex,
    sectionStartNodes,
  };
}

const api: PhysicsWorkerApi = {
  ping: (value) => Promise.resolve(value),

  recompute: (project: ProjectDoc): Promise<RecomputeResult> => {
    // buildProject applies the integrator mode (float32 emulation when
    // fvdCompatibilityMode, float64 otherwise) and runs updateTrack —
    // the SAME integrator chain the .fvd reader and NL2 exporter use.
    const built = buildProject(project);
    const tracks = built.map(streamTrack);
    const transferList = tracks.flatMap((t) => [
      t.positions.buffer,
      t.lateralAxis.buffer,
      t.velocity.buffer,
      t.forceNormal.buffer,
      t.forceLateral.buffer,
      t.forceLong.buffer,
      t.rollSpeed.buffer,
      t.cumulativeTime.buffer,
      t.sectionIndex.buffer,
    ]);
    return Promise.resolve(transfer({ tracks }, transferList) as RecomputeResult);
  },
};

expose(api);
