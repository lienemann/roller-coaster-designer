// SPDX-License-Identifier: AGPL-3.0-only

export { parseFvd, type FvdParseResult } from './reader.js';
export { writeFvd } from './writer.js';
export { FvdCursor } from './cursor.js';
export { FvdBuilder } from './builder.js';
export {
  isSectionTypeAuthorable,
  lintFvdCompatibility,
  sectionHasFvdCompatIssue,
  type FvdCompatCode,
  type FvdCompatNote,
} from './compat.js';
