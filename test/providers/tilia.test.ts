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

import { hasCode } from '#src/canonical/fault.ts';
import { money } from '#src/canonical/money.ts';
import { tilia } from '#src/providers/outbound/tilia/index.ts';
import { payoutStateOf } from '#src/providers/outbound/tilia/status.ts';
import { fixture } from '#test/support/fixtures.ts';
import { usd } from '#test/support/fakes.ts';

import type { FetchLike } from '#src/providers/fetch.ts';
import type { TiliaConfig } from '#src/providers/outbound/tilia/index.ts';
import type { RawWebhook } from '#src/ports/index.ts';

interface Route {
  readonly when: (url: string, method: string) => boolean;
  readonly status?: number;
  readonly body?: string;
  readonly fail?: boolean;
}

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function fakeTilia(routes: Route[]): {
  doFetch: FetchLike;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const doFetch: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ?? '',
    });
    if (url.endsWith('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => fixture('tilia', 'token.json'),
      };
    }
    for (const route of routes) {
      if (route.when(url, init?.method ?? 'GET')) {
        if (route.fail === true) {
          throw new Error('socket hang up');
        }
        const status = route.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => route.body ?? '',
        };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return { doFetch, requests };
}

function configWith(doFetch: FetchLike): TiliaConfig {
  return {
    environment: 'staging',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    integratorAccountId: 'acct-integrator',
    resolvePayee: async () => ({
      accountId: 'acct-payee-1',
      sourcePaymentMethodId: 'pm-wallet-1',
      destinationPaymentMethodId: 'pm-paypal-1',
    }),
    webhookVerification: { scheme: 'transport' },
    fetch: doFetch,
  };
}

function payoutRequest() {
  return { key: 'saga-123', payee: 'usr-1', amount: usd('20.00') };
}

function webhookOf(name: string): RawWebhook {
  return { provider: 'tilia', headers: {}, body: fixture('tilia', name) };
}

const submitRoute = (status: number, body: string): Route => ({
  when: (url, method) => url.includes('/payout') && method === 'POST',
  status,
  body,
});

describe('tilia submit', () => {
  test('accepts a payout and returns a composite ref against the staging host', async () => {
    const { doFetch, requests } = fakeTilia([
      submitRoute(201, fixture('tilia', 'payout-accepted.json')),
    ]);

    const result = await tilia(configWith(doFetch)).submit(payoutRequest());

    assert.deepEqual(result, {
      outcome: 'ACCEPTED',
      ref: { provider: 'tilia', id: 'acct-payee-1/pst-expected-1' },
    });
    const submit = requests.find(
      (request) => request.method === 'POST' && request.url.includes('/payout'),
    );
    assert.ok(
      submit?.url.startsWith(
        'https://invoicing.staging.tilia-inc.com/v2/acct-payee-1/',
      ),
    );
    assert.deepEqual(JSON.parse(submit?.body ?? ''), {
      source_payment_method_id: 'pm-wallet-1',
      destination_payment_method_id: 'pm-paypal-1',
      amount: 2000,
      currency: 'USD',
    });
  });

  test('derives the same idempotency key for the same caller key on every attempt', async () => {
    const { doFetch, requests } = fakeTilia([
      submitRoute(201, fixture('tilia', 'payout-accepted.json')),
    ]);
    const provider = tilia(configWith(doFetch));

    await provider.submit(payoutRequest());
    await provider.submit(payoutRequest());

    const keys = requests
      .filter(
        (request) =>
          request.method === 'POST' && request.url.includes('/payout'),
      )
      .map((request) => request.headers['idempotency-key']);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.match(
      keys[0] ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('maps a duplicate-key 409 to INDETERMINATE', async () => {
    const { doFetch } = fakeTilia([submitRoute(409, '{"status":"Conflict"}')]);

    const result = await tilia(configWith(doFetch)).submit(payoutRequest());

    assert.deepEqual(result, { outcome: 'INDETERMINATE', retryable: true });
  });

  test('maps a 5xx to INDETERMINATE', async () => {
    const { doFetch } = fakeTilia([submitRoute(503, '')]);

    const result = await tilia(configWith(doFetch)).submit(payoutRequest());

    assert.deepEqual(result, { outcome: 'INDETERMINATE', retryable: true });
  });

  test('maps a lost request to INDETERMINATE, never a blind retry signal', async () => {
    const { doFetch } = fakeTilia([
      {
        when: (url, method) => url.includes('/payout') && method === 'POST',
        fail: true,
      },
    ]);

    const result = await tilia(configWith(doFetch)).submit(payoutRequest());

    assert.deepEqual(result, { outcome: 'INDETERMINATE', retryable: true });
  });

  test('maps a terminal 4xx to REJECTED', async () => {
    const { doFetch } = fakeTilia([
      submitRoute(422, '{"status":"Unprocessable"}'),
    ]);

    const result = await tilia(configWith(doFetch)).submit(payoutRequest());

    assert.deepEqual(result, { outcome: 'REJECTED', reason: 'REJECTED' });
  });

  test('throws retryable on rate limiting instead of compensating', async () => {
    const { doFetch } = fakeTilia([submitRoute(429, '')]);

    await assert.rejects(
      tilia(configWith(doFetch)).submit(payoutRequest()),
      (error: unknown) => hasCode(error, 'TILIA.RATE_LIMITED'),
    );
  });

  test('refuses an amount that cannot ride a JSON integer', async () => {
    const { doFetch } = fakeTilia([]);

    await assert.rejects(
      tilia(configWith(doFetch)).submit({
        key: 'saga-123',
        payee: 'usr-1',
        amount: money('USD', 9007199254740992n),
      }),
      (error: unknown) => hasCode(error, 'TILIA.AMOUNT_OUT_OF_RANGE'),
    );
  });
});

describe('tilia auth', () => {
  test('surfaces the captured staging token failure as an auth fault', async () => {
    const doFetch: FetchLike = async (url) => {
      if (url.endsWith('/token')) {
        return {
          ok: false,
          status: 400,
          text: async () => fixture('tilia', 'token-invalid-client.json'),
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    };

    await assert.rejects(
      tilia(configWith(doFetch)).submit(payoutRequest()),
      (error: unknown) => hasCode(error, 'TILIA.AUTH_FAILED'),
    );
  });
});

describe('tilia status', () => {
  const statusRoute = (name: string): Route => ({
    when: (url, method) =>
      url.includes('/payout/pst-expected-1') && method === 'GET',
    body: fixture('tilia', name),
  });
  const ref = { provider: 'tilia', id: 'acct-payee-1/pst-expected-1' } as const;

  test('maps SUCCESS to SETTLED', async () => {
    const { doFetch } = fakeTilia([statusRoute('payout-status-success.json')]);

    assert.deepEqual(await tilia(configWith(doFetch)).status({ ref }), {
      state: 'SETTLED',
    });
  });

  test('maps FUNDS-IN-ESCROW to PENDING', async () => {
    const { doFetch } = fakeTilia([statusRoute('payout-status-escrow.json')]);

    assert.deepEqual(await tilia(configWith(doFetch)).status({ ref }), {
      state: 'PENDING',
    });
  });

  test('maps USER-REVERSED to RETURNED', async () => {
    const { doFetch } = fakeTilia([
      statusRoute('payout-status-user-reversed.json'),
    ]);

    assert.deepEqual(await tilia(configWith(doFetch)).status({ ref }), {
      state: 'RETURNED',
    });
  });

  test('maps an unknown payout to UNKNOWN', async () => {
    const { doFetch } = fakeTilia([]);

    assert.deepEqual(await tilia(configWith(doFetch)).status({ ref }), {
      state: 'UNKNOWN',
    });
  });

  test('maps every documented in-flight status to PENDING, never UNKNOWN', () => {
    const inFlight = [
      'ESCROW-TRANSFER-INITIATED',
      'CREDIT-TRANSFER-INITIATED',
      'FUNDS-IN-ESCROW',
      'TILIA-ONHOLD',
      'PROVIDER-ONHOLD',
      'USER-REVERSE-FAILED',
      'USER-REVERSE-TRANSFER-INITIATED',
      'SUPPORT-REJECT-FAILED',
      'SUPPORT-REJECT-TRANSFER-INITIATED',
      'SYSTEM-REJECT-FAILED',
    ];
    for (const status of inFlight) {
      assert.equal(payoutStateOf(status), 'PENDING');
    }
  });

  test('refuses a lookup by caller key as unverified', async () => {
    const { doFetch } = fakeTilia([]);

    await assert.rejects(
      tilia(configWith(doFetch)).status({ key: 'saga-123' }),
      (error: unknown) => hasCode(error, 'TILIA.KEY_LOOKUP_UNVERIFIED'),
    );
  });
});

describe('tilia parse', () => {
  const provider = tilia(configWith(fakeTilia([]).doFetch));

  test('normalizes a settled payout webhook with its ref', () => {
    const events = provider.parse(webhookOf('webhook-payout-settled.json'));

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'SETTLED');
    assert.deepEqual(events[0]?.ref, {
      provider: 'tilia',
      id: 'acct-payee-1/pst-expected-1',
    });
  });

  test('normalizes a failed payout webhook to a FAILED event carrying the documented failure fields', () => {
    const events = provider.parse(webhookOf('webhook-payout-failed.json'));

    assert.equal(events[0]?.type, 'FAILED');
    assert.equal(events[0]?.failureCode, 'generic_error');
    assert.equal(events[0]?.failureReason, 'an error occurred');
  });

  test('normalizes a reversed payout webhook to a RETURNED event', () => {
    const events = provider.parse(webhookOf('webhook-payout-returned.json'));

    assert.equal(events[0]?.type, 'RETURNED');
  });

  test('normalizes an in-flight payout webhook to PENDING with its ref, never Unrecognized', () => {
    const events = provider.parse(webhookOf('webhook-payout-pending.json'));

    assert.equal(events[0]?.type, 'PENDING');
    assert.deepEqual(events[0]?.ref, {
      provider: 'tilia',
      id: 'acct-payee-1/pst-expected-1',
    });
    assert.equal(events[0]?.failureCode, undefined);
  });

  test('normalizes KYC results to payee events', () => {
    assert.equal(
      provider.parse(webhookOf('webhook-kyc-cleared.json'))[0]?.type,
      'KYC_CLEARED',
    );
    assert.equal(
      provider.parse(webhookOf('webhook-kyc-blocked.json'))[0]?.type,
      'KYC_BLOCKED',
    );
  });

  test('surfaces an unknown event as Unrecognized, never dropped', () => {
    const events = provider.parse(webhookOf('webhook-unrecognized.json'));

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'Unrecognized');
    assert.notEqual(events[0]?.raw, undefined);
  });

  test('surfaces a body that is not JSON as Unrecognized', () => {
    const events = provider.parse({
      provider: 'tilia',
      headers: {},
      body: 'not json',
    });

    assert.equal(events[0]?.type, 'Unrecognized');
  });
});

describe('tilia payee', () => {
  const kycRoute = (name: string): Route => ({
    when: (url) => url.includes('/v1/kyc/acct-payee-1'),
    body: fixture('tilia', name),
  });

  test('maps ACCEPT to CLEARED', async () => {
    const { doFetch } = fakeTilia([kycRoute('kyc-accept.json')]);

    assert.deepEqual(
      await tilia(configWith(doFetch)).payee?.status({ userId: 'usr-1' }),
      {
        state: 'CLEARED',
      },
    );
  });

  test('maps DENY to BLOCKED and PROCESSING to PENDING', async () => {
    const denied = fakeTilia([kycRoute('kyc-deny.json')]);
    const processing = fakeTilia([kycRoute('kyc-processing.json')]);

    assert.deepEqual(
      await tilia(configWith(denied.doFetch)).payee?.status({
        userId: 'usr-1',
      }),
      {
        state: 'BLOCKED',
      },
    );
    assert.deepEqual(
      await tilia(configWith(processing.doFetch)).payee?.status({
        userId: 'usr-1',
      }),
      { state: 'PENDING' },
    );
  });

  test('maps a missing KYC record to NONE', async () => {
    const { doFetch } = fakeTilia([]);

    assert.deepEqual(
      await tilia(configWith(doFetch)).payee?.status({ userId: 'usr-1' }),
      {
        state: 'NONE',
      },
    );
  });

  test('onboarding begins the documented hosted payout flow and returns its redirect', async () => {
    const onboardRoute: Route = {
      when: (url, method) =>
        url.endsWith('/authorize/user') && method === 'POST',
      body: fixture('tilia', 'authorize-user.json'),
    };
    const { doFetch, requests } = fakeTilia([onboardRoute]);

    const result = await tilia(configWith(doFetch)).payee!.onboard({
      userId: 'usr-1',
    });

    assert.equal(
      result.hostedUrl,
      'https://pub.tilia-inc.com/testpublisher/txnhistory/133fafce-80ab-42f6-82b1-7266d9bab91d',
    );
    const call = requests.find((request) =>
      request.url.endsWith('/authorize/user'),
    );
    assert.equal(
      call?.url,
      'https://auth.staging.tilia-inc.com/authorize/user',
    );
    assert.deepEqual(JSON.parse(call!.body), {
      account_id: 'acct-payee-1',
      mechanism: 'tilia_hosted',
      flow: 'payout',
    });
  });

  test('a failed hosted-flow authorization is a fault, retryable on a 5xx', async () => {
    const { doFetch } = fakeTilia([
      { when: (url) => url.endsWith('/authorize/user'), status: 503, body: '' },
    ]);

    await assert.rejects(
      tilia(configWith(doFetch)).payee!.onboard({ userId: 'usr-1' }),
      (error: unknown) => hasCode(error, 'TILIA.ONBOARD_FAILED'),
    );
  });
});

describe('tilia cancel', () => {
  const ref = { provider: 'tilia', id: 'acct-payee-1/pst-expected-1' } as const;
  const cancelRoute = (status: number): Route => ({
    when: (url, method) =>
      url.includes('/payout/pst-expected-1') && method === 'DELETE',
    status,
    body: '',
  });

  test('cancels a pre-settlement payout through the spec-backed DELETE', async () => {
    const { doFetch, requests } = fakeTilia([cancelRoute(200)]);

    const outcome = await tilia(configWith(doFetch)).cancel!(ref);

    assert.deepEqual(outcome, { ok: true, value: undefined });
    assert.ok(
      requests.some(
        (request) =>
          request.method === 'DELETE' &&
          request.url.includes('/v2/acct-payee-1/payout/'),
      ),
    );
  });

  test('rejects a cancel that raced settlement as ALREADY_SETTLED', async () => {
    const { doFetch } = fakeTilia([cancelRoute(409)]);

    const outcome = await tilia(configWith(doFetch)).cancel!(ref);

    assert.deepEqual(outcome, { ok: false, reason: 'ALREADY_SETTLED' });
  });

  test('rejects an uncancelable payout as a value', async () => {
    const { doFetch } = fakeTilia([cancelRoute(422)]);

    const outcome = await tilia(configWith(doFetch)).cancel!(ref);

    assert.deepEqual(outcome, { ok: false, reason: 'REJECTED' });
  });
});

describe('tilia report', () => {
  test('reports in-window settled disbursements and the wallet balance', async () => {
    const { doFetch } = fakeTilia([
      {
        when: (url) => url.includes('/v2/acct-integrator/payouts'),
        body: fixture('tilia', 'payouts-list.json'),
      },
      {
        when: (url) => url.includes('/balances/acct-integrator'),
        body: fixture('tilia', 'balances.json'),
      },
    ]);

    const report = await tilia(configWith(doFetch)).report({
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-08T00:00:00Z',
    });

    assert.equal(report.disbursements.length, 1);
    assert.equal(report.disbursements[0]?.providerTxnId, 'pst-in-window');
    assert.deepEqual(report.disbursements[0]?.gross, money('USD', 2000n));
    assert.deepEqual(report.walletBalance, money('USD', 150000n));
  });
});

describe('tilia verify', () => {
  const SECRET = 'tilia-webhook-secret';

  function hmacConfig(doFetch: FetchLike): TiliaConfig {
    return {
      ...configWith(doFetch),
      webhookVerification: {
        scheme: 'hmac-sha256',
        secret: SECRET,
        header: 'x-tilia-signature',
      },
    };
  }

  function sign(body: string): string {
    return createHmac('sha256', SECRET).update(body).digest('hex');
  }

  test('accepts a callback signed with the configured secret', async () => {
    const { doFetch } = fakeTilia([]);
    const body = fixture('tilia', 'webhook-payout-settled.json');

    const verified = await tilia(hmacConfig(doFetch)).verify({
      provider: 'tilia',
      headers: { 'x-tilia-signature': sign(body) },
      body,
    });

    assert.equal(verified, true);
  });

  test('rejects a tampered body and a missing signature header', async () => {
    const { doFetch } = fakeTilia([]);
    const body = fixture('tilia', 'webhook-payout-settled.json');
    const provider = tilia(hmacConfig(doFetch));

    assert.equal(
      await provider.verify({
        provider: 'tilia',
        headers: { 'x-tilia-signature': sign(`${body} `) },
        body,
      }),
      false,
    );
    assert.equal(
      await provider.verify({ provider: 'tilia', headers: {}, body }),
      false,
    );
  });

  test('the transport scheme accepts everything, by declaration', async () => {
    const { doFetch } = fakeTilia([]);

    const verified = await tilia(configWith(doFetch)).verify(
      webhookOf('webhook-payout-settled.json'),
    );

    assert.equal(verified, true);
  });
});

describe('tilia balance', () => {
  test('reads the wallet balance without fabricating a report window', async () => {
    const { doFetch, requests } = fakeTilia([
      {
        when: (url) => url.includes('/balances/acct-integrator'),
        body: fixture('tilia', 'balances.json'),
      },
    ]);

    const balance = await tilia(configWith(doFetch)).balance();

    assert.deepEqual(balance, money('USD', 150000n));
    assert.equal(
      requests.some((request) => request.url.includes('/payouts')),
      false,
    );
  });
});
