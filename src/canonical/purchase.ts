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

import type { ProviderId } from './ids.ts';
import type { Money } from './money.ts';

export type ProductType = 'CONSUMABLE' | 'NON_CONSUMABLE';

export interface CanonicalPurchase {
  readonly schemaVersion: 1;
  readonly provider: ProviderId;
  readonly providerTxnId: string;
  readonly providerSku: string;
  readonly productType: ProductType;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly sourceRef: string;
}

export interface InboundQuery {
  readonly provider: ProviderId;
  readonly providerTxnId: string;
}

export interface PurchaseStatus {
  readonly state: 'SETTLED' | 'PENDING' | 'FAILED' | 'UNKNOWN';
}
