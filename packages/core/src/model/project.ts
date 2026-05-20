// SPDX-License-Identifier: AGPL-3.0-only

import { type Track } from './track.js';

// Ported from ui/projectwidget.cpp. `texturePath` is carried for legacy
// compatibility with FVD++ .fvd files that reference a ground-texture image;
// webfvd doesn't render one today (the viewport lands at M7), but the field
// has to survive a round-trip so loading an FVD++ project and re-saving it
// doesn't silently drop user intent.
//
// `fvdCompatibilityMode` is a WebFVD-only project flag (not persisted to
// `.fvd`). When true: integrator runs in float32-emulation mode and the UI
// hides T2+ section types so what you author maps cleanly to FVD++ on
// export. When false: integrator runs in float64 ("precise") mode and all
// section types are available — designs no longer byte-identical to FVD++
// but typically more accurate over long tracks. Default true while T1 is
// the shipping product. See spec §5.5.
export interface Project {
  texturePath: string;
  tracks: Track[];
  fvdCompatibilityMode: boolean;
}

export function createEmptyProject(): Project {
  return {
    texturePath: '',
    tracks: [],
    fvdCompatibilityMode: true,
  };
}
