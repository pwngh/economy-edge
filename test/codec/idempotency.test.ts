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

import { hasCode } from '#src/canonical/fault.ts';
import { callerKey } from '#src/codec/idempotency.ts';

describe('callerKey', () => {
  test('threads the caller key through unchanged', () => {
    assert.equal(callerKey('saga-123'), 'saga-123');
  });

  test('refuses to mint a key when the caller supplies none', () => {
    const cases = [undefined, null, '', '   ', 42];

    for (const missing of cases) {
      assert.throws(
        () => callerKey(missing),
        (error: unknown) => hasCode(error, 'CODEC.KEY_REQUIRED'),
      );
    }
  });
});
