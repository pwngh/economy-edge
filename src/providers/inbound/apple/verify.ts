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
import { currencyExponent, money, mulDiv } from '../../../canonical/money.ts';
import { ok, reject } from '../../../canonical/outcome.ts';
import { decodeJwsPayload } from '../../../codec/jwt.ts';
import { requestJson } from '../../transport.ts';
import { appleHost, appleJwt } from './auth.ts';

import type {
  CanonicalPurchase,
  Money,
  Outcome,
  ProductType,
  RejectReason,
} from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { RawProof } from '../../../ports/index.ts';
import type { AppleConfig } from './config.ts';

const PRODUCT_TYPE_BY_APPLE_TYPE: Readonly<Record<string, ProductType>> = {
  Consumable: 'CONSUMABLE',
  'Non-Consumable': 'NON_CONSUMABLE',
};

export async function verifyPurchase(
  config: AppleConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<CanonicalPurchase, RejectReason>> {
  const transactionId = transactionIdOf(input.proof);
  let payload: Record<string, unknown> | null;
  try {
    payload = await fetchTransaction(config, doFetch, transactionId);
  } catch (error) {
    return retryableReject(error);
  }
  if (payload === null) {
    return reject('REJECTED');
  }
  if (payload.revocationDate !== undefined) {
    return reject('ALREADY_SETTLED');
  }
  const productType = PRODUCT_TYPE_BY_APPLE_TYPE[String(payload.type ?? '')];
  if (productType === undefined) {
    return reject('REJECTED');
  }
  return ok(canonicalize(transactionId, payload, productType));
}

export async function fetchTransaction(
  config: AppleConfig,
  doFetch: FetchLike,
  transactionId: string,
): Promise<Record<string, unknown> | null> {
  const token = await appleJwt(config);
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${appleHost(config.environment)}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return null;
  }
  if (response.status === 401) {
    throw fault('APPLE.AUTH_REJECTED', 'Apple rejected the App Store Server API token.', {
      detail: { body: response.text },
    });
  }
  if (!response.ok) {
    throw fault('APPLE.VERIFY_FAILED', `Apple returned a ${response.status} status.`, {
      retryable: response.status === 429 || response.status >= 500,
      detail: { status: response.status },
    });
  }
  const signed = (response.body as { signedTransactionInfo?: unknown } | null)
    ?.signedTransactionInfo;
  const payload = decodeJwsPayload(signed);
  if (payload === null || typeof payload !== 'object') {
    throw fault('APPLE.MALFORMED_RESPONSE', 'The signed transaction payload did not decode.', {
      retryable: true,
    });
  }
  return payload as Record<string, unknown>;
}

function canonicalize(
  transactionId: string,
  payload: Record<string, unknown>,
  productType: ProductType,
): CanonicalPurchase {
  if (typeof payload.price !== 'number' || typeof payload.currency !== 'string') {
    throw fault('APPLE.PRICE_MISSING', 'The transaction payload carries no price and currency.', {
      detail: { transactionId },
    });
  }
  return {
    schemaVersion: 1,
    provider: 'apple',
    providerTxnId: transactionId,
    providerSku: String(payload.productId ?? ''),
    productType,
    amount: amountFromMilliunits(payload.price, payload.currency),
    occurredAt: new Date(Number(payload.purchaseDate ?? 0)).toISOString(),
    sourceRef: `apple:txn:${transactionId}`,
  };
}

export function amountFromMilliunits(price: number, currency: string): Money {
  const scale = 10n ** BigInt(currencyExponent(currency));
  return money(currency, mulDiv(BigInt(price), scale, 1000n, 'trunc'));
}

function transactionIdOf(proof: unknown): string {
  if (proof !== null && typeof proof === 'object') {
    const transactionId = (proof as { transactionId?: unknown }).transactionId;
    if (typeof transactionId === 'string' && transactionId.length > 0) {
      return transactionId;
    }
  }
  throw fault('APPLE.MALFORMED_PROOF', 'An Apple proof must carry transactionId.', {
    detail: { proof },
  });
}

function retryableReject(error: unknown): { readonly ok: false; readonly reason: RejectReason } {
  if (error instanceof Error && (error as { retryable?: unknown }).retryable === true) {
    return reject('RETRYABLE');
  }
  throw error;
}
