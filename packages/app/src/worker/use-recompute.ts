// SPDX-License-Identifier: GPL-3.0-only

import { useEffect } from 'react';

import { useAppStore } from '../state/store.js';

import { getPhysicsWorker } from './physics-client.js';

/**
 * Fires a worker recompute whenever the referenced project changes and pushes
 * the resulting node streams back into the store. Keeps the subscription one
 * level above the Viewport so multiple 3D consumers (M14 node graph, M7 POV)
 * can read the same cached result later.
 */
export function useRecomputeOnProjectChange(): void {
  const project = useAppStore((s) => s.project);
  const setTracks = useAppStore((s) => s.setTracks);

  useEffect(() => {
    if (project === null || project.tracks.length === 0) {
      setTracks([]);
      return;
    }

    let cancelled = false;
    const worker = getPhysicsWorker();
    worker
      .recompute(project)
      .then((result) => {
        if (!cancelled) setTracks(result.tracks);
      })
      .catch((err: unknown) => {
        // Recompute failures today are integrator programming bugs — the
        // sections that throw are the unported section types. Surface to the
        // console; future milestones add a proper status surface.
        console.error('Recompute failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [project, setTracks]);
}
