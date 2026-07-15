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

import { moneyFromDecimal } from '../canonical/money.ts';
import { tiliaHosts } from '../providers/outbound/tilia/auth.ts';
import { fakeFetch } from './http.ts';

import type { PayoutRef, Window } from '../canonical/index.ts';
import type { TiliaConfig } from '../providers/outbound/tilia/config.ts';
import type { SignatureScheme } from '../codec/signature.ts';
import type { RecordedRequest, Route } from './http.ts';

export interface TiliaScenarioOptions {
  readonly submit?: 'accepted' | 'indeterminate' | 'rejected';
  readonly status?: 'SETTLED' | 'RETURNED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
  readonly kyc?: 'CLEARED' | 'BLOCKED' | 'PENDING' | 'NONE';
  readonly disbursed?: string;
  readonly walletBalance?: string;
  readonly webhookVerification?: SignatureScheme;
}

export interface TiliaScenario {
  readonly config: TiliaConfig;
  readonly ref: PayoutRef;
  readonly window: Window;
  readonly requests: RecordedRequest[];
}

const ACCOUNT_ID = 'acct-scenario';
const PAYOUT_STATUS_ID = 'ps-scenario';
const DISBURSED_AT = '2026-07-01 12:00:00';

const RAIL_STATUS_BY_STATE = {
  SETTLED: 'SUCCESS',
  RETURNED: 'USER-REVERSED',
  FAILED: 'SYSTEM-REJECTED',
  PENDING: 'FUNDS-IN-ESCROW',
  UNKNOWN: 'UNRECOGNIZED-BY-SCENARIO',
} as const;

const RAIL_KYC_BY_STATE = {
  CLEARED: 'ACCEPT',
  BLOCKED: 'DENY',
  PENDING: 'PROCESSING',
  NONE: 'NONE',
} as const;

export function tiliaScenario(
  options: TiliaScenarioOptions = {},
): TiliaScenario {
  const hosts = tiliaHosts('staging');
  const { doFetch, requests } = fakeFetch([
    {
      when: (url) => url === `${hosts.auth}/token`,
      body: JSON.stringify({ access_token: 'token-scenario' }),
    },
    submitRoute(hosts.invoicing, options.submit ?? 'accepted'),
    {
      when: (url, method) =>
        url ===
          `${hosts.invoicing}/v2/${ACCOUNT_ID}/payout/${PAYOUT_STATUS_ID}` &&
        method === 'GET',
      body: JSON.stringify({
        payload: { status: RAIL_STATUS_BY_STATE[options.status ?? 'SETTLED'] },
      }),
    },
    {
      when: (url, method) =>
        url === `${hosts.invoicing}/v2/${ACCOUNT_ID}/payouts` &&
        method === 'GET',
      body: JSON.stringify({
        payload: [
          {
            payout_status_id: PAYOUT_STATUS_ID,
            status: 'SUCCESS',
            created: DISBURSED_AT,
            credit: {
              amount: Number(
                moneyFromDecimal(options.disbursed ?? '2.00', 'USD').minor,
              ),
              currency: 'USD',
            },
          },
        ],
      }),
    },
    {
      when: (url, method) =>
        url === `${hosts.wallets}/balances/${ACCOUNT_ID}` && method === 'GET',
      body: JSON.stringify({
        payload: {
          balances: {
            USD: {
              spendable_balance: {
                balance: Number(
                  moneyFromDecimal(options.walletBalance ?? '100.00', 'USD')
                    .minor,
                ),
              },
            },
          },
        },
      }),
    },
    {
      when: (url) => url === `${hosts.pii}/v1/kyc/${ACCOUNT_ID}`,
      body: JSON.stringify({
        payload: { state: RAIL_KYC_BY_STATE[options.kyc ?? 'CLEARED'] },
      }),
    },
    {
      when: (url, method) =>
        url === `${hosts.auth}/authorize/user` && method === 'POST',
      body: JSON.stringify({
        payload: {
          nonce_auth_id: 'nonce-scenario',
          redirect:
            'https://pub.staging.tilia-inc.com/scenario/payout/nonce-scenario',
        },
      }),
    },
  ]);
  return {
    config: {
      environment: 'staging',
      clientId: 'client-scenario',
      clientSecret: 'secret-scenario',
      integratorAccountId: ACCOUNT_ID,
      resolvePayee: async () => ({
        accountId: ACCOUNT_ID,
        sourcePaymentMethodId: 'pm-source-scenario',
        destinationPaymentMethodId: 'pm-destination-scenario',
      }),
      webhookVerification: options.webhookVerification ?? {
        scheme: 'transport',
      },
      fetch: doFetch,
    },
    ref: { provider: 'tilia', id: `${ACCOUNT_ID}/${PAYOUT_STATUS_ID}` },
    window: { from: '2026-07-01T00:00:00', to: '2026-07-02T00:00:00' },
    requests,
  };
}

export function tiliaPayoutWebhookBody(
  outcome: 'SETTLED' | 'RETURNED' | 'FAILED' | 'PENDING' = 'SETTLED',
): string {
  return JSON.stringify({
    event_name: 'payout-complete',
    bucket_key: 'staging',
    sent_at: '2026-07-01T12:00:00Z',
    message: {
      account_id: ACCOUNT_ID,
      payout_status_id: PAYOUT_STATUS_ID,
      failure_code: outcome === 'FAILED' ? 'generic_error' : '',
      failure_reason: outcome === 'FAILED' ? 'an error occurred' : '',
      payout_flow: 'STANDARD',
      payout_status: RAIL_STATUS_BY_STATE[outcome],
    },
  });
}

function submitRoute(
  invoicing: string,
  submit: 'accepted' | 'indeterminate' | 'rejected',
): Route {
  const when = (url: string, method: string) =>
    url === `${invoicing}/v2/${ACCOUNT_ID}/payout` && method === 'POST';
  if (submit === 'accepted') {
    return {
      when,
      body: JSON.stringify({ payload: { payout_status_id: PAYOUT_STATUS_ID } }),
    };
  }
  return { when, status: submit === 'indeterminate' ? 500 : 400 };
}
