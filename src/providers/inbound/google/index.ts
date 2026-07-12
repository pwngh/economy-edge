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
import { earningsReport } from './report.ts';
import { purchaseStatus } from './status.ts';
import { fulfillPurchase, verifyPurchase } from './verify.ts';

import type { InboundProvider } from '../../../ports/index.ts';
import type { GoogleConfig } from './config.ts';

export type { GoogleConfig } from './config.ts';

export function google(config: GoogleConfig): InboundProvider {
  const doFetch = configuredFetch(config);
  const provider: InboundProvider = {
    provider: 'google',
    verify: (input) => verifyPurchase(config, doFetch, input),
    fulfill: (input) => fulfillPurchase(config, doFetch, input),
    status: () => purchaseStatus(),
    parse: (webhook) => parseWebhook(config, webhook),
  };
  if (config.financialReportsBucket === undefined) {
    return provider;
  }
  return { ...provider, report: (window) => earningsReport(config, doFetch, window) };
}
