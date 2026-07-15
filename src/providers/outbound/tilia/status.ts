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

import type { PayoutQuery, PayoutStatus } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { TiliaConfig } from './config.ts';

const STATE_BY_STATUS: Readonly<Record<string, PayoutStatus['state']>> = {
  SUCCESS: 'SETTLED',
  'USER-REVERSED': 'RETURNED',
  'USER-CANCELED': 'RETURNED',
  FAILED: 'FAILED',
  'ESCROW-TRANSFER-FAILED': 'FAILED',
  'SUPPORT-REJECTED': 'FAILED',
  'SYSTEM-REJECTED': 'FAILED',
  'ESCROW-TRANSFER-INITIATED': 'PENDING',
  'CREDIT-TRANSFER-INITIATED': 'PENDING',
  'FUNDS-IN-ESCROW': 'PENDING',
  'TILIA-ONHOLD': 'PENDING',
  'PROVIDER-ONHOLD': 'PENDING',
  'USER-REVERSE-FAILED': 'PENDING',
  'USER-REVERSE-TRANSFER-INITIATED': 'PENDING',
  'SUPPORT-REJECT-FAILED': 'PENDING',
  'SUPPORT-REJECT-TRANSFER-INITIATED': 'PENDING',
  'SYSTEM-REJECT-FAILED': 'PENDING',
};

export async function payoutStatus(
  config: TiliaConfig,
  doFetch: FetchLike,
  query: PayoutQuery,
): Promise<PayoutStatus> {
  if (!('ref' in query)) {
    throw fault(
      'TILIA.KEY_LOOKUP_UNVERIFIED',
      'Tilia does not document a payout lookup by caller key; resolve an indeterminate submit by re-driving submit with the same key.',
      { detail: { key: query.key } },
    );
  }
  const { accountId, payoutStatusId } = splitRefId(query.ref.id);
  const token = await bearerToken(config, doFetch);
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${tiliaHosts(config.environment).invoicing}/v2/${accountId}/payout/${payoutStatusId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return { state: 'UNKNOWN' };
  }
  if (!response.ok) {
    throw fault(
      'TILIA.STATUS_FAILED',
      `The Tilia payout status request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  return { state: payoutStateOf(fieldOf(payloadOf(response.body), 'status')) };
}

export function payoutStateOf(status: string | null): PayoutStatus['state'] {
  if (status === null) {
    return 'UNKNOWN';
  }
  return STATE_BY_STATUS[status] ?? 'UNKNOWN';
}

export function splitRefId(id: string): {
  accountId: string;
  payoutStatusId: string;
} {
  const separator = id.indexOf('/');
  if (separator <= 0 || separator === id.length - 1) {
    throw fault(
      'TILIA.MALFORMED_REF',
      `The Tilia payout ref '${id}' must look like '<accountId>/<payoutStatusId>'.`,
      { detail: { id } },
    );
  }
  return {
    accountId: id.slice(0, separator),
    payoutStatusId: id.slice(separator + 1),
  };
}
