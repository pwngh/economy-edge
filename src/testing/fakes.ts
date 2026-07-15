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

import { unrecognizedPayoutEvent } from '../canonical/events.ts';
import { moneyFromDecimal } from '../canonical/money.ts';
import { ok } from '../canonical/outcome.ts';

import type {
  CanonicalPurchase,
  CanonicalSettlement,
} from '../canonical/index.ts';
import type { InboundProvider, OutboundProvider } from '../ports/index.ts';

export function samplePurchase(
  overrides: Partial<CanonicalPurchase> = {},
): CanonicalPurchase {
  return {
    schemaVersion: 1,
    provider: 'steam',
    providerTxnId: 'txn-1',
    providerSku: 'sku-gold-pack',
    productType: 'CONSUMABLE',
    amount: moneyFromDecimal('4.99', 'USD'),
    occurredAt: '2026-07-09T00:00:00Z',
    sourceRef: 'sha256:sample',
    ...overrides,
  };
}

export function sampleSettlement(
  overrides: Partial<CanonicalSettlement> = {},
): CanonicalSettlement {
  return {
    schemaVersion: 1,
    providerTxnId: 'txn-1',
    gross: moneyFromDecimal('4.99', 'USD'),
    fee: moneyFromDecimal('0.49', 'USD'),
    net: moneyFromDecimal('4.50', 'USD'),
    sourceRef: 'sha256:sample',
    ...overrides,
  };
}

export function fakeInbound(
  overrides: Partial<InboundProvider> = {},
): InboundProvider {
  return {
    provider: 'steam',
    verify: async () => ok(samplePurchase()),
    status: async () => ({ state: 'SETTLED' }),
    report: async () => [],
    ...overrides,
  };
}

export function fakeOutbound(
  overrides: Partial<OutboundProvider> = {},
): OutboundProvider {
  return {
    provider: 'tilia',
    submit: async () => ({
      outcome: 'ACCEPTED',
      ref: { provider: 'tilia', id: 'payout-1' },
    }),
    status: async () => ({ state: 'SETTLED' }),
    report: async () => ({
      disbursements: [],
      walletBalance: moneyFromDecimal('0.00', 'USD'),
    }),
    verify: async () => true,
    parse: (webhook) => [unrecognizedPayoutEvent('tilia', webhook)],
    balance: async () => moneyFromDecimal('0.00', 'USD'),
    ...overrides,
  };
}
