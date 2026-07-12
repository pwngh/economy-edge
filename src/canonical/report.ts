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

import type { Money } from './money.ts';
import type { CanonicalSettlement } from './settlement.ts';

export interface PayoutReport {
  readonly disbursements: readonly CanonicalSettlement[];
  readonly walletBalance: Money;
}
