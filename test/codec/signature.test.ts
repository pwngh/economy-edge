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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifySignature } from '#src/codec/signature.ts';

import type { RawWebhook } from '#src/ports/index.ts';

const SECRET = 'shared-webhook-secret';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function webhook(body: string, headers: Record<string, string>): RawWebhook {
  return { provider: 'tilia', headers, body };
}

describe('verifySignature', () => {
  const scheme = {
    scheme: 'hmac-sha256',
    secret: SECRET,
    header: 'x-signature',
  } as const;

  test('accepts a payload signed with the shared secret', async () => {
    const body = '{"hello":"world"}';

    assert.equal(await verifySignature(scheme, webhook(body, { 'x-signature': sign(body) })), true);
  });

  test('matches the signature header case-insensitively', async () => {
    const body = '{}';

    assert.equal(await verifySignature(scheme, webhook(body, { 'X-Signature': sign(body) })), true);
  });

  test('rejects a tampered payload', async () => {
    const signed = sign('{"amount":"1.00"}');

    assert.equal(
      await verifySignature(scheme, webhook('{"amount":"9999.00"}', { 'x-signature': signed })),
      false,
    );
  });

  test('rejects a missing signature header', async () => {
    assert.equal(await verifySignature(scheme, webhook('{}', {})), false);
  });

  test('rejects a signature that is not valid hex', async () => {
    assert.equal(await verifySignature(scheme, webhook('{}', { 'x-signature': 'zz' })), false);
  });

  test('accepts everything under the transport scheme', async () => {
    assert.equal(await verifySignature({ scheme: 'transport' }, webhook('{}', {})), true);
  });
});
