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
import { encodeMoney } from '../../../canonical/money.ts';
import { callerKey } from '../../../codec/idempotency.ts';
import { requestJson } from '../../transport.ts';
import { bearerToken, fieldOf, payloadOf, tiliaHosts } from './auth.ts';

import type {
  Money,
  PayoutRequest,
  PayoutResult,
} from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { HttpResponse } from '../../transport.ts';
import type { TiliaConfig } from './config.ts';

export async function submitPayout(
  config: TiliaConfig,
  doFetch: FetchLike,
  request: PayoutRequest,
): Promise<PayoutResult> {
  const key = callerKey(request.key);
  const payee = await config.resolvePayee(request.payee);
  const token = await bearerToken(config, doFetch);
  const idempotencyKey = await idempotencyUuid(key);
  const body = JSON.stringify({
    source_payment_method_id: payee.sourcePaymentMethodId,
    destination_payment_method_id: payee.destinationPaymentMethodId,
    amount: wireAmount(request.amount),
    currency: request.amount.currency,
  });
  let response: HttpResponse;
  try {
    response = await requestJson(doFetch, {
      method: 'POST',
      url: `${tiliaHosts(config.environment).invoicing}/v2/${payee.accountId}/payout`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body,
    });
  } catch {
    return { outcome: 'INDETERMINATE', retryable: true };
  }
  return mapSubmitResponse(response, payee.accountId);
}

function mapSubmitResponse(
  response: HttpResponse,
  accountId: string,
): PayoutResult {
  if (response.ok) {
    const payoutStatusId = fieldOf(
      payloadOf(response.body),
      'payout_status_id',
    );
    if (payoutStatusId === null) {
      return { outcome: 'INDETERMINATE', retryable: true };
    }
    return {
      outcome: 'ACCEPTED',
      ref: { provider: 'tilia', id: `${accountId}/${payoutStatusId}` },
    };
  }
  if (response.status === 401 || response.status === 403) {
    throw fault(
      'TILIA.AUTH_REJECTED',
      'Tilia rejected the payout request credentials.',
      {
        detail: { status: response.status },
      },
    );
  }
  if (response.status === 429) {
    throw fault(
      'TILIA.RATE_LIMITED',
      'Tilia rejected the payout for rate limiting.',
      {
        retryable: true,
        detail: { status: response.status },
      },
    );
  }
  if (response.status === 409 || response.status >= 500) {
    return { outcome: 'INDETERMINATE', retryable: true };
  }
  return { outcome: 'REJECTED', reason: 'REJECTED' };
}

function wireAmount(amount: Money): number {
  if (amount.minor < 0n || amount.minor > 9007199254740991n) {
    throw fault(
      'TILIA.AMOUNT_OUT_OF_RANGE',
      'The payout amount does not fit a JSON integer.',
      {
        detail: { amount: encodeMoney(amount) },
      },
    );
  }
  return Number(amount.minor);
}

async function idempotencyUuid(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
