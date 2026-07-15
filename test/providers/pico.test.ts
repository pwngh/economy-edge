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

import { hasCode } from '#src/canonical/fault.ts';
import { pico } from '#src/providers/inbound/pico/index.ts';
import { fakeFetch } from '#test/support/http.ts';
import { fixture } from '#test/support/fixtures.ts';
import { usd } from '#test/support/fakes.ts';

import type { FetchLike } from '#src/providers/fetch.ts';
import type { PicoConfig } from '#src/providers/inbound/pico/index.ts';

function configWith(doFetch: FetchLike): PicoConfig {
  return {
    region: 'global',
    appId: 'app-1',
    appSecret: 'secret-1',
    resolveSku: () => ({ amount: usd('9.99'), productType: 'CONSUMABLE' }),
    fetch: doFetch,
  };
}

const verifyRoute = (body: string) => ({
  when: (url: string) => url.includes('/s2s/v1/iap/verify'),
  body,
});

const purchasedRoute = (body: string) => ({
  when: (url: string) => url.includes('/s2s/v1/user/purchased'),
  body,
});

const proof = {
  provider: 'pico',
  proof: {
    userAccessToken: 'user-token',
    userId: 'usr-1',
    sku: 'sku-credits-1200',
  },
} as const;

describe('pico verify', () => {
  test('verifies ownership and canonicalizes the purchase from the list', async () => {
    const { doFetch, requests } = fakeFetch([
      verifyRoute(fixture('pico', 'verify-ok.json')),
      purchasedRoute(fixture('pico', 'purchased-list.json')),
    ]);

    const outcome = await pico(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.providerTxnId, 'pico-order-1');
      assert.equal(outcome.value.occurredAt, '2025-07-03T00:00:00.000Z');
      assert.deepEqual(outcome.value.amount, usd('9.99'));
    }
    const purchased = requests.find((request) =>
      request.url.includes('/user/purchased'),
    );
    assert.ok(purchased?.url.startsWith('https://platform-us.picovr.com/'));
    assert.ok(purchased?.body.includes('PICO|app-1|secret-1'));
  });

  test('rejects the captured not-authorized envelope, which arrives as HTTP 200', async () => {
    const { doFetch } = fakeFetch([
      verifyRoute(fixture('pico', 'error-not-authorized.json')),
    ]);

    const outcome = await pico(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects RETRYABLE on the documented rate-limit code', async () => {
    const { doFetch } = fakeFetch([
      verifyRoute(
        '{"code":10016,"em":"Too many requests.","trace_id":"t","data":{}}',
      ),
    ]);

    const outcome = await pico(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('rejects RETRYABLE when the purchase row has not appeared yet', async () => {
    const { doFetch } = fakeFetch([
      verifyRoute(fixture('pico', 'verify-ok.json')),
      purchasedRoute('{"code":0,"em":"","trace_id":"t","data":{"list":[]}}'),
    ]);

    const outcome = await pico(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('refuses a proof without the relayed user token as a fault', async () => {
    const { doFetch } = fakeFetch([]);

    await assert.rejects(
      pico(configWith(doFetch)).verify({
        provider: 'pico',
        proof: { sku: 'x' },
      }),
      (error: unknown) => hasCode(error, 'PICO.MALFORMED_PROOF'),
    );
  });
});

describe('pico fulfill', () => {
  const consumeRoute = (body: string) => ({
    when: (url: string) => url.includes('/s2s/v1/iap/consume'),
    body,
  });

  test('consumes the purchase as the fulfillment claim', async () => {
    const { doFetch } = fakeFetch([
      consumeRoute(fixture('pico', 'consume-ok.json')),
    ]);

    const outcome = await pico(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: true, value: undefined });
  });

  test('rejects the documented cannot-be-consumed code as a value', async () => {
    const { doFetch } = fakeFetch([
      consumeRoute(
        '{"code":10502,"em":"Item can not be consumed.","trace_id":"t","data":{}}',
      ),
    ]);

    const outcome = await pico(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects RETRYABLE on the rate-limit code', async () => {
    const { doFetch } = fakeFetch([
      consumeRoute(
        '{"code":10016,"em":"Too many requests.","trace_id":"t","data":{}}',
      ),
    ]);

    const outcome = await pico(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });
});

describe('pico status', () => {
  test('answers UNKNOWN because PICO documents no per-transaction query', async () => {
    const provider = pico(configWith(fakeFetch([]).doFetch));

    assert.deepEqual(
      await provider.status({ provider: 'pico', providerTxnId: 'x' }),
      {
        state: 'UNKNOWN',
      },
    );
  });
});
