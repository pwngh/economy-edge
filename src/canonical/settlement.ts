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

export interface CanonicalSettlement {
  readonly schemaVersion: 1;
  readonly providerTxnId: string;
  readonly granularity?: 'transaction' | 'sku-day';
  readonly gross: Money;
  readonly fee: Money;
  readonly net: Money;
  readonly fx?: { readonly settled: Money; readonly rate: string };
  readonly sourceRef: string;
}
