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
import { salesReport } from './report.ts';
import { purchaseStatus } from './status.ts';
import { verifyPurchase } from './verify.ts';

import type { InboundProvider } from '../../../ports/index.ts';
import type { AppleConfig } from './config.ts';

export type { AppleConfig, AppleReportsConfig } from './config.ts';

export function apple(config: AppleConfig): InboundProvider {
  const doFetch = configuredFetch(config);
  const provider: InboundProvider = {
    provider: 'apple',
    verify: (input) => verifyPurchase(config, doFetch, input),
    status: (query) => purchaseStatus(config, doFetch, query),
    parse: (webhook) => parseWebhook(webhook),
  };
  if (config.reports === undefined) {
    return provider;
  }
  return {
    ...provider,
    report: (window) => salesReport(config, doFetch, window),
  };
}
