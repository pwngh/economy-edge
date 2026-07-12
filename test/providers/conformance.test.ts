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

import { apple } from '#src/providers/inbound/apple/index.ts';
import { google } from '#src/providers/inbound/google/index.ts';
import { meta } from '#src/providers/inbound/meta/index.ts';
import { pico } from '#src/providers/inbound/pico/index.ts';
import { steam } from '#src/providers/inbound/steam/index.ts';
import { tilia } from '#src/providers/outbound/tilia/index.ts';
import { usd } from '#test/support/fakes.ts';

import type { ProviderId } from '#src/canonical/index.ts';
import type { FetchLike } from '#src/providers/fetch.ts';
import type { InboundProvider, OutboundProvider } from '#src/ports/index.ts';

const offline: FetchLike = async () => ({ ok: false, status: 404, text: async () => '' });

const catalogEntry = () => ({ amount: usd('1.00'), productType: 'CONSUMABLE' as const });

const rsaPrivateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

const ecPrivateKey = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

interface InboundCase {
  readonly id: ProviderId;
  readonly build: (doFetch: FetchLike) => InboundProvider;
  readonly validProof: unknown;
  readonly malformedProofCode: string;
}

const INBOUND: InboundCase[] = [
  {
    id: 'steam',
    build: (doFetch) =>
      steam({ publisherWebApiKey: 'key', appId: 1, environment: 'sandbox', fetch: doFetch }),
    validProof: { orderId: '123' },
    malformedProofCode: 'STEAM.MALFORMED_PROOF',
  },
  {
    id: 'meta',
    build: (doFetch) =>
      meta({ appId: 'app', appSecret: 'secret', resolveSku: catalogEntry, fetch: doFetch }),
    validProof: { userId: 'usr-1', sku: 'sku-1' },
    malformedProofCode: 'META.MALFORMED_PROOF',
  },
  {
    id: 'google',
    build: (doFetch) =>
      google({
        packageName: 'com.example',
        serviceAccountEmail: 'svc@example.iam.gserviceaccount.com',
        serviceAccountPrivateKey: rsaPrivateKey,
        resolveSku: catalogEntry,
        financialReportsBucket: 'pubsite_prod_rev_0123456789',
        fetch: doFetch,
      }),
    validProof: { productId: 'sku-1', purchaseToken: 'token-1' },
    malformedProofCode: 'GOOGLE.MALFORMED_PROOF',
  },
  {
    id: 'apple',
    build: (doFetch) =>
      apple({
        environment: 'sandbox',
        bundleId: 'com.example',
        issuerId: 'issuer',
        keyId: 'key',
        privateKey: ecPrivateKey,
        reports: { issuerId: 'issuer', keyId: 'key', privateKey: ecPrivateKey, vendorNumber: '1' },
        fetch: doFetch,
      }),
    validProof: { transactionId: '2000000123456789' },
    malformedProofCode: 'APPLE.MALFORMED_PROOF',
  },
  {
    id: 'pico',
    build: (doFetch) =>
      pico({
        region: 'global',
        appId: 'app',
        appSecret: 'secret',
        resolveSku: catalogEntry,
        fetch: doFetch,
      }),
    validProof: { userAccessToken: 'token-1', userId: 'usr-1', sku: 'sku-1' },
    malformedProofCode: 'PICO.MALFORMED_PROOF',
  },
];

interface OutboundCase {
  readonly id: ProviderId;
  readonly build: (doFetch: FetchLike) => OutboundProvider;
}

const OUTBOUND: OutboundCase[] = [
  {
    id: 'tilia',
    build: (doFetch) =>
      tilia({
        environment: 'staging',
        clientId: 'client',
        clientSecret: 'secret',
        integratorAccountId: 'acct',
        resolvePayee: async () => ({
          accountId: 'acct',
          sourcePaymentMethodId: 'pm-1',
          destinationPaymentMethodId: 'pm-2',
        }),
        webhookVerification: { scheme: 'transport' },
        fetch: doFetch,
      }),
  },
];

const GARBAGE_BODIES = [
  '',
  'not json',
  '123',
  '"text"',
  '[]',
  '{}',
  '{"message":null}',
  '{"message":7}',
  '{"entry":"x"}',
  '{"entry":[{}]}',
  '{"signedPayload":42}',
  '{"message":{"data":"!!!not-base64!!!"}}',
];

const HOSTILE_FETCHES: Array<{ readonly label: string; readonly doFetch: FetchLike }> = [
  {
    label: 'a connection that dies',
    doFetch: async () => {
      throw new Error('socket hang up');
    },
  },
  { label: 'an HTTP 500 with a non-JSON body', doFetch: respondingWith(500, '<html>oops</html>') },
  { label: 'an HTTP 200 with truncated JSON', doFetch: respondingWith(200, '{"broken":') },
  { label: 'an HTTP 200 with an alien shape', doFetch: respondingWith(200, '{"weird":[7]}') },
];

const NARROW_WINDOW = { from: '2026-07-01T00:00:00Z', to: '2026-07-02T00:00:00Z' };

function respondingWith(status: number, body: string): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  });
}

async function assertCodedFaultOrValue(call: () => Promise<unknown>, context: string) {
  try {
    await call();
  } catch (error) {
    assert.equal(
      typeof (error as { code?: unknown }).code,
      'string',
      `${context} leaked a bare error: ${String(error)}`,
    );
  }
}

describe('provider conformance', () => {
  for (const { id, build, validProof, malformedProofCode } of INBOUND) {
    const adapter = build(offline);
    describe(id, () => {
      test('carries its own provider tag', () => {
        assert.equal(adapter.provider, id);
      });

      test('refuses a malformed proof with a named fault before any network call', async () => {
        for (const proof of [{}, null, 'text', 42]) {
          await assert.rejects(
            adapter.verify({ provider: id, proof }),
            (error: unknown) => (error as { code?: unknown }).code === malformedProofCode,
            `proof ${JSON.stringify(proof)} must be refused`,
          );
        }
      });

      if (adapter.fulfill !== undefined) {
        test('refuses a malformed fulfill proof with the same named fault', async () => {
          for (const proof of [{}, null, 'text', 42]) {
            await assert.rejects(
              adapter.fulfill!({ provider: id, proof }),
              (error: unknown) => (error as { code?: unknown }).code === malformedProofCode,
              `proof ${JSON.stringify(proof)} must be refused`,
            );
          }
        });
      }

      if (adapter.parse !== undefined) {
        test('parse is total: garbage in, Unrecognized out, never a throw or a drop', () => {
          for (const body of GARBAGE_BODIES) {
            const events = adapter.parse!({ provider: id, headers: {}, body });

            assert.ok(Array.isArray(events), `body ${JSON.stringify(body)} must yield an array`);
            assert.ok(events.length >= 1, `body ${JSON.stringify(body)} must never be dropped`);
            for (const event of events) {
              assert.equal(event.schemaVersion, 1);
              assert.equal(event.provider, id);
              if (event.type === 'Unrecognized') {
                assert.notEqual(event.raw, undefined);
              }
            }
          }
        });
      }

      test('answers every network verb with a value or a coded fault, never a bare error', async () => {
        for (const { label, doFetch } of HOSTILE_FETCHES) {
          const hostile = build(doFetch);
          const calls: Array<[string, () => Promise<unknown>]> = [
            ['verify', () => hostile.verify({ provider: id, proof: validProof })],
            ['status', () => hostile.status({ provider: id, providerTxnId: '1' })],
          ];
          if (hostile.fulfill !== undefined) {
            calls.push(['fulfill', () => hostile.fulfill!({ provider: id, proof: validProof })]);
          }
          if (hostile.report !== undefined) {
            calls.push(['report', () => hostile.report!(NARROW_WINDOW)]);
          }
          for (const [verb, call] of calls) {
            await assertCodedFaultOrValue(call, `${id}.${verb} against ${label}`);
          }
        }
      });
    });
  }

  for (const { id, build } of OUTBOUND) {
    const adapter = build(offline);
    describe(id, () => {
      test('carries its own provider tag', () => {
        assert.equal(adapter.provider, id);
      });

      test('refuses a blank caller key before any network call', async () => {
        for (const key of ['', '   ']) {
          await assert.rejects(
            adapter.submit({ key, payee: 'usr-1', amount: usd('1.00') }),
            (error: unknown) => (error as { code?: unknown }).code === 'CODEC.KEY_REQUIRED',
          );
        }
      });

      test('parse is total: garbage in, Unrecognized out, never a throw or a drop', () => {
        for (const body of GARBAGE_BODIES) {
          const events = adapter.parse({ provider: id, headers: {}, body });

          assert.ok(Array.isArray(events));
          assert.ok(events.length >= 1, `body ${JSON.stringify(body)} must never be dropped`);
          for (const event of events) {
            assert.equal(event.schemaVersion, 1);
            assert.equal(event.provider, id);
            if (event.type === 'Unrecognized') {
              assert.notEqual(event.raw, undefined);
            }
          }
        }
      });

      test('answers every network verb with a value or a coded fault, never a bare error', async () => {
        const ref = { provider: id, id: 'acct/ps-1' } as const;
        for (const { label, doFetch } of HOSTILE_FETCHES) {
          const hostile = build(doFetch);
          const calls: Array<[string, () => Promise<unknown>]> = [
            ['submit', () => hostile.submit({ key: 'key-1', payee: 'usr-1', amount: usd('1.00') })],
            ['status', () => hostile.status({ ref })],
            ['report', () => hostile.report(NARROW_WINDOW)],
          ];
          if (hostile.cancel !== undefined) {
            calls.push(['cancel', () => hostile.cancel!(ref)]);
          }
          if (hostile.payee !== undefined) {
            calls.push(['payee.status', () => hostile.payee!.status({ userId: 'usr-1' })]);
          }
          for (const [verb, call] of calls) {
            await assertCodedFaultOrValue(call, `${id}.${verb} against ${label}`);
          }
        }
      });
    });
  }
});
