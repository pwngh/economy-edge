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

import type { CanonicalEvent } from '../../../canonical/index.ts';
import type { RawWebhook } from '../../../ports/index.ts';
import type { MetaConfig } from './config.ts';

const EVENT_TYPE_BY_NOTIFICATION: Readonly<Record<string, 'PURCHASE' | 'REFUND' | 'CHARGEBACK'>> = {
  PURCHASED: 'PURCHASE',
  REFUNDED: 'REFUND',
  CHARGEBACKED: 'CHARGEBACK',
};

export function parseWebhook(config: MetaConfig, webhook: RawWebhook): CanonicalEvent[] {
  const changes = changesOf(webhook.body);
  if (changes === null) {
    return [unrecognizedEvent('meta', webhook)];
  }
  return changes.map((change) => eventOf(config, change));
}

function changesOf(body: string): unknown[] | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return null;
  }
  const entries = (envelope as { entry?: unknown } | null)?.entry;
  if (!Array.isArray(entries)) {
    return null;
  }
  const changes: unknown[] = [];
  for (const entry of entries) {
    const entryChanges = (entry as { changes?: unknown } | null)?.changes;
    if (Array.isArray(entryChanges)) {
      changes.push(...entryChanges);
    }
  }
  return changes.length > 0 ? changes : null;
}

function eventOf(config: MetaConfig, change: unknown): CanonicalEvent {
  const record = change as {
    field?: unknown;
    value?: {
      product_info?: { notification_type?: unknown; reporting_id?: unknown; sku?: unknown };
    };
  } | null;
  const info = record?.value?.product_info;
  if (
    record?.field !== 'order_status' ||
    typeof info?.notification_type !== 'string' ||
    typeof info.reporting_id !== 'string' ||
    typeof info.sku !== 'string'
  ) {
    return unrecognizedEvent('meta', change);
  }
  const type = EVENT_TYPE_BY_NOTIFICATION[info.notification_type];
  if (type === undefined) {
    return unrecognizedEvent('meta', change);
  }
  let amount;
  try {
    amount = config.resolveSku(info.sku).amount;
  } catch {
    return unrecognizedEvent('meta', change);
  }
  return {
    schemaVersion: 1,
    type,
    provider: 'meta',
    providerTxnId: info.reporting_id,
    originTxnId: type === 'PURCHASE' ? undefined : info.reporting_id,
    amount,
    raw: change,
  };
}
