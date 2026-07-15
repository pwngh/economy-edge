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

import { meta } from '#src/providers/inbound/meta/index.ts';
import { fakeFetch } from '#test/support/http.ts';
import { fixture } from '#test/support/fixtures.ts';
import { usd } from '#test/support/fakes.ts';

import type { FetchLike } from '#src/providers/fetch.ts';
import type { MetaConfig } from '#src/providers/inbound/meta/index.ts';
import type { RawWebhook } from '#src/ports/index.ts';

function configWith(doFetch: FetchLike): MetaConfig {
  return {
    appId: 'app-1',
    appSecret: 'secret-1',
    resolveSku: (sku) => {
      if (sku !== 'sku-credits-1200') {
        throw new Error(`unknown sku ${sku}`);
      }
      return { amount: usd('9.99'), productType: 'CONSUMABLE' };
    },
    fetch: doFetch,
  };
}

const verifyRoute = (status: number, body: string) => ({
  when: (url: string, method: string) =>
    url.includes('/verify_entitlement') && method === 'POST',
  status,
  body,
});

const purchasesRoute = (body: string) => ({
  when: (url: string) => url.includes('/viewer_purchases'),
  body,
});

function webhookOf(name: string): RawWebhook {
  return { provider: 'meta', headers: {}, body: fixture('meta', name) };
}

const proof = {
  provider: 'meta',
  proof: { userId: 'usr-1', sku: 'sku-credits-1200' },
} as const;

describe('meta verify', () => {
  test('verifies an entitlement and canonicalizes the matching purchase', async () => {
    const { doFetch, requests } = fakeFetch([
      verifyRoute(200, fixture('meta', 'verify-entitlement-success.json')),
      purchasesRoute(fixture('meta', 'viewer-purchases.json')),
    ]);

    const outcome = await meta(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.providerTxnId, 'purchase-9001');
      assert.equal(outcome.value.providerSku, 'sku-credits-1200');
      assert.deepEqual(outcome.value.amount, usd('9.99'));
      assert.equal(outcome.value.occurredAt, '2025-07-03T00:00:00.000Z');
      assert.equal(outcome.value.sourceRef, 'meta:purchase:purchase-9001');
    }
    const verify = requests.find((request) =>
      request.url.includes('/verify_entitlement'),
    );
    assert.ok(verify?.body.includes('access_token=OC%7Capp-1%7Csecret-1'));
  });

  test('rejects an unverified entitlement as a value', async () => {
    const { doFetch } = fakeFetch([verifyRoute(200, '{"success":false}')]);

    const outcome = await meta(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects the captured invalid-token envelope as a value', async () => {
    const { doFetch } = fakeFetch([
      verifyRoute(400, fixture('meta', 'error-invalid-app-token.json')),
    ]);

    const outcome = await meta(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects RETRYABLE when Meta is unavailable', async () => {
    const { doFetch } = fakeFetch([verifyRoute(503, '')]);

    const outcome = await meta(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('rejects RETRYABLE when the purchase row has not appeared yet', async () => {
    const { doFetch } = fakeFetch([
      verifyRoute(200, fixture('meta', 'verify-entitlement-success.json')),
      purchasesRoute('{"data":[]}'),
    ]);

    const outcome = await meta(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('refuses a malformed proof as a fault', async () => {
    const { doFetch } = fakeFetch([]);

    await assert.rejects(
      meta(configWith(doFetch)).verify({
        provider: 'meta',
        proof: { sku: 42 },
      }),
      (error: unknown) =>
        (error as { code?: string }).code === 'META.MALFORMED_PROOF',
    );
  });
});

describe('meta parse', () => {
  const provider = meta(configWith(fakeFetch([]).doFetch));

  test('normalizes a purchased order to a PURCHASE event with the reporting id', () => {
    const events = provider.parse!(webhookOf('webhook-order-purchased.json'));

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'PURCHASE');
    assert.equal(
      events[0]?.providerTxnId,
      '03f8833e-9c02-4fa0-978f-4cfe91f86bae',
    );
    assert.deepEqual(events[0]?.amount, usd('9.99'));
  });

  test('normalizes refund and chargeback orders with origin attribution', () => {
    const refund = provider.parse!(webhookOf('webhook-order-refunded.json'));
    const chargeback = provider.parse!(
      webhookOf('webhook-order-chargebacked.json'),
    );

    assert.equal(refund[0]?.type, 'REFUND');
    assert.equal(
      refund[0]?.originTxnId,
      '03f8833e-9c02-4fa0-978f-4cfe91f86bae',
    );
    assert.equal(chargeback[0]?.type, 'CHARGEBACK');
  });

  test('surfaces an unknown sku as Unrecognized instead of guessing an amount', () => {
    const body = fixture('meta', 'webhook-order-purchased.json').replaceAll(
      'sku-credits-1200',
      'sku-unknown',
    );

    const events = provider.parse!({ provider: 'meta', headers: {}, body });

    assert.equal(events[0]?.type, 'Unrecognized');
  });

  test('surfaces a body that is not an order webhook as Unrecognized', () => {
    const events = provider.parse!({
      provider: 'meta',
      headers: {},
      body: '{"object":"other"}',
    });

    assert.equal(events[0]?.type, 'Unrecognized');
  });
});

describe('meta fulfill', () => {
  const consumeRoute = (status: number, body: string) => ({
    when: (url: string, method: string) =>
      url.includes('/consume_entitlement') && method === 'POST',
    status,
    body,
  });

  test('consumes an entitlement as the fulfillment claim', async () => {
    const { doFetch } = fakeFetch([
      consumeRoute(200, fixture('meta', 'consume-entitlement-success.json')),
    ]);

    const outcome = await meta(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: true, value: undefined });
  });

  test('rejects a consume Meta refuses as a value', async () => {
    const { doFetch } = fakeFetch([consumeRoute(200, '{"success":false}')]);

    const outcome = await meta(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects RETRYABLE when Meta is unavailable', async () => {
    const { doFetch } = fakeFetch([consumeRoute(503, '')]);

    const outcome = await meta(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });
});

describe('meta status', () => {
  test('answers UNKNOWN because Meta documents no per-transaction query', async () => {
    const provider = meta(configWith(fakeFetch([]).doFetch));

    assert.deepEqual(
      await provider.status({ provider: 'meta', providerTxnId: 'x' }),
      {
        state: 'UNKNOWN',
      },
    );
  });
});
