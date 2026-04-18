// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { EFuncType } from './enums.js';
import { createEmptyFunc, totalFuncLength } from './function.js';
import { createLinearSubFunc } from './subfunction.js';

describe('Func', () => {
  it('createEmptyFunc returns an unlocked Func with no subfuncs', () => {
    const f = createEmptyFunc(EFuncType.Roll, 'Roll');
    expect(f.kind).toBe(EFuncType.Roll);
    expect(f.name).toBe('Roll');
    expect(f.locked).toBe(false);
    expect(f.subfuncs).toEqual([]);
  });

  it('totalFuncLength sums subfunc lengths', () => {
    const f = createEmptyFunc(EFuncType.Roll);
    f.subfuncs.push(createLinearSubFunc({ length: 3, startValue: 0, endValue: 1 }));
    f.subfuncs.push(createLinearSubFunc({ length: 5, startValue: 1, endValue: 2 }));
    expect(totalFuncLength(f)).toBe(8);
  });
});
