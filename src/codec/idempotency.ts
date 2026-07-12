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

import { fault } from '../canonical/fault.ts';

export function callerKey(key: unknown): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw fault(
      'CODEC.KEY_REQUIRED',
      'The caller must supply its own idempotency key; the codec never mints one.',
    );
  }
  return key;
}
