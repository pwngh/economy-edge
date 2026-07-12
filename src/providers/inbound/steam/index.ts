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
import { purchaseStatus } from './status.ts';
import { settlementReport } from './report.ts';
import { verifyPurchase } from './verify.ts';

import type { InboundProvider } from '../../../ports/index.ts';
import type { SteamConfig } from './config.ts';

export type { SteamConfig } from './config.ts';

export function steam(config: SteamConfig): InboundProvider {
  const doFetch = configuredFetch(config);
  return {
    provider: 'steam',
    verify: (input) => verifyPurchase(config, doFetch, input),
    status: (query) => purchaseStatus(config, doFetch, query),
    report: (window) => settlementReport(config, doFetch, window),
  };
}
