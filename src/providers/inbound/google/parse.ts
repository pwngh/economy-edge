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
import { stringOfBase64 } from '../../../codec/jwt.ts';

import type { CanonicalEvent } from '../../../canonical/index.ts';
import type { RawWebhook } from '../../../ports/index.ts';
import type { GoogleConfig } from './config.ts';

const ONE_TIME_PURCHASED = 1;

export function parseWebhook(config: GoogleConfig, webhook: RawWebhook): CanonicalEvent[] {
  const notification = notificationOf(webhook.body);
  if (notification === null) {
    return [unrecognizedEvent('google', webhook)];
  }
  const purchase = purchaseEventOf(config, notification);
  if (purchase !== null) {
    return [purchase];
  }
  const voided = voidedEventOf(notification);
  if (voided !== null) {
    return [voided];
  }
  return [unrecognizedEvent('google', notification)];
}

function notificationOf(body: string): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(body) as { message?: { data?: unknown } } | null;
    const data = envelope?.message?.data;
    if (typeof data !== 'string') {
      return null;
    }
    const notification = JSON.parse(stringOfBase64(data)) as unknown;
    if (notification === null || typeof notification !== 'object') {
      return null;
    }
    return notification as Record<string, unknown>;
  } catch {
    return null;
  }
}

function purchaseEventOf(
  config: GoogleConfig,
  notification: Record<string, unknown>,
): CanonicalEvent | null {
  const oneTime = notification.oneTimeProductNotification as {
    notificationType?: unknown;
    purchaseToken?: unknown;
    sku?: unknown;
  } | null;
  if (
    oneTime === null ||
    oneTime === undefined ||
    oneTime.notificationType !== ONE_TIME_PURCHASED ||
    typeof oneTime.sku !== 'string'
  ) {
    return null;
  }
  let amount;
  try {
    amount = config.resolveSku(oneTime.sku).amount;
  } catch {
    return null;
  }
  return {
    schemaVersion: 1,
    type: 'PURCHASE',
    provider: 'google',
    amount,
    raw: notification,
  };
}

function voidedEventOf(notification: Record<string, unknown>): CanonicalEvent | null {
  const voided = notification.voidedPurchaseNotification as { orderId?: unknown } | null;
  if (voided === null || voided === undefined || typeof voided.orderId !== 'string') {
    return null;
  }
  return {
    schemaVersion: 1,
    type: 'REFUND',
    provider: 'google',
    providerTxnId: voided.orderId,
    originTxnId: voided.orderId,
    raw: notification,
  };
}
