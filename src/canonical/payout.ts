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

import type { PayoutRef } from './ids.ts';
import type { Money } from './money.ts';

export interface PayoutRequest {
  readonly key: string;
  readonly payee: string;
  readonly amount: Money;
}

export type RejectReason =
  'FORGED' | 'ALREADY_SETTLED' | 'PAYEE_UNVERIFIED' | 'RETRYABLE' | 'REJECTED';

export type PayoutResult =
  | { readonly outcome: 'ACCEPTED'; readonly ref: PayoutRef }
  | { readonly outcome: 'REJECTED'; readonly reason: RejectReason }
  | { readonly outcome: 'INDETERMINATE'; readonly retryable: true };

export type PayoutQuery = { readonly key: string } | { readonly ref: PayoutRef };

export interface PayoutStatus {
  readonly state: 'SETTLED' | 'RETURNED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
}

export interface PayeeStatus {
  readonly state: 'CLEARED' | 'PENDING' | 'BLOCKED' | 'NONE';
}
