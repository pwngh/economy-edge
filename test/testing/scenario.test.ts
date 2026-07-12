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

import { tilia } from '#src/providers/outbound/tilia/index.ts';
import {
  fakeInbound,
  fakeOutbound,
  tiliaPayoutWebhookBody,
  tiliaScenario,
} from '#src/testing/index.ts';
import { usd } from '#test/support/fakes.ts';

import type { TiliaScenarioOptions } from '#src/testing/index.ts';

const GARBAGE_BODIES = ['', 'not json', '123', '{}', '{"message":null}'];

describe('tiliaScenario fidelity against the real adapter', () => {
  test('an accepted submit resolves to ACCEPTED carrying the scenario ref', async () => {
    const scenario = tiliaScenario();

    const result = await tilia(scenario.config).submit({
      key: 'pay-1',
      payee: 'usr-1',
      amount: usd('2.00'),
    });

    assert.deepEqual(result, { outcome: 'ACCEPTED', ref: scenario.ref });
    assert.ok(scenario.requests.some((request) => request.method === 'POST'));
  });

  test('an indeterminate submit resolves to INDETERMINATE, a rejected one to REJECTED', async () => {
    const indeterminate = tiliaScenario({ submit: 'indeterminate' });
    const rejected = tiliaScenario({ submit: 'rejected' });
    const request = { key: 'pay-1', payee: 'usr-1', amount: usd('2.00') };

    assert.equal((await tilia(indeterminate.config).submit(request)).outcome, 'INDETERMINATE');
    assert.equal((await tilia(rejected.config).submit(request)).outcome, 'REJECTED');
  });

  test('every status option maps to that canonical state through the real adapter', async () => {
    const states: Array<NonNullable<TiliaScenarioOptions['status']>> = [
      'SETTLED',
      'RETURNED',
      'FAILED',
      'PENDING',
      'UNKNOWN',
    ];
    for (const state of states) {
      const scenario = tiliaScenario({ status: state });

      const status = await tilia(scenario.config).status({ ref: scenario.ref });

      assert.equal(status.state, state);
    }
  });

  test('report through the scenario yields the disbursement and the wallet balance', async () => {
    const scenario = tiliaScenario({ disbursed: '3.50', walletBalance: '42.00' });

    const report = await tilia(scenario.config).report(scenario.window);

    assert.equal(report.disbursements.length, 1);
    assert.equal(report.disbursements[0]!.providerTxnId, 'ps-scenario');
    assert.deepEqual(report.disbursements[0]!.net, usd('3.50'));
    assert.deepEqual(report.walletBalance, usd('42.00'));
  });

  test('every webhook body outcome parses to that canonical event through the real adapter', () => {
    const scenario = tiliaScenario();
    const adapter = tilia(scenario.config);

    for (const outcome of ['SETTLED', 'RETURNED', 'FAILED', 'PENDING'] as const) {
      const events = adapter.parse({
        provider: 'tilia',
        headers: {},
        body: tiliaPayoutWebhookBody(outcome),
      });

      assert.equal(events.length, 1);
      assert.equal(events[0]!.type, outcome);
      assert.deepEqual(events[0]!.ref, scenario.ref);
    }
  });

  test('payee onboarding through the scenario returns the hosted redirect', async () => {
    const scenario = tiliaScenario();

    const onboard = await tilia(scenario.config).payee!.onboard({ userId: 'usr-1' });

    assert.equal(
      onboard.hostedUrl,
      'https://pub.staging.tilia-inc.com/scenario/payout/nonce-scenario',
    );
  });

  test('every kyc option maps to that canonical payee state through the real adapter', async () => {
    const states: Array<NonNullable<TiliaScenarioOptions['kyc']>> = [
      'CLEARED',
      'BLOCKED',
      'PENDING',
      'NONE',
    ];
    for (const state of states) {
      const scenario = tiliaScenario({ kyc: state });

      const payee = await tilia(scenario.config).payee!.status({ userId: 'usr-1' });

      assert.equal(payee.state, state);
    }
  });
});

describe('exported fakes honor the port contracts', () => {
  test('fakeInbound answers every required verb with contract-shaped values', async () => {
    const adapter = fakeInbound();

    const verified = await adapter.verify({ provider: 'steam', proof: {} });
    const status = await adapter.status({ provider: 'steam', providerTxnId: 'txn-1' });

    assert.equal(verified.ok, true);
    assert.equal(verified.ok && verified.value.schemaVersion, 1);
    assert.equal(status.state, 'SETTLED');
  });

  test('fakeOutbound parse is total: garbage in, Unrecognized out, never a throw or a drop', () => {
    const adapter = fakeOutbound();

    for (const body of GARBAGE_BODIES) {
      const events = adapter.parse({ provider: 'tilia', headers: {}, body });

      assert.ok(events.length >= 1, JSON.stringify(body));
      for (const event of events) {
        assert.equal(event.schemaVersion, 1);
        assert.equal(event.provider, 'tilia');
        assert.notEqual(event.raw, undefined);
      }
    }
  });

  test('fakeOutbound submit and report answer with contract-shaped values', async () => {
    const adapter = fakeOutbound();

    const result = await adapter.submit({ key: 'k', payee: 'usr-1', amount: usd('1.00') });
    const report = await adapter.report({ from: '2026-07-01', to: '2026-07-02' });

    assert.equal(result.outcome, 'ACCEPTED');
    assert.deepEqual(report.disbursements, []);
    assert.equal(report.walletBalance.currency, 'USD');
  });
});
