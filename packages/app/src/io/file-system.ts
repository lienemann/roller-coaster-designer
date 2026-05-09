// SPDX-License-Identifier: AGPL-3.0-only

import {
  parseFvd,
  parseWebFvdJson,
  stringifyWebFvdJson,
  WebFvdError,
  type Project,
} from '@roller-coaster-designer/core';

// Browser compatibility strategy per spec §8.5 and §16: prefer the File System
// Access API (Chromium) for real read-back, fall back to <input type="file">
// + <a download> (Safari, Firefox without the flag). Both branches work
// offline — no network calls ever.

// Minimal subset of the FSA types used here. Keeping the declarations local
// avoids a DOM-lib upgrade to types the app doesn't otherwise need.
interface FileSystemWritableStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableStream>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
interface OpenFilePickerOptions extends SaveFilePickerOptions {
  multiple?: boolean;
}

type FsaWindow = Window & {
  showOpenFilePicker?: (opts?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

export type OpaqueFileHandle = FileSystemFileHandle;

export function hasFileSystemAccess(): boolean {
  const w = globalThis as unknown as FsaWindow;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

const PICKER_TYPES = [
  {
    description: 'WebFVD project',
    accept: { 'application/json': ['.webfvd.json'] },
  },
] satisfies NonNullable<SaveFilePickerOptions['types']>;

const FVD_PICKER_TYPES = [
  {
    description: 'FVD++ project',
    accept: { 'application/octet-stream': ['.fvd'] },
  },
] satisfies NonNullable<SaveFilePickerOptions['types']>;

export interface OpenResult {
  readonly project: Project;
  readonly handle: OpaqueFileHandle | null;
  readonly name: string;
}

export async function openProject(): Promise<OpenResult | null> {
  const w = globalThis as unknown as FsaWindow;
  if (hasFileSystemAccess()) {
    let handle: FileSystemFileHandle;
    try {
      const handles = await w.showOpenFilePicker!({ types: PICKER_TYPES, multiple: false });
      const first = handles[0];
      if (!first) return null;
      handle = first;
    } catch (err) {
      if (isUserCancellation(err)) return null;
      throw new WebFvdError('io.fileRejected', { reason: reasonOf(err) });
    }
    const file = await handle.getFile();
    const text = await file.text();
    const { project } = parseWebFvdJson(text);
    return { project, handle, name: file.name };
  }

  const file = await openViaInput('.webfvd.json,application/json');
  if (!file) return null;
  const text = await file.text();
  const { project } = parseWebFvdJson(text);
  return { project, handle: null, name: file.name };
}

export interface SaveResult {
  readonly handle: OpaqueFileHandle | null;
  readonly name: string;
}

export interface FvdImportResult {
  readonly project: Project;
  readonly name: string;
  readonly version: 'v0.77' | 'v0.30';
  readonly warnings: readonly string[];
}

/**
 * Import a legacy FVD++ `.fvd` binary. Returns null if the user cancels;
 * throws WebFvdError on a malformed file. Always returns a fresh Project
 * (no in-place file handle for re-saves — the writer lands at M9).
 */
export async function importFvd(): Promise<FvdImportResult | null> {
  const w = globalThis as unknown as FsaWindow;
  let bytes: ArrayBuffer;
  let name: string;
  if (hasFileSystemAccess()) {
    let handle: FileSystemFileHandle;
    try {
      const handles = await w.showOpenFilePicker!({
        types: FVD_PICKER_TYPES,
        multiple: false,
      });
      const first = handles[0];
      if (!first) return null;
      handle = first;
    } catch (err) {
      if (isUserCancellation(err)) return null;
      throw new WebFvdError('io.fileRejected', { reason: reasonOf(err) });
    }
    const file = await handle.getFile();
    bytes = await file.arrayBuffer();
    name = file.name;
  } else {
    const file = await openViaInput('.fvd,application/octet-stream');
    if (!file) return null;
    bytes = await file.arrayBuffer();
    name = file.name;
  }
  const result = parseFvd(new Uint8Array(bytes));
  return {
    project: result.project,
    name,
    version: result.version,
    warnings: result.warnings,
  };
}

export async function saveProjectAs(project: Project): Promise<SaveResult | null> {
  const text = stringifyWebFvdJson(project);
  const w = globalThis as unknown as FsaWindow;

  if (hasFileSystemAccess()) {
    let handle: FileSystemFileHandle;
    try {
      handle = await w.showSaveFilePicker!({
        suggestedName: 'project.webfvd.json',
        types: PICKER_TYPES,
      });
    } catch (err) {
      if (isUserCancellation(err)) return null;
      throw new WebFvdError('io.saveCancelled', { reason: reasonOf(err) });
    }
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { handle, name: handle.name };
  }

  const name = 'project.webfvd.json';
  downloadBlob(name, text);
  return { handle: null, name };
}

export async function saveProject(
  project: Project,
  handle: OpaqueFileHandle | null,
): Promise<SaveResult | null> {
  // No in-place save without a handle — fall back to Save As.
  if (!handle) return saveProjectAs(project);

  const text = stringifyWebFvdJson(project);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return { handle, name: handle.name };
}

function isUserCancellation(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')
  );
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function openViaInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    // Clicking triggers the native picker; on dismissal neither `change` nor
    // `cancel` fires reliably across browsers, so consumers treat "nothing
    // happened" as a no-op rather than an error.
    document.body.append(input);
    input.click();
  });
}

function downloadBlob(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
