// SPDX-License-Identifier: GPL-3.0-only

export { parseWebFvdJson, type ReadResult } from './reader.js';
export { stringifyWebFvdJson, type WriteOptions } from './writer.js';
export { CURRENT_VERSION } from './migrations.js';
export { webFvdFileV1Schema, type WebFvdFileV1 } from './schema.js';
