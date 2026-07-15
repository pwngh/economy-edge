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
import { ok, reject } from '../../../canonical/outcome.ts';
import { requestJson } from '../../transport.ts';
import { accessToken, purchaseUrl } from './auth.ts';

import type {
  CanonicalPurchase,
  Outcome,
  RejectReason,
} from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { RawProof } from '../../../ports/index.ts';
import type { GoogleConfig } from './config.ts';

const PURCHASED = 0;
const PENDING = 2;
const UNACKNOWLEDGED = 0;

interface GoogleProof {
  readonly productId: string;
  readonly purchaseToken: string;
}

export async function verifyPurchase(
  config: GoogleConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<CanonicalPurchase, RejectReason>> {
  const proof = narrowProof(input.proof);
  try {
    const token = await accessToken(config, doFetch);
    const purchase = await fetchPurchase(config, doFetch, { token, proof });
    if (purchase === null) {
      return reject('REJECTED');
    }
    if (purchase.purchaseState === PENDING) {
      return reject('RETRYABLE');
    }
    if (purchase.purchaseState !== PURCHASED) {
      return reject('REJECTED');
    }
    if (purchase.acknowledgementState === UNACKNOWLEDGED) {
      const claimed = await acknowledge(config, doFetch, { token, proof });
      if (!claimed) {
        return reject('RETRYABLE');
      }
    }
    return ok(canonicalize(config, proof, purchase));
  } catch (error) {
    return retryableReject(error);
  }
}

export async function fulfillPurchase(
  config: GoogleConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<void, RejectReason>> {
  const proof = narrowProof(input.proof);
  try {
    const token = await accessToken(config, doFetch);
    const response = await requestJson(doFetch, {
      method: 'POST',
      url: `${purchaseUrl(config, {
        productId: proof.productId,
        token: proof.purchaseToken,
      })}:consume`,
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return ok(undefined);
    }
    if (response.status === 429 || response.status >= 500) {
      return reject('RETRYABLE');
    }
    return reject('REJECTED');
  } catch (error) {
    return retryableReject(error);
  }
}

interface ProductPurchase {
  readonly purchaseState: number;
  readonly acknowledgementState: number;
  readonly orderId: string;
  readonly purchaseTimeMillis: string;
}

async function fetchPurchase(
  config: GoogleConfig,
  doFetch: FetchLike,
  call: { token: string; proof: GoogleProof },
): Promise<ProductPurchase | null> {
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: purchaseUrl(config, {
      productId: call.proof.productId,
      token: call.proof.purchaseToken,
    }),
    headers: { authorization: `Bearer ${call.token}` },
  });
  if (response.status === 404 || response.status === 400) {
    return null;
  }
  if (!response.ok) {
    throw fault(
      'GOOGLE.VERIFY_FAILED',
      `Google returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const record = response.body as {
    purchaseState?: unknown;
    acknowledgementState?: unknown;
    orderId?: unknown;
    purchaseTimeMillis?: unknown;
  } | null;
  if (
    typeof record?.purchaseState !== 'number' ||
    typeof record.acknowledgementState !== 'number' ||
    typeof record.orderId !== 'string' ||
    typeof record.purchaseTimeMillis !== 'string'
  ) {
    throw fault(
      'GOOGLE.MALFORMED_RESPONSE',
      'The ProductPurchase is missing required fields.',
      {
        detail: { body: response.body },
      },
    );
  }
  return {
    purchaseState: record.purchaseState,
    acknowledgementState: record.acknowledgementState,
    orderId: record.orderId,
    purchaseTimeMillis: record.purchaseTimeMillis,
  };
}

async function acknowledge(
  config: GoogleConfig,
  doFetch: FetchLike,
  call: { token: string; proof: GoogleProof },
): Promise<boolean> {
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: `${purchaseUrl(config, {
      productId: call.proof.productId,
      token: call.proof.purchaseToken,
    })}:acknowledge`,
    headers: {
      authorization: `Bearer ${call.token}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  return response.ok;
}

function canonicalize(
  config: GoogleConfig,
  proof: GoogleProof,
  purchase: ProductPurchase,
): CanonicalPurchase {
  const entry = config.resolveSku(proof.productId);
  return {
    schemaVersion: 1,
    provider: 'google',
    providerTxnId: purchase.orderId,
    providerSku: proof.productId,
    productType: entry.productType,
    amount: entry.amount,
    occurredAt: new Date(Number(purchase.purchaseTimeMillis)).toISOString(),
    sourceRef: `google:order:${purchase.orderId}`,
  };
}

function narrowProof(proof: unknown): GoogleProof {
  if (proof !== null && typeof proof === 'object') {
    const record = proof as { productId?: unknown; purchaseToken?: unknown };
    if (
      typeof record.productId === 'string' &&
      typeof record.purchaseToken === 'string'
    ) {
      return {
        productId: record.productId,
        purchaseToken: record.purchaseToken,
      };
    }
  }
  throw fault(
    'GOOGLE.MALFORMED_PROOF',
    'A Google proof must carry productId and purchaseToken.',
    {
      detail: { proof },
    },
  );
}

function retryableReject(error: unknown): {
  readonly ok: false;
  readonly reason: RejectReason;
} {
  if (
    error instanceof Error &&
    (error as { retryable?: unknown }).retryable === true
  ) {
    return reject('RETRYABLE');
  }
  throw error;
}
