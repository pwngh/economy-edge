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
import { requestJson } from '../../transport.ts';
import { bearerToken, fieldOf, payloadOf, tiliaHosts } from './auth.ts';

import type { PayeeStatus } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { TiliaConfig } from './config.ts';

const PAYEE_STATE_BY_KYC: Readonly<Record<string, PayeeStatus['state']>> = {
  ACCEPT: 'CLEARED',
  DENY: 'BLOCKED',
  PROCESSING: 'PENDING',
  MANUAL_REVIEW: 'PENDING',
  REVERIFY: 'PENDING',
  NODATA: 'NONE',
  NONE: 'NONE',
  CANCEL: 'NONE',
  'SYSTEM-CANCELLED': 'NONE',
};

export async function payeeStatus(
  config: TiliaConfig,
  doFetch: FetchLike,
  query: { readonly userId: string },
): Promise<PayeeStatus> {
  const payee = await config.resolvePayee(query.userId);
  const token = await bearerToken(config, doFetch);
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${tiliaHosts(config.environment).pii}/v1/kyc/${payee.accountId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return { state: 'NONE' };
  }
  if (!response.ok) {
    throw fault(
      'TILIA.KYC_STATUS_FAILED',
      `The Tilia KYC status request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const state = fieldOf(payloadOf(response.body), 'state');
  if (state === null) {
    return { state: 'PENDING' };
  }
  return { state: PAYEE_STATE_BY_KYC[state] ?? 'PENDING' };
}

export async function payeeOnboard(
  config: TiliaConfig,
  doFetch: FetchLike,
  query: { readonly userId: string },
): Promise<{ hostedUrl: string }> {
  const payee = await config.resolvePayee(query.userId);
  const token = await bearerToken(config, doFetch);
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: `${tiliaHosts(config.environment).auth}/authorize/user`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      account_id: payee.accountId,
      mechanism: 'tilia_hosted',
      flow: 'payout',
    }),
  });
  if (!response.ok) {
    throw fault(
      'TILIA.ONBOARD_FAILED',
      `The Tilia hosted-flow authorization returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const redirect = fieldOf(payloadOf(response.body), 'redirect');
  if (redirect === null) {
    throw fault(
      'TILIA.ONBOARD_MALFORMED',
      'The Tilia hosted-flow authorization response is missing the redirect URL.',
      { retryable: true },
    );
  }
  return { hostedUrl: redirect };
}
