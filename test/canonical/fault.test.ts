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

import { fault, hasCode } from '#src/canonical/fault.ts';

describe('fault', () => {
  test('carries a stable code, a retryable flag, and detail', () => {
    const error = fault('EDGE.EXAMPLE', 'Something specific happened.', {
      retryable: true,
      detail: { step: 'example' },
    });

    assert.equal(error.code, 'EDGE.EXAMPLE');
    assert.equal(error.retryable, true);
    assert.deepEqual(error.detail, { step: 'example' });
    assert.equal(error.message, 'Something specific happened.');
  });

  test('defaults to terminal with empty detail', () => {
    const error = fault('EDGE.EXAMPLE', 'Something specific happened.');

    assert.equal(error.retryable, false);
    assert.deepEqual(error.detail, {});
  });

  test('hasCode matches only errors carrying that code', () => {
    const error = fault('EDGE.EXAMPLE', 'Something specific happened.');

    assert.equal(hasCode(error, 'EDGE.EXAMPLE'), true);
    assert.equal(hasCode(error, 'EDGE.OTHER'), false);
    assert.equal(hasCode('EDGE.EXAMPLE', 'EDGE.EXAMPLE'), false);
  });
});
