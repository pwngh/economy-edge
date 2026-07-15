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
import { money } from '#src/canonical/money.ts';
import { steam } from '#src/providers/inbound/steam/index.ts';
import { fakeFetch } from '#test/support/http.ts';
import { fixture } from '#test/support/fixtures.ts';

import type { FetchLike } from '#src/providers/fetch.ts';
import type { SteamConfig } from '#src/providers/inbound/steam/index.ts';

function configWith(doFetch: FetchLike): SteamConfig {
  return {
    publisherWebApiKey: 'publisher-key',
    appId: 438100,
    environment: 'sandbox',
    fetch: doFetch,
  };
}

const finalizeRoute = (body: string) => ({
  when: (url: string, method: string) =>
    url.includes('/FinalizeTxn/') && method === 'POST',
  body,
});

const queryRoute = (body: string) => ({
  when: (url: string) => url.includes('/QueryTxn/'),
  body,
});

const proof = { provider: 'steam', proof: { orderId: '938473' } } as const;

describe('steam verify', () => {
  test('finalizes, queries, and canonicalizes a succeeded transaction', async () => {
    const { doFetch, requests } = fakeFetch([
      finalizeRoute(fixture('steam', 'finalize-ok.json')),
      queryRoute(fixture('steam', 'query-succeeded.json')),
    ]);

    const outcome = await steam(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.providerTxnId, '374839');
      assert.equal(outcome.value.providerSku, '1200');
      assert.equal(outcome.value.productType, 'CONSUMABLE');
      assert.deepEqual(outcome.value.amount, money('USD', 999n));
      assert.equal(outcome.value.occurredAt, '2026-07-02T12:00:00Z');
    }
    const finalize = requests.find((request) =>
      request.url.includes('/FinalizeTxn/'),
    );
    assert.ok(finalize?.url.includes('/ISteamMicroTxnSandbox/'));
    assert.ok(finalize?.body.includes('key=publisher-key'));
    assert.ok(finalize?.body.includes('appid=438100'));
  });

  test('treats an already-committed finalize as a replay, not a failure', async () => {
    const { doFetch } = fakeFetch([
      finalizeRoute(fixture('steam', 'finalize-already-committed.json')),
      queryRoute(fixture('steam', 'query-succeeded.json')),
    ]);

    const outcome = await steam(configWith(doFetch)).verify(proof);

    assert.equal(outcome.ok, true);
  });

  test('rejects a finalize that missed its time limit as a value', async () => {
    const { doFetch } = fakeFetch([
      finalizeRoute(fixture('steam', 'finalize-time-limit.json')),
    ]);

    const outcome = await steam(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });

  test('rejects an already-reversed transaction as ALREADY_SETTLED', async () => {
    const { doFetch } = fakeFetch([
      finalizeRoute(fixture('steam', 'finalize-already-committed.json')),
      queryRoute(fixture('steam', 'query-refunded.json')),
    ]);

    const outcome = await steam(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'ALREADY_SETTLED' });
  });

  test('rejects a still-pending transaction as RETRYABLE', async () => {
    const { doFetch } = fakeFetch([
      finalizeRoute(fixture('steam', 'finalize-ok.json')),
      queryRoute(fixture('steam', 'query-approved.json')),
    ]);

    const outcome = await steam(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('rejects RETRYABLE when Steam is unavailable', async () => {
    const { doFetch } = fakeFetch([
      {
        when: (url: string, method: string) =>
          url.includes('/FinalizeTxn/') && method === 'POST',
        status: 503,
        body: '',
      },
    ]);

    const outcome = await steam(configWith(doFetch)).verify(proof);

    assert.deepEqual(outcome, { ok: false, reason: 'RETRYABLE' });
  });

  test('surfaces the captured HTML 403 for an invalid key as a fault', async () => {
    const { doFetch } = fakeFetch([
      {
        when: (url: string, method: string) =>
          url.includes('/FinalizeTxn/') && method === 'POST',
        status: 403,
        body: fixture('steam', 'forbidden-invalid-key.html'),
      },
    ]);

    await assert.rejects(
      steam(configWith(doFetch)).verify(proof),
      (error: unknown) => hasCode(error, 'STEAM.HTTP_FAILED'),
    );
  });

  test('refuses a proof without a decimal orderId as a fault', async () => {
    const { doFetch } = fakeFetch([]);

    await assert.rejects(
      steam(configWith(doFetch)).verify({
        provider: 'steam',
        proof: { orderId: 'DROP TABLE' },
      }),
      (error: unknown) => hasCode(error, 'STEAM.MALFORMED_PROOF'),
    );
  });
});

describe('steam status', () => {
  test('maps QueryTxn statuses onto purchase states', async () => {
    const succeeded = fakeFetch([
      queryRoute(fixture('steam', 'query-succeeded.json')),
    ]);
    const approved = fakeFetch([
      queryRoute(fixture('steam', 'query-approved.json')),
    ]);

    assert.deepEqual(
      await steam(configWith(succeeded.doFetch)).status({
        provider: 'steam',
        providerTxnId: '374839',
      }),
      { state: 'SETTLED' },
    );
    assert.deepEqual(
      await steam(configWith(approved.doFetch)).status({
        provider: 'steam',
        providerTxnId: '374839',
      }),
      { state: 'PENDING' },
    );
  });

  test('answers UNKNOWN for a transaction Steam refuses to report', async () => {
    const { doFetch } = fakeFetch([
      queryRoute(fixture('steam', 'finalize-already-committed.json')),
    ]);

    assert.deepEqual(
      await steam(configWith(doFetch)).status({
        provider: 'steam',
        providerTxnId: '999',
      }),
      { state: 'UNKNOWN' },
    );
  });
});

describe('steam report', () => {
  test('pulls the settlement report and keeps only in-window rows', async () => {
    const { doFetch, requests } = fakeFetch([
      {
        when: (url: string) => url.includes('/GetReport/'),
        body: fixture('steam', 'report-settlement.json'),
      },
    ]);

    const settlements = await steam(configWith(doFetch)).report!({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.providerTxnId, '374839');
    assert.deepEqual(settlements[0]?.gross, money('USD', 999n));
    assert.equal(settlements[0]?.sourceRef, 'steam:order:938473');
    const report = requests.find((request) =>
      request.url.includes('/GetReport/'),
    );
    assert.ok(report?.url.includes('type=SETTLEMENT'));
  });
});
