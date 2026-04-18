// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasFileSystemAccess, openProject, saveProjectAs } from './file-system.js';

const ORIGINAL_SHOW_OPEN = (globalThis as Record<string, unknown>).showOpenFilePicker;
const ORIGINAL_SHOW_SAVE = (globalThis as Record<string, unknown>).showSaveFilePicker;

function restorePickers(): void {
  const g = globalThis as Record<string, unknown>;
  if (ORIGINAL_SHOW_OPEN === undefined) delete g.showOpenFilePicker;
  else g.showOpenFilePicker = ORIGINAL_SHOW_OPEN;
  if (ORIGINAL_SHOW_SAVE === undefined) delete g.showSaveFilePicker;
  else g.showSaveFilePicker = ORIGINAL_SHOW_SAVE;
}

const VALID_PROJECT_JSON = JSON.stringify({
  format: 'webfvd',
  version: 1,
  project: { texturePath: '', tracks: [] },
});

describe('file-system adapter — feature detection', () => {
  afterEach(() => {
    restorePickers();
    vi.restoreAllMocks();
  });

  it('reports no FS Access when the picker globals are absent', () => {
    restorePickers();
    delete (globalThis as Record<string, unknown>).showOpenFilePicker;
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    expect(hasFileSystemAccess()).toBe(false);
  });

  it('reports FS Access when both pickers are present', () => {
    (globalThis as Record<string, unknown>).showOpenFilePicker = vi.fn();
    (globalThis as Record<string, unknown>).showSaveFilePicker = vi.fn();
    expect(hasFileSystemAccess()).toBe(true);
  });
});

describe('file-system adapter — FS Access path', () => {
  afterEach(() => {
    restorePickers();
    vi.restoreAllMocks();
  });

  it('opens via showOpenFilePicker and parses the file', async () => {
    const file = {
      name: 'sample.webfvd.json',
      text: vi.fn(() => Promise.resolve(VALID_PROJECT_JSON)),
    } as unknown as File;
    const handle = {
      name: 'sample.webfvd.json',
      getFile: vi.fn(() => Promise.resolve(file)),
      createWritable: vi.fn(),
    };
    (globalThis as Record<string, unknown>).showOpenFilePicker = vi.fn(() =>
      Promise.resolve([handle]),
    );
    (globalThis as Record<string, unknown>).showSaveFilePicker = vi.fn();

    const result = await openProject();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('sample.webfvd.json');
    expect(result!.handle).toBe(handle);
    expect(result!.project.tracks).toEqual([]);
  });

  it('saves via showSaveFilePicker and writes the stringified project', async () => {
    const writes: string[] = [];
    const writable = {
      write: vi.fn((data: string) => {
        writes.push(data);
        return Promise.resolve();
      }),
      close: vi.fn(() => Promise.resolve()),
    };
    const handle = {
      name: 'out.webfvd.json',
      getFile: vi.fn(),
      createWritable: vi.fn(() => Promise.resolve(writable)),
    };
    (globalThis as Record<string, unknown>).showOpenFilePicker = vi.fn();
    (globalThis as Record<string, unknown>).showSaveFilePicker = vi.fn(() =>
      Promise.resolve(handle),
    );

    const result = await saveProjectAs({ texturePath: '', tracks: [] });
    expect(result).not.toBeNull();
    expect(result!.handle).toBe(handle);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toMatchObject({ format: 'webfvd', version: 1 });
  });

  it('returns null when the user cancels the open dialog', async () => {
    const abort = new DOMException('', 'AbortError');
    (globalThis as Record<string, unknown>).showOpenFilePicker = vi.fn(() => Promise.reject(abort));
    (globalThis as Record<string, unknown>).showSaveFilePicker = vi.fn();
    const result = await openProject();
    expect(result).toBeNull();
  });
});
