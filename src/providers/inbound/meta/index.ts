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

import { configuredFetch } from '../../fetch.ts';
import { parseWebhook } from './parse.ts';
import { fulfillPurchase, verifyPurchase } from './verify.ts';

import type { InboundProvider } from '../../../ports/index.ts';
import type { MetaConfig } from './config.ts';

export type { MetaConfig } from './config.ts';

export function meta(config: MetaConfig): InboundProvider {
  const doFetch = configuredFetch(config);
  return {
    provider: 'meta',
    verify: (input) => verifyPurchase(config, doFetch, input),
    fulfill: (input) => fulfillPurchase(config, doFetch, input),
    status: async () => ({ state: 'UNKNOWN' }),
    parse: (webhook) => parseWebhook(config, webhook),
  };
}
