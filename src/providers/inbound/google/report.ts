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
import { money, moneyFromDecimal, subtract } from '../../../canonical/money.ts';
import { requestBytes } from '../../transport.ts';
import { columnIndex, parseDelimited } from '../../tabular.ts';
import { zipEntries } from '../../zip.ts';
import { accessToken } from './auth.ts';

import type {
  CanonicalSettlement,
  Money,
  Window,
} from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { GoogleConfig } from './config.ts';

const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
const STORAGE_HOST = 'https://storage.googleapis.com';

export async function earningsReport(
  config: GoogleConfig,
  doFetch: FetchLike,
  window: Window,
): Promise<CanonicalSettlement[]> {
  const bucket = config.financialReportsBucket;
  if (bucket === undefined) {
    throw fault(
      'GOOGLE.REPORTS_UNCONFIGURED',
      'Set financialReportsBucket to pull earnings reports.',
    );
  }
  const token = await accessToken(config, doFetch, STORAGE_SCOPE);
  const settlements: CanonicalSettlement[] = [];
  for (const month of monthsInWindow(window)) {
    const rows = await earningsRows(doFetch, { bucket, token, month });
    if (rows !== null) {
      settlements.push(...settlementsOf(rows, window, month));
    }
  }
  return settlements;
}

async function earningsRows(
  doFetch: FetchLike,
  call: { bucket: string; token: string; month: string },
): Promise<string[][] | null> {
  const object = encodeURIComponent(`earnings/earnings_${call.month}.zip`);
  const response = await requestBytes(doFetch, {
    method: 'GET',
    url: `${STORAGE_HOST}/storage/v1/b/${encodeURIComponent(call.bucket)}/o/${object}?alt=media`,
    headers: { authorization: `Bearer ${call.token}` },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw fault(
      'GOOGLE.REPORT_FAILED',
      `The earnings download returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status, month: call.month },
      },
    );
  }
  const rows: string[][] = [];
  for (const entry of await zipEntries(response.bytes)) {
    rows.push(...parseDelimited(new TextDecoder().decode(entry.bytes), ','));
  }
  return rows;
}

interface EarningsColumns {
  readonly description: number;
  readonly date: number;
  readonly type: number;
  readonly amount: number;
  readonly currency: number | null;
}

function settlementsOf(
  rows: string[][],
  window: Window,
  month: string,
): CanonicalSettlement[] {
  const [header, ...data] = rows;
  if (header === undefined) {
    return [];
  }
  const columns = earningsColumns(header);
  const orders = new Map<string, { gross: Money; feeMinor: bigint }>();
  for (const row of data) {
    if (!withinWindow(row[columns.date] ?? '', window)) {
      continue;
    }
    const description = row[columns.description] ?? '';
    const type = (row[columns.type] ?? '').toLowerCase();
    const currency =
      columns.currency === null ? 'USD' : (row[columns.currency] ?? 'USD');
    const amount = moneyFromDecimal(row[columns.amount] ?? '0', currency);
    const order = orders.get(description) ?? {
      gross: money(currency, 0n),
      feeMinor: 0n,
    };
    if (type === 'charge') {
      orders.set(description, { ...order, gross: amount });
    } else if (type.includes('fee')) {
      orders.set(description, {
        ...order,
        feeMinor: order.feeMinor - amount.minor,
      });
    }
  }
  return [...orders.entries()]
    .filter(([description]) => description.length > 0)
    .map(([description, order]) => {
      const fee = money(order.gross.currency, order.feeMinor);
      return {
        schemaVersion: 1 as const,
        providerTxnId: description,
        gross: order.gross,
        fee,
        net: subtract(order.gross, fee),
        sourceRef: `google:earnings:${month}:${description}`,
      };
    });
}

function earningsColumns(header: string[]): EarningsColumns {
  const description = columnIndex(header, 'Description');
  const date = columnIndex(header, 'Transaction Date');
  const type = columnIndex(header, 'Transaction Type');
  const amount = columnIndex(header, 'Amount (Merchant Currency)');
  if (
    description === null ||
    date === null ||
    type === null ||
    amount === null
  ) {
    throw fault(
      'GOOGLE.REPORT_MALFORMED',
      'The earnings CSV is missing required columns.',
      {
        detail: { header },
      },
    );
  }
  return {
    description,
    date,
    type,
    amount,
    currency: columnIndex(header, 'Merchant Currency'),
  };
}

function withinWindow(dateText: string, window: Window): boolean {
  const at = Date.parse(dateText);
  if (Number.isNaN(at)) {
    return true;
  }
  return at >= Date.parse(window.from) && at <= Date.parse(window.to);
}

function monthsInWindow(window: Window): string[] {
  const from = new Date(Date.parse(window.from));
  const to = new Date(Date.parse(window.to));
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
  );
  while (cursor.getTime() <= to.getTime()) {
    months.push(
      `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
    );
    if (months.length > 12) {
      throw fault(
        'GOOGLE.REPORT_WINDOW_TOO_WIDE',
        'Earnings pulls cover at most 12 months.',
        {
          detail: { window },
        },
      );
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
