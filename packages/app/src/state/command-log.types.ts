// SPDX-License-Identifier: GPL-3.0-only

/**
 * Skeleton for the undo/redo log per docs/webfvd-spec.md §9. M0 only declares
 * the shape so UI code can import it; the executor is wired at M1 alongside
 * the data model.
 */
export interface CommandEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly kind: string;
  readonly payload: unknown;
}

export interface CommandLog {
  readonly entries: readonly CommandEntry[];
  readonly cursor: number;
}

export const EMPTY_COMMAND_LOG: CommandLog = Object.freeze({
  entries: Object.freeze([]),
  cursor: 0,
});
