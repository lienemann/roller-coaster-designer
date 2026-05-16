// SPDX-License-Identifier: AGPL-3.0-only

import { SecType } from '../../model/enums.js';
import { type Project } from '../../model/project.js';

// FVD++ compatibility audit. A pure function that walks a Project and
// returns a list of points where exporting to `.fvd` would lose
// information or where the FVD++ reader (or NL2 chain) might interpret
// the data differently than our integrator. The UI surfaces these:
//   - inline markers on offending sections,
//   - a confirm dialog at FVD export time,
//   - a one-time toast when an incompatible field is first authored.
//
// Each note carries a stable `code` so translations and UI tests can key
// on it without parsing the (English) message.

export type FvdCompatCode =
  | 'sectionColor' // per-section colour has no FVD++ slot — dropped on export.
  | 'closure'; // Closure section is materialised as a regular Bezier on export.

export interface FvdCompatNote {
  readonly code: FvdCompatCode;
  /** Track index. Always 0 today (single-track projects). */
  readonly trackIndex: number;
  /** Section index within the track, or null for track-level notes. */
  readonly sectionIndex: number | null;
  /** English description; UI translates via `i18n` keyed on `code`. */
  readonly message: string;
}

export function lintFvdCompatibility(project: Project): FvdCompatNote[] {
  const notes: FvdCompatNote[] = [];
  for (let ti = 0; ti < project.tracks.length; ti += 1) {
    const track = project.tracks[ti]!;
    for (let si = 0; si < track.sections.length; si += 1) {
      const section = track.sections[si]!;
      if (section.color !== undefined) {
        notes.push({
          code: 'sectionColor',
          trackIndex: ti,
          sectionIndex: si,
          message: `Section "${section.name}" has a per-section colour; FVD++ stores only a single track colour, so this will be dropped on FVD export.`,
        });
      }
      if (section.type === SecType.Closure) {
        notes.push({
          code: 'closure',
          trackIndex: ti,
          sectionIndex: si,
          message:
            'Closure sections export as a regular Bezier — FVD++ has no closure concept, so re-importing will not recognise it as a closure.',
        });
      }
    }
  }
  return notes;
}

/** True iff a given section has any FVD-compatibility notes attached.
 *  Used for the in-list marker dot. */
export function sectionHasFvdCompatIssue(
  notes: readonly FvdCompatNote[],
  trackIndex: number,
  sectionIndex: number,
): boolean {
  for (const note of notes) {
    if (note.trackIndex === trackIndex && note.sectionIndex === sectionIndex) return true;
  }
  return false;
}
