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

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { signJwt } from '#src/codec/jwt.ts';
import { verifySignature } from '#src/codec/signature.ts';

import type { SignatureScheme } from '#src/codec/signature.ts';
import type { RawWebhook } from '#src/ports/index.ts';

const workDir = mkdtempSync(join(tmpdir(), 'edge-x5c-'));

function openssl(command: string): void {
  execSync(`openssl ${command}`, { cwd: workDir, stdio: 'pipe' });
}

openssl('ecparam -name prime256v1 -genkey -noout -out root.key');
openssl('req -new -x509 -key root.key -subj /CN=TestRoot -days 2 -sha256 -out root.pem');
openssl('ecparam -name prime256v1 -genkey -noout -out leaf.key');
openssl('req -new -key leaf.key -subj /CN=TestLeaf -out leaf.csr');
openssl(
  'x509 -req -in leaf.csr -CA root.pem -CAkey root.key -CAcreateserial -days 2 -sha256 -out leaf.pem',
);
openssl('pkcs8 -topk8 -nocrypt -in leaf.key -out leaf.pk8');
openssl('ecparam -name prime256v1 -genkey -noout -out other-root.key');
openssl(
  'req -new -x509 -key other-root.key -subj /CN=OtherRoot -days 2 -sha256 -out other-root.pem',
);
openssl(
  'req -new -newkey rsa:2048 -nodes -keyout rsa-leaf.key -subj /CN=RsaLeaf -out rsa-leaf.csr',
);
openssl(
  'x509 -req -in rsa-leaf.csr -CA root.pem -CAkey root.key -CAcreateserial -days 2 -sha256 ' +
    '-out rsa-leaf.pem',
);
openssl('pkcs8 -topk8 -nocrypt -in rsa-leaf.key -out rsa-leaf.pk8');

function pemBody(name: string): string {
  return readFileSync(join(workDir, name), 'utf8')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
}

const leafDer = pemBody('leaf.pem');
const rootDer = pemBody('root.pem');
const leafKeyPem = readFileSync(join(workDir, 'leaf.pk8'), 'utf8');
const rootPem = readFileSync(join(workDir, 'root.pem'), 'utf8');
const otherRootPem = readFileSync(join(workDir, 'other-root.pem'), 'utf8');

function signedPayload(header: Record<string, unknown>): Promise<string> {
  return signJwt({
    algorithm: 'ES256',
    header,
    payload: { notificationType: 'ONE_TIME_CHARGE', signedDate: 1751500800000 },
    privateKeyPem: leafKeyPem,
  });
}

function webhookOf(jws: string): RawWebhook {
  return { provider: 'apple', headers: {}, body: JSON.stringify({ signedPayload: jws }) };
}

const pinnedScheme: SignatureScheme = { scheme: 'jws-x5c', rootCertificates: [rootPem] };

describe('jws-x5c scheme', () => {
  test('accepts a JWS whose chain terminates at the pinned root', async () => {
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, rootDer] });

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), true);
  });

  test('accepts a bare JWS body without a signedPayload envelope', async () => {
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, rootDer] });

    assert.equal(
      await verifySignature(pinnedScheme, { provider: 'apple', headers: {}, body: jws }),
      true,
    );
  });

  test('rejects a tampered payload', async () => {
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, rootDer] });
    const [header, , signature] = jws.split('.');
    const forged = Buffer.from(JSON.stringify({ notificationType: 'REFUND' })).toString(
      'base64url',
    );

    assert.equal(
      await verifySignature(pinnedScheme, webhookOf(`${header}.${forged}.${signature}`)),
      false,
    );
  });

  test('rejects a chain that terminates at an unpinned root', async () => {
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, rootDer] });
    const unpinned: SignatureScheme = { scheme: 'jws-x5c', rootCertificates: [otherRootPem] };

    assert.equal(await verifySignature(unpinned, webhookOf(jws)), false);
  });

  test('rejects a broken chain link', async () => {
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, pemBody('other-root.pem')] });

    assert.equal(
      await verifySignature(
        { scheme: 'jws-x5c', rootCertificates: [otherRootPem] },
        webhookOf(jws),
      ),
      false,
    );
  });

  test('rejects a JWS without a certificate chain', async () => {
    const jws = await signedPayload({ alg: 'ES256' });

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), false);
  });

  test('rejects a body that is neither an envelope nor a JWS', async () => {
    assert.equal(
      await verifySignature(pinnedScheme, { provider: 'apple', headers: {}, body: 'not a jws' }),
      false,
    );
  });

  test('rejects a chain outside its validity window in either direction', async () => {
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, rootDer] });
    const present = Date.now();

    for (const offsetMs of [3 * 86_400_000, -86_400_000]) {
      const shifted = mock.method(Date, 'now', () => present + offsetMs);
      try {
        assert.equal(
          await verifySignature(pinnedScheme, webhookOf(jws)),
          false,
          `offset ${offsetMs}ms`,
        );
      } finally {
        shifted.mock.restore();
      }
    }

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), true);
  });

  test('fails closed on an RSA leaf certificate', async () => {
    const jws = await signJwt({
      algorithm: 'RS256',
      header: { alg: 'ES256', x5c: [pemBody('rsa-leaf.pem'), rootDer] },
      payload: { notificationType: 'ONE_TIME_CHARGE' },
      privateKeyPem: readFileSync(join(workDir, 'rsa-leaf.pk8'), 'utf8'),
    });

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), false);
  });

  test('rejects the none algorithm and any non-ECDSA alg header', async () => {
    for (const alg of ['none', 'HS256', 'RS256']) {
      const jws = await signedPayload({ alg, x5c: [leafDer, rootDer] });

      assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), false, `alg ${alg}`);
    }
  });

  test('rejects an alg header that does not match the signing algorithm', async () => {
    const jws = await signedPayload({ alg: 'ES384', x5c: [leafDer, rootDer] });

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), false);
  });

  test('rejects a chain longer than the certificate cap', async () => {
    const padded = [leafDer, ...Array.from({ length: 6 }, () => rootDer)];
    const jws = await signedPayload({ alg: 'ES256', x5c: padded });

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), false);
  });

  test('rejects a chain entry larger than the size cap without decoding it', async () => {
    const oversized = 'A'.repeat(20_000);
    const jws = await signedPayload({ alg: 'ES256', x5c: [leafDer, oversized] });

    assert.equal(await verifySignature(pinnedScheme, webhookOf(jws)), false);
  });
});
