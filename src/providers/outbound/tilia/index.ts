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

import { verifySignature } from '../../../codec/signature.ts';
import { configuredFetch } from '../../fetch.ts';
import { cancelPayout } from './cancel.ts';
import { parseWebhook } from './parse.ts';
import { payeeOnboard, payeeStatus } from './payee.ts';
import { payoutReport, walletBalance } from './report.ts';
import { payoutStatus } from './status.ts';
import { submitPayout } from './submit.ts';

import type { OutboundProvider } from '../../../ports/index.ts';
import type { TiliaConfig } from './config.ts';

export type { TiliaConfig, TiliaPayee } from './config.ts';

export function tilia(config: TiliaConfig): OutboundProvider {
  const doFetch = configuredFetch(config);
  return {
    provider: 'tilia',
    submit: (request) => submitPayout(config, doFetch, request),
    status: (query) => payoutStatus(config, doFetch, query),
    report: (window) => payoutReport(config, doFetch, window),
    verify: (webhook) => verifySignature(config.webhookVerification, webhook),
    parse: (webhook) => parseWebhook(webhook),
    balance: () => walletBalance(config, doFetch),
    payee: {
      status: (query) => payeeStatus(config, doFetch, query),
      onboard: (query) => payeeOnboard(config, doFetch, query),
    },
    cancel: (ref) => cancelPayout(config, doFetch, ref),
  };
}
