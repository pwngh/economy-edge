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
import { gzipSync } from 'node:zlib';

import { hasCode } from '#src/canonical/fault.ts';
import { money } from '#src/canonical/money.ts';
import { apple } from '#src/providers/inbound/apple/index.ts';
import { amountFromMilliunits } from '#src/providers/inbound/apple/verify.ts';
import { fakeFetch } from '#test/support/http.ts';
import { fixture } from '#test/support/fixtures.ts';

import type { FetchLike } from '#src/providers/fetch.ts';
import type { AppleConfig } from '#src/providers/inbound/apple/index.ts';

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function configWith(doFetch: FetchLike): AppleConfig {
  return {
    environment: 'sandbox',
    bundleId: 'com.example.mobile',
    issuerId: 'issuer-1',
    keyId: 'key-1',
    privateKey,
    fetch: doFetch,
  };
}

const transactionRoute = (body: string, status = 200) => ({
  when: (url: string) => url.includes('/inApps/v1/transactions/'),
  status,
  body,
});

const proof = { provider: 'apple', proof: { transactionId: '2000000123456789' } } as const;

describe('apple verify', () => {
  test('fetches the transaction from Apple and canonicalizes the milliunit price', async () => {
    const { doFetch, requests } = fakeFetch([
      transactionRoute(fixture('apple', 'transaction-info.json')),
    ]);

    const outcome = await apple(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.providerTxnId, '2000000123456789');
      assert.equal(outcome.value.providerSku, 'sku-credits-1200');
      assert.deepEqual(outcome.value.amount, money('USD', 999n));
      assert.equal(outcome.value.productType, 'CONSUMABLE');
    }
    const request = requests.find((entry) => entry.url.includes('/inApps/'));
    assert.ok(request?.url.startsWith('https://api.storekit-sandbox.apple.com/'));
    assert.match(request?.headers.authorization ?? '', /^Bearer /);
  });

  test('converts milliunit prices per currency exponent', () => {
    assert.deepEqual(amountFromMilliunits(9990, 'USD'), money('USD', 999n));
    assert.deepEqual(amountFromMilliunits(1_500_000, 'JPY'), money('JPY', 1500n));
    assert.deepEqual(amountFromMilliunits(1500, 'KWD'), money('KWD', 1500n));
  });

  test('rejects a revoked transaction as ALREADY_SETTLED', async () => {
    const { doFetch } = fakeFetch([
      transactionRoute(fixture('apple', 'transaction-info-revoked.json')),
    ]);

    const outcome = await apple(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'ALREADY_SETTLED' });
  });

  test('rejects an unknown transaction as a value', async () => {
    const { doFetch } = fakeFetch([transactionRoute('', 404)]);

    const outcome = await apple(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('surfaces the captured plain-text 401 as an auth fault', async () => {
    const { doFetch } = fakeFetch([
      transactionRoute(fixture('apple', 'error-unauthenticated.txt'), 401),
    ]);

    await assert.rejects(apple(configWith(doFetch)).verify(proof), (error: unknown) =>
      hasCode(error, 'APPLE.AUTH_REJECTED'),
    );
  });

  test('rejects RETRYABLE when Apple is unavailable', async () => {
    const { doFetch } = fakeFetch([transactionRoute('', 503)]);

    const outcome = await apple(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });
});

describe('apple status', () => {
  test('answers SETTLED for a transaction Apple returns and UNKNOWN for one it does not', async () => {
    const settled = fakeFetch([transactionRoute(fixture('apple', 'transaction-info.json'))]);
    const missing = fakeFetch([transactionRoute('', 404)]);

    assert.deepEqual(
      await apple(configWith(settled.doFetch)).status({
        provider: 'apple',
        providerTxnId: '2000000123456789',
      }),
      { state: 'SETTLED' },
    );
    assert.deepEqual(
      await apple(configWith(missing.doFetch)).status({
        provider: 'apple',
        providerTxnId: '404',
      }),
      { state: 'UNKNOWN' },
    );
  });
});

describe('apple report', () => {
  const withReports = (doFetch: FetchLike): AppleConfig => ({
    ...configWith(doFetch),
    reports: {
      issuerId: 'reports-issuer',
      keyId: 'reports-key',
      privateKey,
      vendorNumber: '88888888',
    },
  });
  const salesRoute = {
    when: (url: string) => url.includes('/v1/salesReports') && url.includes('2026-07-02'),
    bodyBytes: new Uint8Array(gzipSync(fixture('apple', 'sales-summary.tsv'))),
  };

  test('pulls the gzipped sales report into sku-day settlements', async () => {
    const { doFetch, requests } = fakeFetch([salesRoute]);

    const settlements = await apple(withReports(doFetch)).report!({
      from: '2026-07-02T00:00:00Z',
      to: '2026-07-02T23:59:59Z',
    });

    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.providerTxnId, '2026-07-02:sku-credits-1200:USD:US');
    assert.equal(settlements[0]?.granularity, 'sku-day');
    assert.deepEqual(settlements[0]?.net, money('USD', 2097n));
    assert.deepEqual(settlements[0]?.fee, money('USD', 0n));
    const pull = requests.find((request) => request.url.includes('/v1/salesReports'));
    assert.ok(
      pull?.url.includes('filter%5BvendorNumber%5D=88888888') ||
        pull?.url.includes('filter[vendorNumber]=88888888'),
    );
  });

  test('skips days without a published report', async () => {
    const { doFetch } = fakeFetch([salesRoute]);

    const settlements = await apple(withReports(doFetch)).report!({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-02T23:59:59Z',
    });

    assert.equal(settlements.length, 1);
  });

  test('offers no report without the team-key credentials', () => {
    assert.equal(apple(configWith(fakeFetch([]).doFetch)).report, undefined);
  });

  test('refuses a window wider than the pull can honestly cover', async () => {
    const { doFetch } = fakeFetch([]);

    await assert.rejects(
      apple(withReports(doFetch)).report!({
        from: '2026-05-01T00:00:00Z',
        to: '2026-07-08T00:00:00Z',
      }),
      (error: unknown) => hasCode(error, 'APPLE.REPORT_WINDOW_TOO_WIDE'),
    );
  });

  test('covers exactly thirty-one days without refusing, and thirty-two never', async () => {
    const { doFetch } = fakeFetch([]);

    const settlements = await apple(withReports(doFetch)).report!({
      from: '2026-06-08T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.deepEqual(settlements, []);
    await assert.rejects(
      apple(withReports(doFetch)).report!({
        from: '2026-06-07T00:00:00Z',
        to: '2026-07-08T00:00:00Z',
      }),
      (error: unknown) => hasCode(error, 'APPLE.REPORT_WINDOW_TOO_WIDE'),
    );
  });

  test('derives report days from the window instants in UTC, honoring offsets', async () => {
    const { doFetch, requests } = fakeFetch([salesRoute]);

    const settlements = await apple(withReports(doFetch)).report!({
      from: '2026-07-02T09:00:00+09:00',
      to: '2026-07-03T08:59:59+09:00',
    });

    assert.equal(settlements.length, 1);
    const pulledDays = requests
      .filter((request) => request.url.includes('/v1/salesReports'))
      .map((request) => /reportDate%5D=([0-9-]+)|reportDate\]=([0-9-]+)/.exec(request.url))
      .map((match) => match?.[1] ?? match?.[2]);
    assert.deepEqual(pulledDays, ['2026-07-02']);
  });
});

describe('apple parse', () => {
  const provider = apple(configWith(fakeFetch([]).doFetch));

  test('normalizes a ONE_TIME_CHARGE notification to a PURCHASE event', () => {
    const events = provider.parse!({
      provider: 'apple',
      headers: {},
      body: fixture('apple', 'notification-one-time-charge.json'),
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'PURCHASE');
    assert.equal(events[0]?.providerTxnId, '2000000123456789');
    assert.deepEqual(events[0]?.amount, money('USD', 999n));
  });

  test('normalizes a REFUND notification with origin attribution', () => {
    const events = provider.parse!({
      provider: 'apple',
      headers: {},
      body: fixture('apple', 'notification-refund.json'),
    });

    assert.equal(events[0]?.type, 'REFUND');
    assert.equal(events[0]?.originTxnId, '2000000123456789');
  });

  test('surfaces a body without a decodable signedPayload as Unrecognized', () => {
    const events = provider.parse!({ provider: 'apple', headers: {}, body: '{"other":1}' });

    assert.equal(events[0]?.type, 'Unrecognized');
  });
});
