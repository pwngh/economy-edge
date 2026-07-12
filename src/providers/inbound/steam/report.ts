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
import { steamGet } from './api.ts';
import { idOf, totalOf } from './verify.ts';

import type { CanonicalSettlement, Window } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';
import type { SteamConfig } from './config.ts';

export async function settlementReport(
  config: SteamConfig,
  doFetch: FetchLike,
  window: Window,
): Promise<CanonicalSettlement[]> {
  const call = await steamGet(config, doFetch, {
    path: 'GetReport/v5',
    params: { type: 'SETTLEMENT', time: window.from, maxresults: '50000' },
  });
  if (call.result === 'failure') {
    throw fault('STEAM.REPORT_FAILED', 'Steam refused the settlement report request.', {
      detail: { errorcode: call.errorcode },
    });
  }
  const orders = call.params.orders;
  if (!Array.isArray(orders)) {
    return [];
  }
  return orders.filter((order) => withinWindow(order, window)).map((order) => settlementOf(order));
}

function withinWindow(order: unknown, window: Window): boolean {
  const time = (order as { time?: unknown } | null)?.time;
  return typeof time === 'string' && time >= window.from && time <= window.to;
}

function settlementOf(order: unknown): CanonicalSettlement {
  const record = order as {
    orderid?: unknown;
    transid?: unknown;
    currency?: unknown;
    items?: unknown;
  };
  if (typeof record.currency !== 'string' || !Array.isArray(record.items)) {
    throw fault('STEAM.REPORT_MALFORMED', 'A Steam report row is missing required fields.', {
      detail: { order },
    });
  }
  const transId = idOf(record.transid);
  const gross = money(record.currency, totalOf(record.items));
  return {
    schemaVersion: 1,
    providerTxnId: transId,
    gross,
    fee: money(record.currency, 0n),
    net: gross,
    sourceRef: `steam:order:${idOf(record.orderid)}`,
  };
}
