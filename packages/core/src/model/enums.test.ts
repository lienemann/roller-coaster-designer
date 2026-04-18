// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import {
  DEGREE_NAMES,
  EDegree,
  EFuncType,
  FUNC_TYPE_NAMES,
  SEC_TYPE_NAMES,
  SecType,
  TRACK_STYLE_NAMES,
  TrackStyle,
} from './enums.js';

describe('enums — FVD++ 0.79 numeric parity', () => {
  it('SecType uses the legacy numeric values from core/section.h', () => {
    // If any of these change, the .fvd reader/writer (M9) and NL2 export
    // (M10) both break. Pin explicitly.
    expect(SecType.Anchor).toBe(0);
    expect(SecType.Straight).toBe(1);
    expect(SecType.Curved).toBe(2);
    expect(SecType.Forced).toBe(3);
    expect(SecType.Geometric).toBe(4);
    expect(SecType.Bezier).toBe(5);
    expect(SecType.NoLimitsCSV).toBe(6);
  });

  it('EDegree uses the legacy values from core/subfunction.h', () => {
    expect(EDegree.Linear).toBe(0);
    expect(EDegree.Freeform).toBe(8);
  });

  it('EFuncType uses the legacy values from core/function.h', () => {
    expect(EFuncType.Roll).toBe(0);
    expect(EFuncType.Yaw).toBe(4);
  });

  it('TrackStyle uses the legacy values from core/track.h', () => {
    expect(TrackStyle.Generic).toBe(0);
    expect(TrackStyle.DoubleSpine).toBe(7);
  });

  it('name tables cover every enum value', () => {
    for (const v of Object.values(SecType).filter((v) => typeof v === 'number')) {
      expect(SEC_TYPE_NAMES[v as SecType]).toBeDefined();
    }
    for (const v of Object.values(EDegree).filter((v) => typeof v === 'number')) {
      expect(DEGREE_NAMES[v as EDegree]).toBeDefined();
    }
    for (const v of Object.values(EFuncType).filter((v) => typeof v === 'number')) {
      expect(FUNC_TYPE_NAMES[v as EFuncType]).toBeDefined();
    }
    for (const v of Object.values(TrackStyle).filter((v) => typeof v === 'number')) {
      expect(TRACK_STYLE_NAMES[v as TrackStyle]).toBeDefined();
    }
  });
});
