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

import { unrecognizedEvent } from '../../../canonical/events.ts';
import { decodeJwsPayload } from '../../../codec/jwt.ts';
import { amountFromMilliunits } from './verify.ts';

import type { CanonicalEvent, Money } from '../../../canonical/index.ts';
import type { RawWebhook } from '../../../ports/index.ts';

export function parseWebhook(webhook: RawWebhook): CanonicalEvent[] {
  const notification = notificationOf(webhook.body);
  if (notification === null) {
    return [unrecognizedEvent('apple', webhook)];
  }
  const transaction = transactionOf(notification);
  if (notification.notificationType === 'ONE_TIME_CHARGE' && transaction !== null) {
    return [
      {
        schemaVersion: 1,
        type: 'PURCHASE',
        provider: 'apple',
        providerTxnId: transaction.transactionId,
        amount: transaction.amount,
        raw: notification,
      },
    ];
  }
  if (notification.notificationType === 'REFUND' && transaction !== null) {
    return [
      {
        schemaVersion: 1,
        type: 'REFUND',
        provider: 'apple',
        providerTxnId: transaction.transactionId,
        originTxnId: transaction.transactionId,
        amount: transaction.amount,
        raw: notification,
      },
    ];
  }
  return [unrecognizedEvent('apple', notification)];
}

function notificationOf(body: string): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(body) as { signedPayload?: unknown } | null;
    const payload = decodeJwsPayload(envelope?.signedPayload);
    if (payload === null || typeof payload !== 'object') {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function transactionOf(
  notification: Record<string, unknown>,
): { transactionId: string; amount?: Money } | null {
  const signed = (notification.data as { signedTransactionInfo?: unknown } | undefined)
    ?.signedTransactionInfo;
  const payload = decodeJwsPayload(signed);
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const record = payload as { transactionId?: unknown; price?: unknown; currency?: unknown };
  if (typeof record.transactionId !== 'string') {
    return null;
  }
  const amount =
    typeof record.price === 'number' && typeof record.currency === 'string'
      ? amountFromMilliunits(record.price, record.currency)
      : undefined;
  return { transactionId: record.transactionId, amount };
}
