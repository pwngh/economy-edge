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

import { moneyFromDecimal } from '#src/canonical/money.ts';

import type { Money } from '#src/canonical/index.ts';

export { fakeInbound, fakeOutbound, samplePurchase, sampleSettlement } from '#src/testing/index.ts';

export function usd(decimal: string): Money {
  return moneyFromDecimal(decimal, 'USD');
}
