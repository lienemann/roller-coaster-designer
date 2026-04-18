// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EFuncType, SecType } from './enums.js';
import { createEmptyFunc } from './function.js';
import { type AnchorSection, type StraightSection, isAnchor } from './section.js';

describe('Section discriminated union', () => {
  it('isAnchor narrows to AnchorSection', () => {
    const anchor: AnchorSection = {
      type: SecType.Anchor,
      name: 'Anchor',
      position: [0, 10, 0],
      pitch: 0,
      yaw: 0,
      roll: 0,
      speed: 12.5,
    };
    const straight: StraightSection = {
      type: SecType.Straight,
      name: 'S',
      length: 20,
      rollFunc: createEmptyFunc(EFuncType.Roll),
    };

    expect(isAnchor(anchor)).toBe(true);
    expect(isAnchor(straight)).toBe(false);
  });
});
