// SPDX-License-Identifier: AGPL-3.0-only

import {
  buildTrack,
  parseWebFvdJson,
  readFvd,
  stringifyWebFvdJson,
  trackToDoc,
  WebFvdError,
  writeFvd,
  writeNl2Csv,
  type ProjectDoc,
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
  readonly project: ProjectDoc;
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
    const project = parseWebFvdJson(text);
    return { project, handle, name: file.name };
  }

  const file = await openViaInput('.webfvd.json,application/json');
  if (!file) return null;
  const text = await file.text();
  const project = parseWebFvdJson(text);
  return { project, handle: null, name: file.name };
}

export interface SaveResult {
  readonly handle: OpaqueFileHandle | null;
  readonly name: string;
}

export interface FvdImportResult {
  readonly project: ProjectDoc;
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
  const file = readFvd(new Uint8Array(bytes));
  return {
    project: { fvdCompatibilityMode: true, tracks: file.tracks.map(trackToDoc) },
    name,
    version: file.version === 'v0.30' ? 'v0.30' : 'v0.77',
    warnings: [],
  };
}

export async function saveProjectAs(project: ProjectDoc): Promise<SaveResult | null> {
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
  project: ProjectDoc,
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

function downloadBlob(
  filename: string,
  content: string | Uint8Array,
  mime = 'application/json',
): void {
  const part: BlobPart = typeof content === 'string' ? content : (content as BlobPart);
  const blob = new Blob([part], { type: mime });
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

/**
 * Export the current project to a legacy `.fvd` binary. Uses the File
 * System Access API when available so the user picks the destination
 * (and the handle could be reused for fast re-saves later); falls back
 * to a download blob.
 */
export async function exportFvd(
  project: ProjectDoc,
  suggestedName = 'project.fvd',
): Promise<SaveResult | null> {
  const bytes = writeFvd({
    version: 'v0.77',
    backgroundImage: '',
    tracks: project.tracks.map(buildTrack),
  });
  const w = globalThis as unknown as FsaWindow;
  if (hasFileSystemAccess()) {
    let handle: FileSystemFileHandle;
    try {
      handle = await w.showSaveFilePicker!({
        suggestedName,
        types: FVD_PICKER_TYPES,
      });
    } catch (err) {
      if (isUserCancellation(err)) return null;
      throw new WebFvdError('io.saveCancelled', { reason: reasonOf(err) });
    }
    const writable = await handle.createWritable();
    // The FSA `write()` accepts a Blob or BufferSource. Wrap our bytes in
    // a Blob so we don't have to fight the BufferSource SharedArrayBuffer
    // generic; the underlying browser API copies into the file either way.
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    await (writable as unknown as { write(data: Blob): Promise<void> }).write(blob);
    await writable.close();
    return { handle, name: handle.name };
  }
  downloadBlob(suggestedName, bytes, 'application/octet-stream');
  return { handle: null, name: suggestedName };
}

/**
 * Export the integrated track stream of the first track to NoLimits 2 CSV
 * (NL2's "Track import from CSV" format). One row per `stride`-th node;
 * `stride` defaults to 100 (~100 ms apart at 1 kHz integration).
 */
export async function exportNl2Csv(
  project: ProjectDoc,
  options: { stride?: number; suggestedName?: string } = {},
): Promise<SaveResult | null> {
  if (project.tracks.length === 0) return null;
  const track = buildTrack(project.tracks[0]!);
  const csv = writeNl2Csv(track, options.stride !== undefined ? { stride: options.stride } : {});
  const name = options.suggestedName ?? 'track.csv';
  const w = globalThis as unknown as FsaWindow;
  if (hasFileSystemAccess()) {
    let handle: FileSystemFileHandle;
    try {
      handle = await w.showSaveFilePicker!({
        suggestedName: name,
        types: [
          {
            description: 'NoLimits 2 CSV',
            accept: { 'text/csv': ['.csv'] },
          },
        ],
      });
    } catch (err) {
      if (isUserCancellation(err)) return null;
      throw new WebFvdError('io.saveCancelled', { reason: reasonOf(err) });
    }
    const writable = await handle.createWritable();
    await writable.write(csv);
    await writable.close();
    return { handle, name: handle.name };
  }
  downloadBlob(name, csv, 'text/csv');
  return { handle: null, name };
}
