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
import { fulfillPurchase, verifyPurchase } from './verify.ts';

import type { InboundProvider } from '../../../ports/index.ts';
import type { PicoConfig } from './config.ts';

export type { PicoConfig } from './config.ts';

export function pico(config: PicoConfig): InboundProvider {
  const doFetch = configuredFetch(config);
  return {
    provider: 'pico',
    verify: (input) => verifyPurchase(config, doFetch, input),
    fulfill: (input) => fulfillPurchase(config, doFetch, input),
    status: async () => ({ state: 'UNKNOWN' }),
  };
}
