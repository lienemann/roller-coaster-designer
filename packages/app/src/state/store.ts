// SPDX-License-Identifier: GPL-3.0-only
import { create } from 'zustand';

import { EMPTY_COMMAND_LOG, type CommandLog } from './command-log.types.ts';

/**
 * Root application state. M0 deliberately exposes almost nothing — we want
 * the store wired end to end (provider, devtools, selectors) before we start
 * stuffing project data in at M1.
 */
export interface AppState {
  readonly commandLog: CommandLog;
  readonly ready: boolean;
  readonly markReady: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  commandLog: EMPTY_COMMAND_LOG,
  ready: false,
  markReady: () => set({ ready: true }),
}));
