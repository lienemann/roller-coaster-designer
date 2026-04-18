// SPDX-License-Identifier: GPL-3.0-only

import { type Track } from './track.js';

// Ported from ui/projectwidget.cpp. `texturePath` is carried for legacy
// compatibility with FVD++ .fvd files that reference a ground-texture image;
// webfvd doesn't render one today (the viewport lands at M7), but the field
// has to survive a round-trip so loading an FVD++ project and re-saving it
// doesn't silently drop user intent.
export interface Project {
  texturePath: string;
  tracks: Track[];
}

export function createEmptyProject(): Project {
  return {
    texturePath: '',
    tracks: [],
  };
}
