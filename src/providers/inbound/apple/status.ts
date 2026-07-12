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

import { fetchTransaction } from './verify.ts';

import type { InboundQuery, PurchaseStatus } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { AppleConfig } from './config.ts';

export async function purchaseStatus(
  config: AppleConfig,
  doFetch: FetchLike,
  query: InboundQuery,
): Promise<PurchaseStatus> {
  const payload = await fetchTransaction(config, doFetch, query.providerTxnId);
  if (payload === null) {
    return { state: 'UNKNOWN' };
  }
  return { state: 'SETTLED' };
}
