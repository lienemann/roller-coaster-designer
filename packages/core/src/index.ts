// SPDX-License-Identifier: AGPL-3.0-only

// Package version surfaced to consumers (kept in sync with package.json by release tooling at M10).
export const CORE_VERSION = '0.0.0';

// Package boundary is runtime-checked too: core must not touch the DOM.
// The ESLint `no-restricted-imports` rule enforces this at build time, but we
// keep the invariant here so a future test can assert it in Node.
export const PACKAGE_BOUNDARY = Object.freeze({
  name: '@roller-coaster-designer/core',
  forbiddenGlobals: ['window', 'document', 'navigator'] as const,
});

export * from './errors.js';

// ----- the one model: 1:1 FVD++ port + WebFVD document layer -----------
export { F_G, F_HZ, F_PI } from './fvd/constants.js';
export {
  setFloatPrecision,
  getFloatPrecision,
  type Precision,
  type Vec3,
} from './fvd/fvec.js';
export { EDegree, EFunctype, Subfunc } from './fvd/subfunction.js';
export { Func } from './fvd/func.js';
export { MNode } from './fvd/mnode.js';
export {
  Section,
  SecType,
  EULER,
  QUATERNION,
  TIME,
  DISTANCE,
  type BezierT,
} from './fvd/section.js';
export { SecStraight } from './fvd/sec-straight.js';
export { SecCurved } from './fvd/sec-curved.js';
export { SecForced } from './fvd/sec-forced.js';
export { SecGeometric } from './fvd/sec-geometric.js';
export { SecBezier } from './fvd/sec-bezier.js';
export { Track, type SmoothHandler } from './fvd/track.js';
export { applyRollSmooth, applySmooth, removeSmooth } from './fvd/smooth.js';

// ----- document layer (plain-JSON model the app/worker exchange) -------
export {
  buildProject,
  buildTrack,
  trackToDoc,
  sectionToDoc,
  isClosureSection,
  deriveClosureKnots,
  createEmptyProject,
  type ProjectDoc,
  type TrackDoc,
  type SectionDoc,
  type StraightSectionDoc,
  type CurvedSectionDoc,
  type ForcedSectionDoc,
  type GeometricSectionDoc,
  type BezierSectionDoc,
  type ClosureSectionDoc,
  type FuncDoc,
  type SubfuncDoc,
  type BezierKnotDoc,
  type SmootherDoc,
  type Vec3Doc,
} from './fvd/doc.js';

// ----- file I/O ----------------------------------------------------------
export { readFvd, writeFvd, type FvdFile } from './fvd/fvd-file.js';
export { parseWebFvdJson, stringifyWebFvdJson } from './fvd/json-io.js';
export { exportNL2, formatE } from './fvd/nl2-export.js';
export { writeNl2Csv, type Nl2CsvOptions } from './fvd/nl2-csv.js';

// ----- FVD++ compatibility audit ----------------------------------------
export {
  lintFvdCompatibility,
  sectionHasFvdCompatIssue,
  isSectionKindAuthorable,
  type FvdCompatCode,
  type FvdCompatNote,
} from './fvd/compat-doc.js';
