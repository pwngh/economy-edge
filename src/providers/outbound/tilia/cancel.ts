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
import { bearerToken, tiliaHosts } from './auth.ts';
import { splitRefId } from './status.ts';

import type { Outcome, PayoutRef, RejectReason } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { TiliaConfig } from './config.ts';

export async function cancelPayout(
  config: TiliaConfig,
  doFetch: FetchLike,
  ref: PayoutRef,
): Promise<Outcome<void, RejectReason>> {
  const { accountId, payoutStatusId } = splitRefId(ref.id);
  const token = await bearerToken(config, doFetch);
  const response = await requestJson(doFetch, {
    method: 'DELETE',
    url: `${tiliaHosts(config.environment).invoicing}/v2/${accountId}/payout/${payoutStatusId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.ok) {
    return ok(undefined);
  }
  if (response.status === 409) {
    return reject('ALREADY_SETTLED');
  }
  if (response.status === 429 || response.status >= 500) {
    throw fault(
      'TILIA.CANCEL_FAILED',
      `The Tilia payout cancel returned a ${response.status} status.`,
      { retryable: true, detail: { status: response.status } },
    );
  }
  return reject('REJECTED');
}
