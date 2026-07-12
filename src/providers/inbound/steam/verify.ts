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

import { fault } from '../../../canonical/fault.ts';
import { money } from '../../../canonical/money.ts';
import { ok, reject } from '../../../canonical/outcome.ts';
import { steamGet, steamPost } from './api.ts';

import type {
  CanonicalPurchase,
  Outcome,
  ProductType,
  RejectReason,
} from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { RawProof } from '../../../ports/index.ts';
import type { SteamCall } from './api.ts';
import type { SteamConfig } from './config.ts';

const ALREADY_COMMITTED = 6;

const REVERSED_STATUSES = new Set([
  'Refunded',
  'PartialRefund',
  'Chargedback',
  'RefundedSuspectedFraud',
  'RefundedFriendlyFraud',
]);

export async function verifyPurchase(
  config: SteamConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<CanonicalPurchase, RejectReason>> {
  const orderId = orderIdOf(input.proof);
  let query: SteamCall;
  try {
    const finalize = await steamPost(config, doFetch, {
      path: 'FinalizeTxn/v2',
      params: { orderid: orderId },
    });
    if (finalize.result === 'failure' && finalize.errorcode !== ALREADY_COMMITTED) {
      return reject('REJECTED');
    }
    query = await steamGet(config, doFetch, {
      path: 'QueryTxn/v3',
      params: { orderid: orderId },
    });
  } catch (error) {
    return retryableReject(error);
  }
  if (query.result === 'failure') {
    return reject('REJECTED');
  }
  return purchaseOf(config, query.params);
}

function purchaseOf(
  config: SteamConfig,
  params: Readonly<Record<string, unknown>>,
): Outcome<CanonicalPurchase, RejectReason> {
  const status = String(params.status ?? '');
  if (REVERSED_STATUSES.has(status)) {
    return reject('ALREADY_SETTLED');
  }
  if (status === 'Init' || status === 'Approved') {
    return reject('RETRYABLE');
  }
  if (status !== 'Succeeded') {
    return reject('REJECTED');
  }
  const transId = idOf(params.transid);
  const currency = String(params.currency ?? '');
  const items = Array.isArray(params.items) ? params.items : [];
  const firstItem = items[0] as { itemid?: unknown } | undefined;
  return ok({
    schemaVersion: 1,
    provider: 'steam',
    providerTxnId: transId,
    providerSku: idOf(firstItem?.itemid),
    productType: productTypeOf(config, firstItem?.itemid),
    amount: money(currency, totalOf(items)),
    occurredAt: String(params.time ?? ''),
    sourceRef: `steam:txn:${transId}`,
  });
}

function productTypeOf(config: SteamConfig, itemId: unknown): ProductType {
  if (config.productTypeOf === undefined) {
    return 'CONSUMABLE';
  }
  return config.productTypeOf(idOf(itemId));
}

export function totalOf(items: unknown[]): bigint {
  let total = 0n;
  for (const item of items) {
    const amount = (item as { amount?: unknown } | null)?.amount;
    if (typeof amount === 'number' && Number.isInteger(amount)) {
      total += BigInt(amount);
    } else if (typeof amount === 'string' && /^\d+$/.test(amount)) {
      total += BigInt(amount);
    } else {
      throw fault('STEAM.MALFORMED_RESPONSE', 'A Steam item amount is not an integer.', {
        detail: { amount },
      });
    }
  }
  return total;
}

export function idOf(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  throw fault('STEAM.MALFORMED_RESPONSE', 'A Steam id is missing or unsafe to read.', {
    detail: { value },
  });
}

function orderIdOf(proof: unknown): string {
  if (proof !== null && typeof proof === 'object') {
    const orderId = (proof as { orderId?: unknown }).orderId;
    if (typeof orderId === 'string' && /^\d+$/.test(orderId)) {
      return orderId;
    }
  }
  throw fault('STEAM.MALFORMED_PROOF', 'A Steam proof must carry orderId as a decimal string.', {
    detail: { proof },
  });
}

function retryableReject(error: unknown): { readonly ok: false; readonly reason: RejectReason } {
  if (error instanceof Error && (error as { retryable?: unknown }).retryable === true) {
    return reject('RETRYABLE');
  }
  throw error;
}
