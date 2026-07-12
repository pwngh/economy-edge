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

import { base64UrlOfBytes, bytesOfBase64Url, decodeBase64 } from '#src/codec/jwt.ts';
import { array, check, int, map } from '#test/support/propcheck.ts';

const bytesArbitrary = map(
  array(int(0, 255), 64),
  (values) => Uint8Array.from(values),
  (bytes) => [...bytes],
);

describe('base64 codec', () => {
  test('round-trips every byte array through url encoding unchanged', () => {
    const report = check(
      bytesArbitrary,
      (bytes) => {
        const decoded = bytesOfBase64Url(base64UrlOfBytes(bytes));
        return (
          decoded !== null &&
          decoded.length === bytes.length &&
          decoded.every((byte, index) => byte === bytes[index])
        );
      },
      { seed: 20260711, runs: 300 },
    );

    assert.ok(report.ok, JSON.stringify(report));
  });

  test('decodes exactly what the platform decoder decodes, padded or not', () => {
    const report = check(
      bytesArbitrary,
      (bytes) => {
        const padded = Buffer.from(bytes).toString('base64');
        const bare = padded.replace(/=+$/, '');
        for (const encoding of [padded, bare]) {
          const decoded = decodeBase64(encoding);
          if (decoded === null || Buffer.compare(Buffer.from(decoded), Buffer.from(bytes)) !== 0) {
            return false;
          }
        }
        return true;
      },
      { seed: 4243, runs: 300 },
    );

    assert.ok(report.ok, JSON.stringify(report));
  });

  test('tolerates whitespace and refuses malformed input with null', () => {
    assert.deepEqual([...decodeBase64('aGVs bG8=')!], [...Buffer.from('hello')]);
    assert.equal(decodeBase64('A'), null);
    assert.equal(decodeBase64('!!!!'), null);
    assert.equal(decodeBase64('AB=C'), null);
    assert.deepEqual(decodeBase64(''), Uint8Array.of());
  });
});
