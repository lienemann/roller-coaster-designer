// SPDX-License-Identifier: AGPL-3.0-only
//
// FVD++ compatibility audit over a ProjectDoc. Pure; the UI surfaces the
// notes as inline section markers, an export-time confirm dialog, and
// the gray-out mode for incompatible fields.

import { type ProjectDoc, type SectionDoc } from './doc.js';
import { EDegree } from './subfunction.js';

export type FvdCompatCode =
  | 'sectionColor' // per-section colour has no FVD++ slot — dropped on export.
  | 'closure' // closure exports as a plain BEZ; re-import loses the auto-join.
  | 'freeformAuthored'; // authored Freeform pointList is not persisted by .fvd.

export interface FvdCompatNote {
  readonly code: FvdCompatCode;
  readonly trackIndex: number;
  readonly sectionIndex: number | null;
  readonly message: string;
}

function sectionFuncs(s: SectionDoc): { subfuncs: { degree: EDegree; pointList?: unknown }[] }[] {
  switch (s.kind) {
    case 'straight':
    case 'curved':
      return [s.rollFunc];
    case 'forced':
    case 'geometric':
      return [s.rollFunc, s.normForce, s.latForce];
    default:
      return [];
  }
}

export function lintFvdCompatibility(project: ProjectDoc): FvdCompatNote[] {
  const notes: FvdCompatNote[] = [];
  for (let ti = 0; ti < project.tracks.length; ti++) {
    const track = project.tracks[ti]!;
    for (let si = 0; si < track.sections.length; si++) {
      const section = track.sections[si]!;
      if (section.color !== undefined) {
        notes.push({
          code: 'sectionColor',
          trackIndex: ti,
          sectionIndex: si,
          message: `Section "${section.name}" has a per-section colour; FVD++ stores only a single track colour, so it is dropped on FVD export.`,
        });
      }
      if (section.kind === 'closure') {
        notes.push({
          code: 'closure',
          trackIndex: ti,
          sectionIndex: si,
          message:
            'Closure sections export as a plain Bezier — FVD++ has no closure concept, so re-importing loses the auto-join.',
        });
      }
      for (const f of sectionFuncs(section)) {
        if (f.subfuncs.some((sf) => sf.degree === EDegree.Freeform && sf.pointList)) {
          notes.push({
            code: 'freeformAuthored',
            trackIndex: ti,
            sectionIndex: si,
            message: `Section "${section.name}" has an authored Freeform transition; FVD++'s file format does not persist its control points, so the shape flattens to its start value after a .fvd round trip.`,
          });
          break;
        }
      }
    }
  }
  return notes;
}

export function sectionHasFvdCompatIssue(
  notes: readonly FvdCompatNote[],
  trackIndex: number,
  sectionIndex: number,
): boolean {
  return notes.some((n) => n.trackIndex === trackIndex && n.sectionIndex === sectionIndex);
}

/** Section kinds authorable under FVD-compat mode. Everything current
 *  converts on export (closure → BEZ); future T2+ kinds (switches,
 *  launches, magnetic brakes) gate here. */
export function isSectionKindAuthorable(_kind: SectionDoc['kind'], _fvdCompat: boolean): boolean {
  return true;
}
