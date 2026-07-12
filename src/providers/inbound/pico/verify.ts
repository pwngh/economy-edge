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

import type { CanonicalPurchase, Outcome, RejectReason } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { RawProof } from '../../../ports/index.ts';
import type { PicoConfig } from './config.ts';

const RATE_LIMITED = 10016;

interface PicoProof {
  readonly userAccessToken: string;
  readonly userId: string;
  readonly sku: string;
}

interface PicoCall {
  readonly code: number;
  readonly data: unknown;
}

export async function verifyPurchase(
  config: PicoConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<CanonicalPurchase, RejectReason>> {
  const proof = narrowProof(input.proof);
  let purchase: { id: string; grantTime: number } | null;
  try {
    const verify = await picoCall(config, doFetch, {
      path: '/s2s/v1/iap/verify',
      body: { access_token: proof.userAccessToken, sku: proof.sku },
    });
    if (verify.code === RATE_LIMITED) {
      return reject('RETRYABLE');
    }
    if (verify.code !== 0 || !isVerified(verify.data)) {
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
    provider: 'pico',
    providerTxnId: purchase.id,
    providerSku: proof.sku,
    productType: entry.productType,
    amount: entry.amount,
    occurredAt: occurredAtOf(purchase.grantTime),
    sourceRef: `pico:purchase:${purchase.id}`,
  });
}

const CANNOT_BE_CONSUMED = 10502;

export async function fulfillPurchase(
  config: PicoConfig,
  doFetch: FetchLike,
  input: RawProof,
): Promise<Outcome<void, RejectReason>> {
  const proof = narrowProof(input.proof);
  let call: PicoCall;
  try {
    call = await picoCall(config, doFetch, {
      path: '/s2s/v1/iap/consume',
      body: { access_token: proof.userAccessToken, sku: proof.sku },
    });
  } catch (error) {
    return retryableReject(error);
  }
  if (call.code === RATE_LIMITED) {
    return reject('RETRYABLE');
  }
  if (call.code === CANNOT_BE_CONSUMED || call.code !== 0) {
    return reject('REJECTED');
  }
  const consumed = (call.data as { consumed?: unknown } | null)?.consumed === true;
  return consumed ? ok(undefined) : reject('REJECTED');
}

export function picoHost(region: PicoConfig['region']): string {
  return region === 'china' ? 'https://platform-cn.picovr.com' : 'https://platform-us.picovr.com';
}

async function picoCall(
  config: PicoConfig,
  doFetch: FetchLike,
  call: { readonly path: string; readonly body: Record<string, string> },
): Promise<PicoCall> {
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: `${picoHost(config.region)}${call.path}`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(call.body),
  });
  if (!response.ok) {
    throw fault('PICO.HTTP_FAILED', `PICO returned a ${response.status} status.`, {
      retryable: response.status === 429 || response.status >= 500,
      detail: { status: response.status },
    });
  }
  const record = response.body as { code?: unknown; data?: unknown } | null;
  if (typeof record?.code !== 'number') {
    throw fault('PICO.MALFORMED_RESPONSE', 'The PICO response envelope has no code.', {
      retryable: true,
    });
  }
  return { code: record.code, data: record.data };
}

async function findPurchase(
  config: PicoConfig,
  doFetch: FetchLike,
  proof: PicoProof,
): Promise<{ id: string; grantTime: number } | null> {
  const call = await picoCall(config, doFetch, {
    path: '/s2s/v1/user/purchased',
    body: {
      access_token: `PICO|${config.appId}|${config.appSecret}`,
      user_id: proof.userId,
    },
  });
  if (call.code !== 0) {
    return null;
  }
  const rows = (call.data as { list?: unknown } | null)?.list;
  if (!Array.isArray(rows)) {
    return null;
  }
  for (const row of rows) {
    const record = row as { sku?: unknown; purchase_id?: unknown; grant_time?: unknown };
    if (
      record.sku === proof.sku &&
      typeof record.purchase_id === 'string' &&
      typeof record.grant_time === 'number'
    ) {
      return { id: record.purchase_id, grantTime: record.grant_time };
    }
  }
  return null;
}

function isVerified(data: unknown): boolean {
  return (data as { verified?: unknown } | null)?.verified === true;
}

function occurredAtOf(grantTime: number): string {
  const milliseconds = grantTime > 99_999_999_999 ? grantTime : grantTime * 1000;
  return new Date(milliseconds).toISOString();
}

function narrowProof(proof: unknown): PicoProof {
  if (proof !== null && typeof proof === 'object') {
    const record = proof as { userAccessToken?: unknown; userId?: unknown; sku?: unknown };
    if (
      typeof record.userAccessToken === 'string' &&
      typeof record.userId === 'string' &&
      typeof record.sku === 'string'
    ) {
      return { userAccessToken: record.userAccessToken, userId: record.userId, sku: record.sku };
    }
  }
  throw fault('PICO.MALFORMED_PROOF', 'A PICO proof must carry userAccessToken, userId, and sku.', {
    detail: { proof },
  });
}

function retryableReject(error: unknown): { readonly ok: false; readonly reason: RejectReason } {
  if (error instanceof Error && (error as { retryable?: unknown }).retryable === true) {
    return reject('RETRYABLE');
  }
  throw error;
}
