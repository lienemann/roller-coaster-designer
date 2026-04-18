// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';

import { useAppStore } from '../state/store.js';

import { getPhysicsWorker } from './physics-client.js';

// Debounce so a burst of keystrokes in a numeric field sends one recompute,
// not one per character. 60 ms lines up with one display frame at 60 Hz on a
// slower machine — fast enough to feel live, slow enough to skip typing
// noise. M7's playhead refinement may revisit.
const RECOMPUTE_DEBOUNCE_MS = 60;

/**
 * Fires a worker recompute whenever the referenced project changes and pushes
 * the resulting node streams back into the store. Keeps the subscription one
 * level above the Viewport so multiple 3D consumers (M14 node graph, M7 POV)
 * can read the same cached result later.
 *
 * Debounced so a rapid burst of edits (typing in the properties panel,
 * dragging a future 3D handle) coalesces into a single recompute pass
 * rather than thrashing the worker.
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
    const timer = setTimeout(() => {
      if (cancelled) return;
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
    }, RECOMPUTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, setTracks]);
}
