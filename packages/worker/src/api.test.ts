// SPDX-License-Identifier: GPL-3.0-only
import { describe, expectTypeOf, it } from 'vitest';

import { type PhysicsWorkerApi } from './api.types.js';

describe('PhysicsWorkerApi shape', () => {
  it('ping is an async identity on numbers', () => {
    expectTypeOf<PhysicsWorkerApi['ping']>().toEqualTypeOf<(value: number) => Promise<number>>();
  });
});
