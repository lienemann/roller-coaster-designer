// SPDX-License-Identifier: AGPL-3.0-only
//
// Document-layer tests. The decisive one is the .fvd oracle: routing
// testtrack.fvd through trackToDoc → JSON → parse → buildTrack →
// writeFvd must emit the same bytes as the direct read → write chain.
// If the doc layer drops or distorts a field, the byte diff finds it.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildProject, buildTrack, trackToDoc, type ProjectDoc } from './doc.js';
import { readFvd, writeFvd } from './fvd-file.js';
import { parseWebFvdJson, stringifyWebFvdJson } from './json-io.js';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = resolve(here, '../../test/golden/data');

function loadFvd(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(goldenDir, rel)));
}

describe('doc round trip against the .fvd byte chain', () => {
  for (const rel of [
    'fvd-real/testtrack.fvd',
    'fvd-corpus/mixed-all.fvd',
    'fvd-corpus/bez-roll.fvd',
    'fvd-corpus/smooth-roll.fvd',
  ]) {
    it(`${rel}: read → doc → json → doc → build → write equals read → write`, () => {
      const original = loadFvd(rel);
      const file = readFvd(original);
      const direct = writeFvd(file);

      const project: ProjectDoc = {
        fvdCompatibilityMode: true,
        tracks: file.tracks.map(trackToDoc),
      };
      const reparsed = parseWebFvdJson(stringifyWebFvdJson(project));
      const rebuilt = writeFvd({
        version: file.version,
        backgroundImage: file.backgroundImage,
        tracks: reparsed.tracks.map(buildTrack),
      });

      expect(rebuilt.length).toBe(direct.length);
      for (let i = 0; i < direct.length; i++) {
        if (rebuilt[i] !== direct[i]) {
          throw new Error(`byte mismatch at ${i}: direct=${direct[i]} viaDoc=${rebuilt[i]}`);
        }
      }
    });
  }
});

describe('closure derivation', () => {
  it('joins the track end back to the anchor within mm', () => {
    const project: ProjectDoc = {
      fvdCompatibilityMode: true,
      tracks: [
        {
          name: 'ring',
          startPos: [0, 20, 0],
          startYaw: 0,
          startPitch: 0,
          anchor: { roll: 0, vel: 12, normal: 1, lateral: 0 },
          heart: 1.1,
          friction: 0,
          resistance: 0,
          style: 0,
          sections: [
            {
              kind: 'curved',
              name: 'half-turn',
              bSpeed: false,
              fVel: 12,
              bOrientation: false,
              fAngle: 180,
              fRadius: 15,
              fDirection: 90,
              fLeadIn: 0,
              fLeadOut: 0,
              rollFunc: {
                subfuncs: [
                  {
                    degree: 2,
                    minArgument: 0,
                    maxArgument: 180,
                    startValue: 0,
                    symArg: 0,
                    arg1: 0,
                    centerArg: 0,
                    tensionArg: 0,
                    locked: false,
                  },
                ],
              },
            },
            { kind: 'closure', name: 'Closure' },
          ],
          smoothers: [],
        },
      ],
    };
    const [track] = buildProject(project);
    const last = track!.lSections[track!.lSections.length - 1]!;
    const endNode = last.lNodes[last.lNodes.length - 1]!;
    const a = track!.anchorNode;
    const gap = Math.hypot(
      endNode.vPos.x - a.vPos.x,
      endNode.vPos.y - a.vPos.y,
      endNode.vPos.z - a.vPos.z,
    );
    expect(gap).toBeLessThan(0.05);
  });
});

describe('json schema', () => {
  it('rejects wrong version', () => {
    expect(() =>
      parseWebFvdJson(JSON.stringify({ format: 'webfvd', version: 2, project: { tracks: [] } })),
    ).toThrow();
  });

  it('stringify is idempotent through parse', () => {
    const p: ProjectDoc = { fvdCompatibilityMode: false, tracks: [] };
    const s1 = stringifyWebFvdJson(p);
    const s2 = stringifyWebFvdJson(parseWebFvdJson(s1));
    expect(s2).toBe(s1);
  });
});
