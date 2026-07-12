/**
 * @pwngh/economy-edge
 *
 * Copyright (c) Preston Neal
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ok, reject } from '#src/canonical/outcome.ts';

describe('Outcome', () => {
  test('wraps a value as an ok outcome', () => {
    assert.deepEqual(ok(42), { ok: true, value: 42 });
  });

  test('wraps a reason as a value, never a throw', () => {
    assert.deepEqual(reject('FORGED'), { ok: false, reason: 'FORGED' });
  });
});
