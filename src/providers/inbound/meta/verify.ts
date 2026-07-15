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

import type {
  CanonicalPurchase,
  Outcome,
  RejectReason,
} from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { RawProof } from '../../../ports/index.ts';
import type { MetaConfig } from './config.ts';

const GRAPH_HOST = 'https://graph.oculus.com';

interface MetaProof {
  readonly userId: string;
  readonly sku: string;
}

interface PurchaseRecord {
  readonly id: string;
  readonly grantTime: number;
}

export async function verifyPurchase(
  config: MetaConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<CanonicalPurchase, RejectReason>> {
  const proof = narrowProof(input.proof);
  let purchase: PurchaseRecord | null;
  try {
    const verified = await verifyEntitlement(config, doFetch, proof);
    if (!verified) {
      return reject('REJECTED');
    }
    purchase = await findPurchase(config, doFetch, proof);
  } catch (error) {
    return retryableReject(error);
  }
  if (purchase === null) {
    return reject('RETRYABLE');
  }
  const entry = config.resolveSku(proof.sku);
  return ok({
    schemaVersion: 1,
    provider: 'meta',
    providerTxnId: purchase.id,
    providerSku: proof.sku,
    productType: entry.productType,
    amount: entry.amount,
    occurredAt: new Date(purchase.grantTime * 1000).toISOString(),
    sourceRef: `meta:purchase:${purchase.id}`,
  });
}

export async function fulfillPurchase(
  config: MetaConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<void, RejectReason>> {
  const proof = narrowProof(input.proof);
  let response;
  try {
    response = await requestJson(doFetch, {
      method: 'POST',
      url: `${GRAPH_HOST}/${config.appId}/consume_entitlement`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        access_token: appAccessToken(config),
        user_id: proof.userId,
        sku: proof.sku,
      }),
    });
  } catch (error) {
    return retryableReject(error);
  }
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    return reject('RETRYABLE');
  }
  const consumed =
    (response.body as { success?: unknown } | null)?.success === true;
  return consumed ? ok(undefined) : reject('REJECTED');
}

export function appAccessToken(config: MetaConfig): string {
  return `OC|${config.appId}|${config.appSecret}`;
}

async function verifyEntitlement(
  config: MetaConfig,
  doFetch: FetchLike,
  proof: MetaProof,
): Promise<boolean> {
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: `${GRAPH_HOST}/${config.appId}/verify_entitlement`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      access_token: appAccessToken(config),
      user_id: proof.userId,
      sku: proof.sku,
    }),
  });
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw fault(
        'META.VERIFY_FAILED',
        `Meta returned a ${response.status} status.`,
        {
          retryable: true,
          detail: { status: response.status },
        },
      );
    }
    return false;
  }
  const body = response.body as { success?: unknown } | null;
  return body?.success === true;
}

async function findPurchase(
  config: MetaConfig,
  doFetch: FetchLike,
  proof: MetaProof,
): Promise<PurchaseRecord | null> {
  const query = formEncode({
    access_token: appAccessToken(config),
    user_id: proof.userId,
    fields: 'id,grant_time,expiration_time,item{sku}',
  });
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${GRAPH_HOST}/${config.appId}/viewer_purchases?${query}`,
  });
  if (!response.ok) {
    throw fault(
      'META.PURCHASES_FAILED',
      `Meta returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const rows = (response.body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) {
    return null;
  }
  for (const row of rows) {
    const record = row as {
      id?: unknown;
      grant_time?: unknown;
      item?: { sku?: unknown };
    };
    if (
      record.item?.sku === proof.sku &&
      typeof record.id === 'string' &&
      typeof record.grant_time === 'number'
    ) {
      return { id: record.id, grantTime: record.grant_time };
    }
  }
  return null;
}

function narrowProof(proof: unknown): MetaProof {
  if (proof !== null && typeof proof === 'object') {
    const record = proof as { userId?: unknown; sku?: unknown };
    if (typeof record.userId === 'string' && typeof record.sku === 'string') {
      return { userId: record.userId, sku: record.sku };
    }
  }
  throw fault(
    'META.MALFORMED_PROOF',
    'A Meta proof must carry userId and sku.',
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

function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}
