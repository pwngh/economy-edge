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

import { steamGet } from './api.ts';

import type { InboundQuery, PurchaseStatus } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { SteamConfig } from './config.ts';

const STATE_BY_STATUS: Readonly<Record<string, PurchaseStatus['state']>> = {
  Succeeded: 'SETTLED',
  Refunded: 'SETTLED',
  PartialRefund: 'SETTLED',
  Chargedback: 'SETTLED',
  RefundedSuspectedFraud: 'SETTLED',
  RefundedFriendlyFraud: 'SETTLED',
  Init: 'PENDING',
  Approved: 'PENDING',
  Failed: 'FAILED',
};

export async function purchaseStatus(
  config: SteamConfig,
  doFetch: FetchLike,
  query: InboundQuery,
): Promise<PurchaseStatus> {
  const call = await steamGet(config, doFetch, {
    path: 'QueryTxn/v3',
    params: { transid: query.providerTxnId },
  });
  if (call.result === 'failure') {
    return { state: 'UNKNOWN' };
  }
  const status = String(call.params.status ?? '');
  return { state: STATE_BY_STATUS[status] ?? 'UNKNOWN' };
}
