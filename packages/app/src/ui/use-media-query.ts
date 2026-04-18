// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';

/**
 * `matchMedia`-backed hook. Returns the current match state and stays
 * subscribed while mounted. SSR-safe: on the server / jsdom without
 * matchMedia we return `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    // Align with the current state immediately in case the query changed
    // between render and subscription.
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
