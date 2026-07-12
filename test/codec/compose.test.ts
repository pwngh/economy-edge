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
import { ok } from '#src/canonical/outcome.ts';
import { compose } from '#src/codec/compose.ts';
import {
  fakeInbound,
  fakeOutbound,
  samplePurchase,
  sampleSettlement,
  usd,
} from '#test/support/fakes.ts';

describe('compose', () => {
  test('routes verify to the adapter with the matching provider tag', async () => {
    const calls: string[] = [];
    const edge = compose({
      inbound: [
        fakeInbound({
          provider: 'steam',
          verify: async () => {
            calls.push('steam');
            return ok(samplePurchase());
          },
        }),
        fakeInbound({
          provider: 'meta',
          verify: async () => {
            calls.push('meta');
            return ok(samplePurchase({ provider: 'meta' }));
          },
        }),
      ],
    });

    await edge.inbound.verify({ provider: 'meta', proof: {} });

    assert.deepEqual(calls, ['meta']);
  });

  test('rejects a call for a provider that is not registered', async () => {
    const edge = compose({ inbound: [fakeInbound({ provider: 'steam' })] });

    await assert.rejects(edge.inbound.verify({ provider: 'meta', proof: {} }), (error: unknown) =>
      hasCode(error, 'CODEC.UNKNOWN_PROVIDER'),
    );
  });

  test('refuses to register the same provider twice', () => {
    assert.throws(
      () => compose({ inbound: [fakeInbound(), fakeInbound()] }),
      (error: unknown) => hasCode(error, 'CODEC.DUPLICATE_PROVIDER'),
    );
  });

  test('merges inbound reports across providers', async () => {
    const edge = compose({
      inbound: [
        fakeInbound({
          provider: 'steam',
          report: async () => [sampleSettlement({ providerTxnId: 'steam-1' })],
        }),
        fakeInbound({
          provider: 'meta',
          report: async () => [sampleSettlement({ providerTxnId: 'meta-1' })],
        }),
      ],
    });

    const settlements = await edge.inbound.report({ from: 'a', to: 'b' });

    assert.deepEqual(settlements.map((settlement) => settlement.providerTxnId).sort(), [
      'meta-1',
      'steam-1',
    ]);
  });

  test('skips providers without a pull report instead of faking one', async () => {
    const edge = compose({
      inbound: [
        fakeInbound({
          provider: 'steam',
          report: async () => [sampleSettlement({ providerTxnId: 'steam-1' })],
        }),
        fakeInbound({ provider: 'meta', report: undefined }),
      ],
    });

    const settlements = await edge.inbound.report({ from: 'a', to: 'b' });

    assert.deepEqual(
      settlements.map((settlement) => settlement.providerTxnId),
      ['steam-1'],
    );
  });

  test('parses to an Unrecognized event when the adapter has no parse', () => {
    const edge = compose({ inbound: [fakeInbound({ provider: 'steam' })] });

    const events = edge.inbound.parse({
      provider: 'steam',
      headers: {},
      body: '{}',
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'Unrecognized');
    assert.notEqual(events[0]?.raw, undefined);
  });

  test('delegates fulfill and rejects it for providers without a claim step', async () => {
    const fulfilled: string[] = [];
    const edge = compose({
      inbound: [
        fakeInbound({
          provider: 'meta',
          fulfill: async (input) => {
            fulfilled.push(input.provider);
            return ok(undefined);
          },
        }),
        fakeInbound({ provider: 'steam' }),
      ],
    });

    await edge.inbound.fulfill({ provider: 'meta', proof: {} });

    assert.deepEqual(fulfilled, ['meta']);
    await assert.rejects(edge.inbound.fulfill({ provider: 'steam', proof: {} }), (error: unknown) =>
      hasCode(error, 'CODEC.UNSUPPORTED'),
    );
  });

  test('submits through the sole outbound provider', async () => {
    const edge = compose({ outbound: [fakeOutbound()] });

    const result = await edge.outbound.submit({
      key: 'saga-1',
      payee: 'usr-1',
      amount: usd('20.00'),
    });

    assert.equal(result.outcome, 'ACCEPTED');
  });

  test('rejects a submit with no outbound provider registered', async () => {
    const edge = compose({});

    await assert.rejects(
      edge.outbound.submit({ key: 'k', payee: 'p', amount: usd('1.00') }),
      (error: unknown) => hasCode(error, 'CODEC.NO_OUTBOUND'),
    );
  });

  test('rejects an unaddressed call with several outbound providers', async () => {
    const edge = compose({
      outbound: [fakeOutbound({ provider: 'tilia' }), fakeOutbound({ provider: 'meta' })],
    });

    await assert.rejects(edge.outbound.report({ from: 'a', to: 'b' }), (error: unknown) =>
      hasCode(error, 'CODEC.AMBIGUOUS_OUTBOUND'),
    );
  });

  test('routes a status query by its PayoutRef provider', async () => {
    const states: string[] = [];
    const edge = compose({
      outbound: [
        fakeOutbound({
          provider: 'tilia',
          status: async () => {
            states.push('tilia');
            return { state: 'SETTLED' };
          },
        }),
        fakeOutbound({ provider: 'meta' }),
      ],
    });

    await edge.outbound.status({ ref: { provider: 'tilia', id: 'payout-1' } });

    assert.deepEqual(states, ['tilia']);
  });

  test('rejects payee calls when the provider does not host onboarding', async () => {
    const edge = compose({ outbound: [fakeOutbound()] });

    await assert.rejects(edge.outbound.payee.status({ userId: 'usr-1' }), (error: unknown) =>
      hasCode(error, 'CODEC.UNSUPPORTED'),
    );
  });

  test('delegates payee calls when the provider hosts onboarding', async () => {
    const edge = compose({
      outbound: [
        fakeOutbound({
          payee: {
            status: async () => ({ state: 'CLEARED' }),
            onboard: async () => ({ hostedUrl: 'https://onboard.example' }),
          },
        }),
      ],
    });

    const gate = await edge.outbound.payee.status({ userId: 'usr-1' });

    assert.equal(gate.state, 'CLEARED');
  });

  test('rejects cancel when the provider does not support it', async () => {
    const edge = compose({ outbound: [fakeOutbound()] });

    await assert.rejects(
      edge.outbound.cancel({ provider: 'tilia', id: 'payout-1' }),
      (error: unknown) => hasCode(error, 'CODEC.UNSUPPORTED'),
    );
  });
});
