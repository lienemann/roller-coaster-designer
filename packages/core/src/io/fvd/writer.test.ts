// SPDX-License-Identifier: AGPL-3.0-only

// Round-trip tests for the FVD writer: build a Project in TypeScript,
// serialise it with `writeFvd`, parse it back with `parseFvd`, and
// assert the result equals the input (modulo the lossy fields documented
// on `writeFvd`). The test catalogue exercises every section type and
// the closure-expansion path.

import { describe, expect, it } from 'vitest';

import {
  Argument,
  EDegree,
  EFuncType,
  Orientation,
  SecType,
  TrackStyle,
} from '../../model/enums.js';
import { createEmptyFunc, type Func } from '../../model/function.js';
import { type Project } from '../../model/project.js';
import {
  type AnchorSection,
  type BezierSection,
  type ClosureSection,
  type CurvedSection,
  type ForcedSection,
  type GeometricSection,
  type Section,
  type StraightSection,
} from '../../model/section.js';
import { createLinearSubFunc } from '../../model/subfunction.js';
import { closeTrack } from '../../ops/close-track.js';

import { parseFvd } from './reader.js';
import { writeFvd } from './writer.js';

function emptyRollFunc(length: number): Func {
  const f = createEmptyFunc(EFuncType.Roll, 'Roll');
  f.subfuncs.push(createLinearSubFunc({ length, startValue: 0, endValue: 0 }));
  return f;
}

function makeAnchor(): AnchorSection {
  return {
    type: SecType.Anchor,
    name: 'Anchor',
    position: [10, 20, 30],
    pitch: 0.1,
    yaw: 0.2,
    roll: 0,
    speed: 12.5,
  };
}

function wrapProject(sections: Section[], heart = 1.1): Project {
  return {
    texturePath: '',
    tracks: [
      {
        name: 'Test track',
        style: TrackStyle.Generic,
        heart,
        friction: 0.021,
        resistance: 1e-5,
        sections,
        smoothers: [],
      },
    ],
  };
}

/** Convenience: round-trip a project through the writer and reader. */
function roundtrip(project: Project): Project {
  const bytes = writeFvd(project);
  return parseFvd(bytes).project;
}

describe('writeFvd — round-trip', () => {
  it('writes an empty project', () => {
    const bytes = writeFvd({ texturePath: 'tex.png', tracks: [] });
    const out = parseFvd(bytes);
    expect(out.version).toBe('v0.77');
    expect(out.project.texturePath).toBe('tex.png');
    expect(out.project.tracks).toEqual([]);
  });

  it('round-trips an anchor + Straight', () => {
    const project = wrapProject([
      makeAnchor(),
      {
        type: SecType.Straight,
        name: 'Run 1',
        length: 42.5,
        rollFunc: emptyRollFunc(42.5),
      } satisfies StraightSection,
    ]);
    const out = roundtrip(project);
    const t = out.tracks[0]!;
    expect(t.name).toBe('Test track');
    expect(t.sections).toHaveLength(2);
    const anchor = t.sections[0]!;
    expect(anchor.type).toBe(SecType.Anchor);
    if (anchor.type !== SecType.Anchor) return;
    expect(anchor.position[0]).toBeCloseTo(10, 4);
    expect(anchor.position[1]).toBeCloseTo(20, 4);
    expect(anchor.position[2]).toBeCloseTo(30, 4);
    expect(anchor.pitch).toBeCloseTo(0.1, 4);
    expect(anchor.yaw).toBeCloseTo(0.2, 4);
    expect(anchor.speed).toBeCloseTo(12.5, 4);
    const straight = t.sections[1]!;
    expect(straight.type).toBe(SecType.Straight);
    if (straight.type !== SecType.Straight) return;
    expect(straight.length).toBeCloseTo(42.5, 4);
    expect(straight.name).toBe('Run 1');
  });

  it('round-trips a pure-yaw Curved (level turn)', () => {
    const length = 20;
    const yawRate = Math.PI / 2 / length;
    const project = wrapProject([
      makeAnchor(),
      {
        type: SecType.Curved,
        name: 'Turn',
        length,
        pitchRate: 0,
        yawRate,
        leadIn: 0,
        leadOut: 0,
        rollFunc: emptyRollFunc(length),
      } satisfies CurvedSection,
    ]);
    const out = roundtrip(project);
    const curved = out.tracks[0]!.sections[1]!;
    expect(curved.type).toBe(SecType.Curved);
    if (curved.type !== SecType.Curved) return;
    expect(curved.length).toBeCloseTo(length, 3);
    expect(curved.yawRate).toBeCloseTo(yawRate, 5);
    expect(curved.pitchRate).toBeCloseTo(0, 5);
  });

  it('round-trips a Forced section', () => {
    const normalFunc = createEmptyFunc(EFuncType.Normal, 'Normal');
    normalFunc.subfuncs.push(createLinearSubFunc({ length: 2, startValue: 1.5, endValue: 1.5 }));
    const lateralFunc = createEmptyFunc(EFuncType.Lateral, 'Lateral');
    lateralFunc.subfuncs.push(createLinearSubFunc({ length: 2, startValue: 0, endValue: 0 }));
    const project = wrapProject([
      makeAnchor(),
      {
        type: SecType.Forced,
        name: 'Push',
        argument: Argument.Time,
        orientation: Orientation.Euler,
        extent: 2,
        rollFunc: emptyRollFunc(2),
        normalFunc,
        lateralFunc,
      } satisfies ForcedSection,
    ]);
    const out = roundtrip(project);
    const forced = out.tracks[0]!.sections[1]!;
    expect(forced.type).toBe(SecType.Forced);
    if (forced.type !== SecType.Forced) return;
    expect(forced.argument).toBe(Argument.Time);
    expect(forced.orientation).toBe(Orientation.Euler);
    expect(forced.extent).toBeCloseTo(2, 3);
    expect(forced.normalFunc.subfuncs[0]!.startValue).toBeCloseTo(1.5, 4);
  });

  it('round-trips a Geometric section', () => {
    const length = 8;
    const pitchFunc = createEmptyFunc(EFuncType.Pitch, 'Pitch');
    pitchFunc.subfuncs.push(
      createLinearSubFunc({ length, startValue: 0, endValue: (Math.PI / 6) }),
    );
    const yawFunc = createEmptyFunc(EFuncType.Yaw, 'Yaw');
    yawFunc.subfuncs.push(createLinearSubFunc({ length, startValue: 0, endValue: 0 }));
    const project = wrapProject([
      makeAnchor(),
      {
        type: SecType.Geometric,
        name: 'Geo',
        argument: Argument.Distance,
        extent: length,
        rollFunc: emptyRollFunc(length),
        pitchFunc,
        yawFunc,
      } satisfies GeometricSection,
    ]);
    const out = roundtrip(project);
    const geo = out.tracks[0]!.sections[1]!;
    expect(geo.type).toBe(SecType.Geometric);
    if (geo.type !== SecType.Geometric) return;
    expect(geo.argument).toBe(Argument.Distance);
    expect(geo.extent).toBeCloseTo(length, 3);
    expect(geo.pitchFunc.subfuncs[0]!.endValue).toBeCloseTo(Math.PI / 6, 4);
  });

  it('round-trips a Bezier section preserving all four control points', () => {
    const cp: BezierSection['controlPoints'] = [
      [0, 10, 0],
      [5, 15, 1],
      [10, 12, 2],
      [15, 10, 0],
    ];
    const project = wrapProject([
      makeAnchor(),
      {
        type: SecType.Bezier,
        name: 'Bend',
        controlPoints: cp,
        rollFunc: emptyRollFunc(20),
        smoothStart: false,
        smoothEnd: false,
      } satisfies BezierSection,
    ]);
    const out = roundtrip(project);
    const bez = out.tracks[0]!.sections[1]!;
    expect(bez.type).toBe(SecType.Bezier);
    if (bez.type !== SecType.Bezier) return;
    for (let i = 0; i < 4; i += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(bez.controlPoints[i]![axis]).toBeCloseTo(cp[i]![axis], 4);
      }
    }
  });

  it('round-trips a multi-subfunc rollFunc', () => {
    const f = createEmptyFunc(EFuncType.Roll, 'Roll');
    f.subfuncs.push(createLinearSubFunc({ length: 10, startValue: 0, endValue: 0 }));
    f.subfuncs.push({
      degree: EDegree.Cubic,
      length: 15,
      startValue: 0,
      endValue: Math.PI,
      arg1: 0,
      centerArg: 0,
      tensionArg: 0,
    });
    f.subfuncs.push(createLinearSubFunc({ length: 5, startValue: 0, endValue: 0 }));
    const project = wrapProject([
      makeAnchor(),
      {
        type: SecType.Straight,
        name: 'Roll-ramp',
        length: 30,
        rollFunc: f,
      } satisfies StraightSection,
    ]);
    const out = roundtrip(project);
    const straight = out.tracks[0]!.sections[1]!;
    if (straight.type !== SecType.Straight) throw new Error('not Straight');
    expect(straight.rollFunc.subfuncs).toHaveLength(3);
    expect(straight.rollFunc.subfuncs[0]!.length).toBeCloseTo(10, 4);
    expect(straight.rollFunc.subfuncs[0]!.degree).toBe(EDegree.Linear);
    expect(straight.rollFunc.subfuncs[1]!.length).toBeCloseTo(15, 4);
    expect(straight.rollFunc.subfuncs[1]!.degree).toBe(EDegree.Cubic);
    expect(straight.rollFunc.subfuncs[1]!.endValue).toBeCloseTo(Math.PI, 4);
    expect(straight.rollFunc.subfuncs[2]!.length).toBeCloseTo(5, 4);
  });

  it('materialises Closure as a regular Bezier on disk', () => {
    // A closed track: anchor + straight + closure.
    const open = wrapProject([
      makeAnchor(),
      {
        type: SecType.Straight,
        name: 'Out',
        length: 20,
        rollFunc: emptyRollFunc(20),
      } satisfies StraightSection,
    ]);
    const closed = {
      ...open,
      tracks: [closeTrack(open.tracks[0]!)],
    };
    expect(
      closed.tracks[0]!.sections[closed.tracks[0]!.sections.length - 1]!.type,
    ).toBe(SecType.Closure);

    const out = roundtrip(closed);
    // The closure round-trips as a Bezier — FVD++ has no closure concept.
    const sections = out.tracks[0]!.sections;
    const last = sections[sections.length - 1]!;
    expect(last.type).toBe(SecType.Bezier);
    if (last.type !== SecType.Bezier) return;
    // p3 should be at the anchor position (within float32 precision).
    expect(last.controlPoints[3][0]).toBeCloseTo(10, 2);
    expect(last.controlPoints[3][1]).toBeCloseTo(20, 2);
    expect(last.controlPoints[3][2]).toBeCloseTo(30, 2);
  });
});

describe('writeFvd — bit-level cues', () => {
  it('emits the FVD magic and v0.77 version', () => {
    const bytes = writeFvd({ texturePath: '', tracks: [] });
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!)).toBe('FVD');
    expect(String.fromCharCode(bytes[3]!, bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!)).toBe(
      'v0.77',
    );
  });

  it('ends the file with EOP', () => {
    const bytes = writeFvd({ texturePath: '', tracks: [] });
    const tail = String.fromCharCode(
      bytes[bytes.byteLength - 3]!,
      bytes[bytes.byteLength - 2]!,
      bytes[bytes.byteLength - 1]!,
    );
    expect(tail).toBe('EOP');
  });
});

// Convenience type-only no-op so the import isn't tree-shaken before
// type-checking; the helper above uses ClosureSection's structural shape
// via closeTrack().
void (null as unknown as ClosureSection);
