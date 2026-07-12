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

import type { PayoutRef, ProviderId } from './ids.ts';
import type { Money } from './money.ts';
import type { CanonicalSettlement } from './settlement.ts';

export interface CanonicalEvent {
  readonly schemaVersion: 1;
  readonly type: 'PURCHASE' | 'REFUND' | 'CHARGEBACK' | 'Unrecognized';
  readonly provider: ProviderId;
  readonly providerTxnId?: string;
  readonly originTxnId?: string;
  readonly amount?: Money;
  readonly settlement?: CanonicalSettlement;
  readonly raw?: unknown;
}

export interface CanonicalPayoutEvent {
  readonly schemaVersion: 1;
  readonly type:
    | 'SETTLED'
    | 'RETURNED'
    | 'REVERSED'
    | 'FAILED'
    | 'PENDING'
    | 'KYC_CLEARED'
    | 'KYC_BLOCKED'
    | 'Unrecognized';
  readonly provider: ProviderId;
  readonly ref?: PayoutRef;
  readonly originTxnId?: string;
  readonly settlement?: CanonicalSettlement;
  readonly payee?: string;
  readonly failureCode?: string;
  readonly failureReason?: string;
  readonly raw?: unknown;
}

export function unrecognizedEvent(provider: ProviderId, raw: unknown): CanonicalEvent {
  return { schemaVersion: 1, type: 'Unrecognized', provider, raw };
}

export function unrecognizedPayoutEvent(provider: ProviderId, raw: unknown): CanonicalPayoutEvent {
  return { schemaVersion: 1, type: 'Unrecognized', provider, raw };
}
