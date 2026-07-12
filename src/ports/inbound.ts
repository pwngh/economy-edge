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
  CanonicalEvent,
  CanonicalPurchase,
  CanonicalSettlement,
  InboundQuery,
  Outcome,
  ProviderId,
  PurchaseStatus,
  RejectReason,
  Window,
} from '../canonical/index.ts';
import type { RawProof, RawWebhook } from './raw.ts';

export interface InboundProvider {
  readonly provider: ProviderId;
  verify(input: RawProof): Promise<Outcome<CanonicalPurchase, RejectReason>>;
  fulfill?(input: RawProof): Promise<Outcome<void, RejectReason>>;
  status(query: InboundQuery): Promise<PurchaseStatus>;
  report?(window: Window): Promise<CanonicalSettlement[]>;
  parse?(webhook: RawWebhook): CanonicalEvent[];
}
