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
import { createPublicKey, generateKeyPairSync } from 'node:crypto';

import { signJwt } from '#src/codec/jwt.ts';
import { verifySignature } from '#src/codec/signature.ts';

import type { OidcJwk, SignatureScheme } from '#src/codec/signature.ts';
import type { RawWebhook } from '#src/ports/index.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as {
  kty: string;
  n: string;
  e: string;
};

const ISSUER = 'https://accounts.google.com';
const AUDIENCE = 'https://edge.example/webhooks/google';

const scheme: SignatureScheme = {
  scheme: 'oidc-jwt',
  issuer: ISSUER,
  audience: AUDIENCE,
  keys: [{ ...publicJwk, kid: 'push-key-1' } as OidcJwk],
};

function pushJwt(claims: Record<string, unknown>): Promise<string> {
  return signJwt({
    algorithm: 'RS256',
    header: { alg: 'RS256', kid: 'push-key-1' },
    payload: {
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    },
    privateKeyPem: privateKey,
  });
}

function webhookWith(authorization?: string): RawWebhook {
  return {
    provider: 'google',
    headers:
      authorization === undefined ? {} : { Authorization: authorization },
    body: '{"message":{"data":""}}',
  };
}

describe('oidc-jwt scheme', () => {
  test('accepts a push signed by a known key with the right claims', async () => {
    const jwt = await pushJwt({});

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${jwt}`)),
      true,
    );
  });

  test('rejects a wrong audience and a wrong issuer', async () => {
    const wrongAudience = await pushJwt({ aud: 'https://other.example' });
    const wrongIssuer = await pushJwt({ iss: 'https://evil.example' });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${wrongAudience}`)),
      false,
    );
    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${wrongIssuer}`)),
      false,
    );
  });

  test('rejects a token expired beyond the clock-skew window', async () => {
    const expired = await pushJwt({ exp: Math.floor(Date.now() / 1000) - 600 });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${expired}`)),
      false,
    );
  });

  test('tolerates an expiry just past when it falls inside the clock-skew window', async () => {
    const justExpired = await pushJwt({
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${justExpired}`)),
      true,
    );
  });

  test('tolerates nbf and iat slightly in the future inside the clock-skew window', async () => {
    const soon = Math.floor(Date.now() / 1000) + 60;
    const jwt = await pushJwt({ nbf: soon, iat: soon });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${jwt}`)),
      true,
    );
  });

  test('rejects nbf or iat in the future beyond the clock-skew window', async () => {
    const far = Math.floor(Date.now() / 1000) + 600;
    const futureNbf = await pushJwt({ nbf: far });
    const futureIat = await pushJwt({ iat: far });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${futureNbf}`)),
      false,
    );
    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${futureIat}`)),
      false,
    );
  });

  test('rejects non-numeric exp, nbf, and iat claims', async () => {
    const badExp = await pushJwt({ exp: 'soon' });
    const badNbf = await pushJwt({ nbf: 'now' });
    const badIat = await pushJwt({ iat: 'now' });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${badExp}`)),
      false,
    );
    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${badNbf}`)),
      false,
    );
    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${badIat}`)),
      false,
    );
  });

  test('rejects a tampered payload', async () => {
    const jwt = await pushJwt({});
    const [header, , signature] = jwt.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
        email: 'attacker@example.com',
      }),
    ).toString('base64url');

    assert.equal(
      await verifySignature(
        scheme,
        webhookWith(`Bearer ${header}.${forgedPayload}.${signature}`),
      ),
      false,
    );
  });

  test('rejects a token signed by an unknown key', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const jwt = await signJwt({
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: 'push-key-1' },
      payload: {
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      privateKeyPem: other.privateKey,
    });

    assert.equal(
      await verifySignature(scheme, webhookWith(`Bearer ${jwt}`)),
      false,
    );
  });

  test('rejects a missing or non-bearer authorization header', async () => {
    assert.equal(await verifySignature(scheme, webhookWith()), false);
    assert.equal(
      await verifySignature(scheme, webhookWith('Basic dXNlcjpwYXNz')),
      false,
    );
  });
});
