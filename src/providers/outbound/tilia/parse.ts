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

import { unrecognizedPayoutEvent } from '../../../canonical/events.ts';
import { payoutStateOf } from './status.ts';

import type { CanonicalPayoutEvent } from '../../../canonical/index.ts';
import type { RawWebhook } from '../../../ports/index.ts';

const KYC_EVENT_BY_STATE: Readonly<Record<string, 'KYC_CLEARED' | 'KYC_BLOCKED'>> = {
  ACCEPT: 'KYC_CLEARED',
  DENY: 'KYC_BLOCKED',
};

interface Decoded {
  readonly envelope: unknown;
  readonly message: Readonly<Record<string, unknown>>;
}

export function parseWebhook(webhook: RawWebhook): CanonicalPayoutEvent[] {
  const decoded = decodeEnvelope(webhook.body);
  if (decoded === null) {
    return [unrecognizedPayoutEvent('tilia', webhook)];
  }
  const event = payoutEventOf(decoded) ?? kycEventOf(decoded);
  return [event ?? unrecognizedPayoutEvent('tilia', decoded.envelope)];
}

function decodeEnvelope(body: string): Decoded | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return null;
  }
  if (envelope === null || typeof envelope !== 'object') {
    return null;
  }
  const message = (envelope as { message?: unknown }).message;
  if (message === null || message === undefined || typeof message !== 'object') {
    return null;
  }
  return { envelope, message: message as Record<string, unknown> };
}

function payoutEventOf(decoded: Decoded): CanonicalPayoutEvent | null {
  const payoutStatusId = stringField(decoded.message, 'payout_status_id');
  const accountId = stringField(decoded.message, 'account_id');
  const status = stringField(decoded.message, 'payout_status');
  if (payoutStatusId === null || accountId === null || status === null) {
    return null;
  }
  const type = payoutStateOf(status);
  if (type === 'UNKNOWN') {
    return null;
  }
  const failureCode = stringField(decoded.message, 'failure_code');
  const failureReason = stringField(decoded.message, 'failure_reason');
  return {
    schemaVersion: 1,
    type,
    provider: 'tilia',
    ref: { provider: 'tilia', id: `${accountId}/${payoutStatusId}` },
    payee: accountId,
    ...(failureCode === null ? {} : { failureCode }),
    ...(failureReason === null ? {} : { failureReason }),
    raw: decoded.envelope,
  };
}

function kycEventOf(decoded: Decoded): CanonicalPayoutEvent | null {
  const accountId = stringField(decoded.message, 'account_id');
  const state = stringField(decoded.message, 'state');
  if (accountId === null || state === null) {
    return null;
  }
  const type = KYC_EVENT_BY_STATE[state];
  if (type === undefined) {
    return null;
  }
  return {
    schemaVersion: 1,
    type,
    provider: 'tilia',
    payee: accountId,
    raw: decoded.envelope,
  };
}

function stringField(record: Readonly<Record<string, unknown>>, name: string): string | null {
  const value = record[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
