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
import { money, moneyFromDecimal } from '../../../canonical/money.ts';
import { decompressBytes } from '../../compression.ts';
import { requestBytes } from '../../transport.ts';
import { columnIndex, parseDelimited } from '../../tabular.ts';
import { reportsJwt } from './auth.ts';

import type { CanonicalSettlement, Window } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { AppleConfig, AppleReportsConfig } from './config.ts';

const REPORTS_HOST = 'https://api.appstoreconnect.apple.com';

export async function salesReport(
  config: AppleConfig,
  doFetch: FetchLike,
  window: Window,
): Promise<CanonicalSettlement[]> {
  const reports = config.reports;
  if (reports === undefined) {
    throw fault(
      'APPLE.REPORTS_UNCONFIGURED',
      'Set the reports team-key credentials to pull sales reports.',
    );
  }
  const settlements: CanonicalSettlement[] = [];
  for (const day of daysInWindow(window)) {
    const tsv = await dailyReport(config, doFetch, { reports, day });
    if (tsv !== null) {
      settlements.push(...settlementsOf(tsv, day));
    }
  }
  return settlements;
}

async function dailyReport(
  config: AppleConfig,
  doFetch: FetchLike,
  call: { reports: AppleReportsConfig; day: string },
): Promise<string | null> {
  const token = await reportsJwt(config);
  const query = [
    'filter[frequency]=DAILY',
    `filter[reportDate]=${call.day}`,
    'filter[reportSubType]=SUMMARY',
    'filter[reportType]=SALES',
    `filter[vendorNumber]=${encodeURIComponent(call.reports.vendorNumber)}`,
    'filter[version]=1_1',
  ].join('&');
  const response = await requestBytes(doFetch, {
    method: 'GET',
    url: `${REPORTS_HOST}/v1/salesReports?${query}`,
    headers: { authorization: `Bearer ${token}`, accept: 'application/a-gzip' },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw fault(
      'APPLE.REPORT_FAILED',
      `The sales report request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status, day: call.day },
      },
    );
  }
  return new TextDecoder().decode(
    await decompressBytes(response.bytes, 'gzip'),
  );
}

function settlementsOf(tsv: string, day: string): CanonicalSettlement[] {
  const [header, ...rows] = parseDelimited(tsv, '\t');
  if (header === undefined) {
    return [];
  }
  const sku = columnIndex(header, 'SKU');
  const units = columnIndex(header, 'Units');
  const proceeds = columnIndex(header, 'Developer Proceeds');
  const currency = columnIndex(header, 'Currency of Proceeds');
  const country = columnIndex(header, 'Country Code');
  if (
    sku === null ||
    units === null ||
    proceeds === null ||
    currency === null
  ) {
    throw fault(
      'APPLE.REPORT_MALFORMED',
      'The sales report is missing required columns.',
      {
        detail: { header },
      },
    );
  }
  return rows
    .filter(
      (row) => (row[sku] ?? '').length > 0 && !Number.isNaN(Number(row[units])),
    )
    .map((row) => {
      const perUnit = moneyFromDecimal(
        row[proceeds] ?? '0',
        row[currency] ?? 'USD',
      );
      const net = money(
        perUnit.currency,
        perUnit.minor * BigInt(Number(row[units])),
      );
      const region = country === null ? 'ALL' : (row[country] ?? 'ALL');
      return {
        schemaVersion: 1 as const,
        providerTxnId: `${day}:${row[sku]}:${perUnit.currency}:${region}`,
        granularity: 'sku-day' as const,
        gross: net,
        fee: money(perUnit.currency, 0n),
        net,
        sourceRef: `apple:sales:${day}:${row[sku]}`,
      };
    });
}

function daysInWindow(window: Window): string[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const days: string[] = [];
  for (let at = from; at <= to; at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
    if (days.length > 31) {
      throw fault(
        'APPLE.REPORT_WINDOW_TOO_WIDE',
        'Sales pulls cover at most 31 days.',
        {
          detail: { window },
        },
      );
    }
  }
  return days;
}
