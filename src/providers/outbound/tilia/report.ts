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
import { money } from '../../../canonical/money.ts';
import { requestJson } from '../../transport.ts';
import { bearerToken, payloadOf, tiliaHosts } from './auth.ts';

import type { CanonicalSettlement, Money, PayoutReport, Window } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { TiliaConfig } from './config.ts';

export async function payoutReport(
  config: TiliaConfig,
  doFetch: FetchLike,
  window: Window,
): Promise<PayoutReport> {
  const token = await bearerToken(config, doFetch);
  const [disbursements, walletBalance] = await Promise.all([
    settledDisbursements(config, doFetch, { token, window }),
    integratorBalance(config, doFetch, token),
  ]);
  return { disbursements, walletBalance };
}

async function settledDisbursements(
  config: TiliaConfig,
  doFetch: FetchLike,
  input: { token: string; window: Window },
): Promise<CanonicalSettlement[]> {
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${tiliaHosts(config.environment).invoicing}/v2/${config.integratorAccountId}/payouts`,
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (!response.ok) {
    throw fault(
      'TILIA.REPORT_FAILED',
      `The Tilia payouts request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const payouts = payloadOf(response.body);
  if (!Array.isArray(payouts)) {
    throw fault('TILIA.REPORT_MALFORMED', 'The Tilia payouts payload is not an array.');
  }
  return payouts
    .map((row) => narrowPayoutRow(row))
    .filter((row) => row.status === 'SUCCESS' && withinWindow(row.created, input.window))
    .map((row) => settlementOf(row));
}

function withinWindow(created: string, window: Window): boolean {
  const createdIso = created.replace(' ', 'T');
  return createdIso >= window.from && createdIso <= window.to;
}

interface PayoutRow {
  readonly payoutStatusId: string;
  readonly status: string;
  readonly created: string;
  readonly amount: bigint;
  readonly currency: string;
}

function narrowPayoutRow(row: unknown): PayoutRow {
  if (row !== null && typeof row === 'object') {
    const record = row as Record<string, unknown>;
    const credit = record.credit as Record<string, unknown> | undefined;
    if (
      typeof record.payout_status_id === 'string' &&
      typeof record.status === 'string' &&
      typeof record.created === 'string' &&
      credit !== undefined &&
      typeof credit.amount === 'number' &&
      typeof credit.currency === 'string'
    ) {
      return {
        payoutStatusId: record.payout_status_id,
        status: record.status,
        created: record.created,
        amount: BigInt(credit.amount),
        currency: credit.currency,
      };
    }
  }
  throw fault('TILIA.REPORT_MALFORMED', 'A Tilia payout row is missing required fields.', {
    detail: { row },
  });
}

function settlementOf(row: PayoutRow): CanonicalSettlement {
  const gross = money(row.currency, row.amount);
  return {
    schemaVersion: 1,
    providerTxnId: row.payoutStatusId,
    gross,
    fee: money(row.currency, 0n),
    net: gross,
    sourceRef: `tilia:payout:${row.payoutStatusId}`,
  };
}

/**
 * The wallet balance as its own verb: the float check reads one number and
 * should never have to fabricate an empty settlement window to get it.
 */
export async function walletBalance(config: TiliaConfig, doFetch: FetchLike): Promise<Money> {
  const token = await bearerToken(config, doFetch);
  return integratorBalance(config, doFetch, token);
}

async function integratorBalance(
  config: TiliaConfig,
  doFetch: FetchLike,
  token: string,
): Promise<Money> {
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${tiliaHosts(config.environment).wallets}/balances/${config.integratorAccountId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw fault(
      'TILIA.BALANCE_FAILED',
      `The Tilia balances request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const payload = payloadOf(response.body) as { balances?: Record<string, unknown> } | null;
  const usd = payload?.balances?.USD as { spendable_balance?: { balance?: unknown } } | undefined;
  const balance = usd?.spendable_balance?.balance;
  if (typeof balance === 'string' && /^\d+$/.test(balance)) {
    return money('USD', BigInt(balance));
  }
  if (typeof balance === 'number' && Number.isInteger(balance)) {
    return money('USD', BigInt(balance));
  }
  throw fault(
    'TILIA.BALANCE_MALFORMED',
    'The Tilia balances payload has no USD spendable_balance.balance.',
  );
}
