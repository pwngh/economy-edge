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

import type {
  CanonicalPayoutEvent,
  Money,
  Outcome,
  PayeeStatus,
  PayoutQuery,
  PayoutRef,
  PayoutReport,
  PayoutRequest,
  PayoutResult,
  PayoutStatus,
  ProviderId,
  RejectReason,
  Window,
} from '../canonical/index.ts';
import type { RawWebhook } from './raw.ts';

export interface PayeePort {
  status(query: { readonly userId: string }): Promise<PayeeStatus>;
  onboard(query: {
    readonly userId: string;
  }): Promise<{ readonly hostedUrl: string }>;
}

export interface OutboundProvider {
  readonly provider: ProviderId;
  submit(request: PayoutRequest): Promise<PayoutResult>;
  status(query: PayoutQuery): Promise<PayoutStatus>;
  report(window: Window): Promise<PayoutReport>;
  /**
   * Authenticates a raw webhook against the provider's configured signature
   * scheme before anything trusts its bytes. `parse` stays a pure decoder; a
   * host calls verify first and drops the callback on false. Async because
   * every real scheme digests the body.
   */
  verify(webhook: RawWebhook): Promise<boolean>;
  parse(webhook: RawWebhook): CanonicalPayoutEvent[];
  /**
   * The provider wallet's current spendable balance. Distinct from `report`
   * so a float check never fabricates an empty settlement window just to
   * read one number.
   */
  balance(): Promise<Money>;
  readonly payee?: PayeePort;
  cancel?(ref: PayoutRef): Promise<Outcome<void, RejectReason>>;
}
