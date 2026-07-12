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
import { generateKeyPairSync } from 'node:crypto';

import { hasCode } from '#src/canonical/fault.ts';
import { google } from '#src/providers/inbound/google/index.ts';
import { fakeFetch } from '#test/support/http.ts';
import { fixture } from '#test/support/fixtures.ts';
import { usd } from '#test/support/fakes.ts';
import { buildZip } from '#test/support/zip.ts';

import type { FetchLike } from '#src/providers/fetch.ts';
import type { GoogleConfig } from '#src/providers/inbound/google/index.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function configWith(doFetch: FetchLike): GoogleConfig {
  return {
    packageName: 'com.example.mobile',
    serviceAccountEmail: 'billing@project.iam.gserviceaccount.com',
    serviceAccountPrivateKey: privateKey,
    resolveSku: () => ({ amount: usd('9.99'), productType: 'CONSUMABLE' }),
    fetch: doFetch,
  };
}

const tokenRoute = {
  when: (url: string) => url.includes('oauth2.googleapis.com/token'),
  body: '{"access_token":"google-token","expires_in":3600,"token_type":"Bearer"}',
};

const acknowledgeRoute = (status = 200) => ({
  when: (url: string) => url.includes(':acknowledge'),
  status,
  body: '',
});

const purchaseRoute = (body: string, status = 200) => ({
  when: (url: string, method: string) => url.includes('/tokens/') && method === 'GET',
  status,
  body,
});

const proof = {
  provider: 'google',
  proof: { productId: 'sku-credits-1200', purchaseToken: 'purchase-token-redacted' },
} as const;

describe('google verify', () => {
  test('verifies a purchase and acknowledges it inside the 3-day window', async () => {
    const { doFetch, requests } = fakeFetch([
      tokenRoute,
      acknowledgeRoute(),
      purchaseRoute(fixture('google', 'product-purchase.json')),
    ]);

    const outcome = await google(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.providerTxnId, 'GPA.1234-5678-9012-34567');
      assert.deepEqual(outcome.value.amount, usd('9.99'));
      assert.equal(outcome.value.occurredAt, '2025-07-03T00:00:00.000Z');
    }
    assert.ok(requests.some((request) => request.url.includes(':acknowledge')));
  });

  test('skips the acknowledge call when the purchase is already acknowledged', async () => {
    const { doFetch, requests } = fakeFetch([
      tokenRoute,
      acknowledgeRoute(),
      purchaseRoute(fixture('google', 'product-purchase-acknowledged.json')),
    ]);

    const outcome = await google(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
    assert.equal(
      requests.some((request) => request.url.includes(':acknowledge')),
      false,
    );
  });

  test('rejects RETRYABLE while the purchase is pending', async () => {
    const { doFetch } = fakeFetch([
      tokenRoute,
      purchaseRoute(fixture('google', 'product-purchase-pending.json')),
    ]);

    const outcome = await google(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('rejects RETRYABLE when the acknowledge claim fails, never crediting unclaimed', async () => {
    const { doFetch } = fakeFetch([
      tokenRoute,
      acknowledgeRoute(503),
      purchaseRoute(fixture('google', 'product-purchase.json')),
    ]);

    const outcome = await google(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('rejects an unknown purchase token as a value', async () => {
    const { doFetch } = fakeFetch([tokenRoute, purchaseRoute('', 404)]);

    const outcome = await google(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('surfaces the captured invalid-assertion token failure as a fault', async () => {
    const { doFetch } = fakeFetch([
      {
        when: (url: string) => url.includes('oauth2.googleapis.com/token'),
        status: 400,
        body: fixture('google', 'token-invalid-assertion.json'),
      },
    ]);

    await assert.rejects(google(configWith(doFetch)).verify(proof), (error: unknown) =>
      hasCode(error, 'GOOGLE.AUTH_FAILED'),
    );
  });
});

describe('google fulfill', () => {
  const consumeRoute = (status: number) => ({
    when: (url: string, method: string) => url.includes(':consume') && method === 'POST',
    status,
    body: '',
  });

  test('consumes the purchase as the fulfillment claim', async () => {
    const { doFetch, requests } = fakeFetch([tokenRoute, consumeRoute(200)]);

    const outcome = await google(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: true, value: undefined });
    assert.ok(requests.some((request) => request.url.includes(':consume')));
  });

  test('rejects a consume of an unknown token as a value', async () => {
    const { doFetch } = fakeFetch([tokenRoute, consumeRoute(404)]);

    const outcome = await google(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects RETRYABLE when the consume endpoint is unavailable', async () => {
    const { doFetch } = fakeFetch([tokenRoute, consumeRoute(503)]);

    const outcome = await google(configWith(doFetch)).fulfill!(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });
});

describe('google report', () => {
  const earningsZip = buildZip([
    { name: 'earnings_202607.csv', content: fixture('google', 'earnings-202607.csv') },
  ]);
  const zipRoute = {
    when: (url: string) => url.includes('/o/earnings%2Fearnings_202607.zip'),
    bodyBytes: earningsZip,
  };
  const withBucket = (doFetch: FetchLike) => ({
    ...configWith(doFetch),
    financialReportsBucket: 'pubsite_prod_rev_0123456789',
  });

  test('pulls the earnings zip and aggregates per-order gross, fee, and net', async () => {
    const { doFetch, requests } = fakeFetch([tokenRoute, zipRoute]);

    const settlements = await google(withBucket(doFetch)).report!({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.providerTxnId, 'GPA.1234-0001');
    assert.deepEqual(settlements[0]?.gross, usd('9.99'));
    assert.deepEqual(settlements[0]?.fee, usd('1.50'));
    assert.deepEqual(settlements[0]?.net, usd('8.49'));
    assert.equal(settlements[0]?.granularity, undefined);
    const download = requests.find((request) => request.url.includes('alt=media'));
    assert.ok(download?.url.startsWith('https://storage.googleapis.com/storage/v1/b/'));
  });

  test('skips months whose report is not published yet', async () => {
    const { doFetch } = fakeFetch([tokenRoute, zipRoute]);

    const settlements = await google(withBucket(doFetch)).report!({
      from: '2026-06-15T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.equal(settlements.length, 1);
  });

  test('offers no report when the bucket is not configured', () => {
    assert.equal(google(configWith(fakeFetch([]).doFetch)).report, undefined);
  });

  test('refuses a window wider than the pull can honestly cover', async () => {
    const { doFetch } = fakeFetch([tokenRoute]);

    await assert.rejects(
      google(withBucket(doFetch)).report!({
        from: '2024-01-01T00:00:00Z',
        to: '2026-07-08T00:00:00Z',
      }),
      (error: unknown) => hasCode(error, 'GOOGLE.REPORT_WINDOW_TOO_WIDE'),
    );
  });

  test('covers exactly twelve months without refusing, and thirteen never', async () => {
    const { doFetch } = fakeFetch([tokenRoute]);

    const settlements = await google(withBucket(doFetch)).report!({
      from: '2025-08-15T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.deepEqual(settlements, []);
    await assert.rejects(
      google(withBucket(doFetch)).report!({
        from: '2025-07-15T00:00:00Z',
        to: '2026-07-08T00:00:00Z',
      }),
      (error: unknown) => hasCode(error, 'GOOGLE.REPORT_WINDOW_TOO_WIDE'),
    );
  });

  test('includes a row whose transaction date does not parse rather than dropping money', async () => {
    const header =
      'Description,Transaction Date,Transaction Type,Amount (Merchant Currency),Merchant Currency';
    const undatedZip = buildZip([
      {
        name: 'earnings_202607.csv',
        content: `${header}\nGPA.9999-0001,not a date,Charge,5.00,USD\n`,
      },
    ]);
    const undatedRoute = {
      when: (url: string) => url.includes('/o/earnings%2Fearnings_202607.zip'),
      bodyBytes: undatedZip,
    };
    const { doFetch } = fakeFetch([tokenRoute, undatedRoute]);

    const settlements = await google(withBucket(doFetch)).report!({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.providerTxnId, 'GPA.9999-0001');
    assert.deepEqual(settlements[0]?.gross, usd('5.00'));
  });
});

describe('google parse', () => {
  const provider = google(configWith(fakeFetch([]).doFetch));

  test('normalizes a real-time purchased notification', () => {
    const events = provider.parse!({
      provider: 'google',
      headers: {},
      body: fixture('google', 'rtdn-one-time-purchased.json'),
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'PURCHASE');
    assert.deepEqual(events[0]?.amount, usd('9.99'));
  });

  test('normalizes a voided purchase to a REFUND with origin attribution', () => {
    const events = provider.parse!({
      provider: 'google',
      headers: {},
      body: fixture('google', 'rtdn-voided.json'),
    });

    assert.equal(events[0]?.type, 'REFUND');
    assert.equal(events[0]?.originTxnId, 'GPA.1234-5678-9012-34567');
  });

  test('surfaces an undecodable push message as Unrecognized', () => {
    const events = provider.parse!({ provider: 'google', headers: {}, body: 'not json' });

    assert.equal(events[0]?.type, 'Unrecognized');
  });
});
