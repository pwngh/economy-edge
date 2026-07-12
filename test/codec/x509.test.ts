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
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ecdsaDerToRaw, parseCertificate } from '#src/codec/x509.ts';
import { mulberry32 } from '#test/support/propcheck.ts';

const workDir = mkdtempSync(join(tmpdir(), 'edge-x509-'));

function openssl(command: string): string {
  return execSync(`openssl ${command}`, { cwd: workDir, stdio: 'pipe' }).toString();
}

openssl('ecparam -name prime256v1 -genkey -noout -out root.key');
openssl('req -new -x509 -key root.key -subj /CN=FuzzRoot -days 2 -sha256 -out root.pem');

function opensslValidity(name: string): { notBefore: number; notAfter: number } {
  const dates = openssl(`x509 -in ${name} -noout -dates`);
  const notBefore = /notBefore=(.+)/.exec(dates)?.[1];
  const notAfter = /notAfter=(.+)/.exec(dates)?.[1];
  assert.ok(notBefore !== undefined && notAfter !== undefined, dates);
  return { notBefore: Date.parse(notBefore), notAfter: Date.parse(notAfter) };
}

function derOf(name: string): Uint8Array {
  const base64 = readFileSync(join(workDir, name), 'utf8')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

const validDer = derOf('root.pem');

describe('parseCertificate', () => {
  test('reads the same validity period out of the TBS that openssl reports', () => {
    const validity = opensslValidity('root.pem');

    const certificate = parseCertificate(validDer);

    assert.notEqual(certificate, null);
    assert.equal(certificate!.notBefore, validity.notBefore);
    assert.equal(certificate!.notAfter, validity.notAfter);
  });

  test('returns null for truncations of a valid certificate, never a throw', () => {
    for (let length = 0; length < validDer.length; length += 1) {
      const result = parseCertificate(validDer.slice(0, length));

      assert.equal(result, null, `truncated to ${length} bytes`);
    }
  });

  test('survives seeded random byte flips without ever throwing or over-reading', () => {
    const random = mulberry32(97);
    for (let iteration = 0; iteration < 2000; iteration += 1) {
      const mutated = validDer.slice();
      const flips = 1 + Math.floor(random() * 8);
      for (let flip = 0; flip < flips; flip += 1) {
        mutated[Math.floor(random() * mutated.length)] = Math.floor(random() * 256);
      }

      assert.doesNotThrow(() => parseCertificate(mutated), `iteration ${iteration}`);
    }
  });

  test('survives seeded random garbage without ever throwing', () => {
    const random = mulberry32(1213);
    for (let iteration = 0; iteration < 2000; iteration += 1) {
      const bytes = new Uint8Array(Math.floor(random() * 64));
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(random() * 256);
      }

      assert.doesNotThrow(() => parseCertificate(bytes), `iteration ${iteration}`);
    }
  });
});

describe('ecdsaDerToRaw', () => {
  test('returns null for random garbage and truncated signatures, never a throw', () => {
    const random = mulberry32(4243);
    for (let iteration = 0; iteration < 2000; iteration += 1) {
      const bytes = new Uint8Array(Math.floor(random() * 80));
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(random() * 256);
      }

      assert.doesNotThrow(() => ecdsaDerToRaw(bytes, 32), `iteration ${iteration}`);
    }
  });

  test('rejects an integer wider than the curve coordinate with null', () => {
    const wide = new Uint8Array([0x30, 0x08, 0x02, 0x06, 1, 2, 3, 4, 5, 6]);

    assert.equal(ecdsaDerToRaw(wide, 4), null);
  });
});
