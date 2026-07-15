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
import { unrecognizedEvent } from '../canonical/events.ts';

import type {
  CanonicalEvent,
  CanonicalPayoutEvent,
  CanonicalPurchase,
  CanonicalSettlement,
  InboundQuery,
  Money,
  Outcome,
  PayoutQuery,
  PayoutRef,
  PayoutReport,
  PayoutRequest,
  PayoutResult,
  PayoutStatus,
  ProviderId,
  PurchaseStatus,
  RejectReason,
  Window,
} from '../canonical/index.ts';
import type {
  InboundProvider,
  OutboundProvider,
  PayeePort,
  RawProof,
  RawWebhook,
} from '../ports/index.ts';

export interface EdgeInbound {
  verify(input: RawProof): Promise<Outcome<CanonicalPurchase, RejectReason>>;
  fulfill(input: RawProof): Promise<Outcome<void, RejectReason>>;
  status(query: InboundQuery): Promise<PurchaseStatus>;
  report(window: Window): Promise<CanonicalSettlement[]>;
  parse(webhook: RawWebhook): CanonicalEvent[];
}

export interface EdgeOutbound {
  submit(request: PayoutRequest): Promise<PayoutResult>;
  status(query: PayoutQuery): Promise<PayoutStatus>;
  report(window: Window): Promise<PayoutReport>;
  verify(webhook: RawWebhook): Promise<boolean>;
  parse(webhook: RawWebhook): CanonicalPayoutEvent[];
  balance(): Promise<Money>;
  payee: PayeePort;
  cancel(ref: PayoutRef): Promise<Outcome<void, RejectReason>>;
}

export interface Edge {
  readonly inbound: EdgeInbound;
  readonly outbound: EdgeOutbound;
}

export function compose(adapters: {
  inbound?: InboundProvider[];
  outbound?: OutboundProvider[];
}): Edge {
  return {
    inbound: composeInbound(registry(adapters.inbound ?? [])),
    outbound: composeOutbound(registry(adapters.outbound ?? [])),
  };
}

function registry<T extends { provider: ProviderId }>(
  adapters: T[],
): Map<ProviderId, T> {
  const byProvider = new Map<ProviderId, T>();
  for (const adapter of adapters) {
    if (byProvider.has(adapter.provider)) {
      throw fault(
        'CODEC.DUPLICATE_PROVIDER',
        `The provider '${adapter.provider}' is registered twice.`,
        { detail: { provider: adapter.provider } },
      );
    }
    byProvider.set(adapter.provider, adapter);
  }
  return byProvider;
}

function pick<T>(byProvider: Map<ProviderId, T>, provider: ProviderId): T {
  const adapter = byProvider.get(provider);
  if (adapter === undefined) {
    throw fault(
      'CODEC.UNKNOWN_PROVIDER',
      `No adapter is registered for the provider '${provider}'.`,
      { detail: { provider } },
    );
  }
  return adapter;
}

function composeInbound(
  byProvider: Map<ProviderId, InboundProvider>,
): EdgeInbound {
  return {
    verify: async (input) => pick(byProvider, input.provider).verify(input),
    fulfill: async (input) => {
      const adapter = pick(byProvider, input.provider);
      if (adapter.fulfill === undefined) {
        throw fault(
          'CODEC.UNSUPPORTED',
          `The provider '${input.provider}' does not support fulfill.`,
          { detail: { provider: input.provider } },
        );
      }
      return adapter.fulfill(input);
    },
    status: async (query) => pick(byProvider, query.provider).status(query),
    report: async (window) => {
      const reporters = [...byProvider.values()].filter(
        (adapter) => adapter.report !== undefined,
      );
      const settlements = await Promise.all(
        reporters.map((adapter) => adapter.report!(window)),
      );
      return settlements.flat();
    },
    parse: (webhook) => {
      const adapter = pick(byProvider, webhook.provider);
      if (adapter.parse === undefined) {
        return [unrecognizedEvent(webhook.provider, webhook)];
      }
      return adapter.parse(webhook);
    },
  };
}

function composeOutbound(
  byProvider: Map<ProviderId, OutboundProvider>,
): EdgeOutbound {
  const sole = (): OutboundProvider => soleOutbound(byProvider);
  return {
    submit: async (request) => sole().submit(request),
    status: async (query) =>
      'ref' in query
        ? pick(byProvider, query.ref.provider).status(query)
        : sole().status(query),
    report: async (window) => sole().report(window),
    verify: async (webhook) =>
      pick(byProvider, webhook.provider).verify(webhook),
    parse: (webhook) => pick(byProvider, webhook.provider).parse(webhook),
    balance: async () => sole().balance(),
    payee: {
      status: async (query) => requirePayee(sole()).status(query),
      onboard: async (query) => requirePayee(sole()).onboard(query),
    },
    cancel: async (ref) => {
      const adapter = pick(byProvider, ref.provider);
      if (adapter.cancel === undefined) {
        throw fault(
          'CODEC.UNSUPPORTED',
          `The provider '${ref.provider}' does not support cancel.`,
          { detail: { provider: ref.provider } },
        );
      }
      return adapter.cancel(ref);
    },
  };
}

function soleOutbound(
  byProvider: Map<ProviderId, OutboundProvider>,
): OutboundProvider {
  const adapters = [...byProvider.values()];
  if (adapters.length === 1) {
    return adapters[0]!;
  }
  if (adapters.length === 0) {
    throw fault('CODEC.NO_OUTBOUND', 'No outbound provider is registered.');
  }
  throw fault(
    'CODEC.AMBIGUOUS_OUTBOUND',
    'Several outbound providers are registered; address one by its PayoutRef.',
    { detail: { providers: adapters.map((adapter) => adapter.provider) } },
  );
}

function requirePayee(adapter: OutboundProvider): PayeePort {
  if (adapter.payee === undefined) {
    throw fault(
      'CODEC.UNSUPPORTED',
      `The provider '${adapter.provider}' does not host payee onboarding.`,
      { detail: { provider: adapter.provider } },
    );
  }
  return adapter.payee;
}
