// SPDX-License-Identifier: AGPL-3.0-only
//
// .fvd file envelope. The C++ wrapper (`saver.cpp`) writes a header
// "FVDv0.79" followed by a 4-byte int (background filename length) and the
// background filename string, then one or more TRC blocks. FVDv0.77 is
// identical for our purposes — both write the same TRC payload.
//
// This module sits above Track and handles only the header / footer.

import { ReadStream, WriteStream } from './io-stream.js';
import { Track } from './track.js';

export interface FvdFile {
  version: string; // "0.77" or "0.79"
  backgroundImage: string;
  tracks: Track[];
}

// projectwidget.cpp:360-361 writes "FVD" then "v0.77" as separate stream
// pushes (8 bytes total). The version string contains the leading 'v',
// e.g. "v0.30" (legacy) or "v0.77" (current).
export function readFvd(buf: Uint8Array): FvdFile {
  const rs = new ReadStream(buf);
  const magic = rs.readString(3);
  if (magic !== 'FVD') throw new Error(`not an FVD file: magic="${magic}"`);
  const version = rs.readString(5); // "v0.30" or "v0.77"
  const bgLen = rs.readInt();
  const background = rs.readString(bgLen);

  const tracks: Track[] = [];
  while (rs.pos + 3 <= buf.length) {
    const tag = rs.readString(3);
    if (tag === 'TRC') {
      const t = new Track();
      t.loadTRCBody(rs); // 'TRC' tag already consumed
      tracks.push(t);
    } else if (tag === 'EOP') {
      break;
    } else {
      throw new Error(`unexpected top-level tag "${tag}" at pos ${rs.pos - 3}`);
    }
  }

  return { version, backgroundImage: background, tracks };
}

export function writeFvd(file: FvdFile): Uint8Array {
  const ws = new WriteStream();
  ws.writeString('FVD');
  ws.writeString(file.version);
  ws.writeInt(file.backgroundImage.length);
  ws.writeString(file.backgroundImage);
  for (const t of file.tracks) {
    t.saveTRC(ws);
  }
  ws.writeString('EOP');
  return ws.toUint8Array();
}
