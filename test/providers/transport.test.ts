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
import { withRequestTimeout } from '#src/providers/fetch.ts';
import { requestJson } from '#src/providers/transport.ts';

import type { FetchLike } from '#src/providers/fetch.ts';

function fetchReturning(status: number, text: string): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  });
}

describe('requestJson', () => {
  test('parses a JSON body and reports the HTTP outcome', async () => {
    const response = await requestJson(fetchReturning(200, '{"id":"txn-1"}'), {
      method: 'GET',
      url: 'https://provider.example/txn',
    });

    assert.deepEqual(response, {
      ok: true,
      status: 200,
      body: { id: 'txn-1' },
      text: '{"id":"txn-1"}',
    });
  });

  test('returns a non-2xx as a value, never a throw', async () => {
    const response = await requestJson(fetchReturning(409, '{"error":"duplicate"}'), {
      method: 'POST',
      url: 'https://provider.example/payout',
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'duplicate' });
  });

  test('tolerates an empty or non-JSON body as a null body', async () => {
    const empty = await requestJson(fetchReturning(204, ''), {
      method: 'POST',
      url: 'https://provider.example/ack',
    });
    const html = await requestJson(fetchReturning(502, '<html>bad gateway</html>'), {
      method: 'GET',
      url: 'https://provider.example/txn',
    });

    assert.equal(empty.body, null);
    assert.equal(html.body, null);
    assert.equal(html.text, '<html>bad gateway</html>');
  });

  test('wraps a failed send as a retryable transport fault', async () => {
    const failingFetch: FetchLike = async () => {
      throw new Error('socket hang up');
    };

    await assert.rejects(
      requestJson(failingFetch, { method: 'GET', url: 'https://provider.example/txn' }),
      (error: unknown) =>
        hasCode(error, 'TRANSPORT.REQUEST_FAILED') && (error as { retryable: boolean }).retryable,
    );
  });

  test('wraps an unreadable body as a retryable transport fault', async () => {
    const unreadable: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('aborted mid-body');
      },
    });

    await assert.rejects(
      requestJson(unreadable, { method: 'GET', url: 'https://provider.example/txn' }),
      (error: unknown) => hasCode(error, 'TRANSPORT.RESPONSE_UNREADABLE'),
    );
  });

  test('names a timed-out request as a retryable TRANSPORT.TIMED_OUT fault', async () => {
    const timingOut: FetchLike = async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };

    await assert.rejects(
      requestJson(timingOut, { method: 'GET', url: 'https://provider.example/txn' }),
      (error: unknown) =>
        hasCode(error, 'TRANSPORT.TIMED_OUT') && (error as { retryable: boolean }).retryable,
    );
  });
});

describe('withRequestTimeout', () => {
  test('injects a timeout signal when the caller supplies none', async () => {
    const seen: unknown[] = [];
    const recording: FetchLike = async (_url, init) => {
      seen.push(init?.signal);
      return { ok: true, status: 200, text: async () => '' };
    };

    await withRequestTimeout(recording, 1000)('https://provider.example/txn');

    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof AbortSignal);
  });

  test('preserves a caller-supplied signal instead of replacing it', async () => {
    const seen: unknown[] = [];
    const recording: FetchLike = async (_url, init) => {
      seen.push(init?.signal);
      return { ok: true, status: 200, text: async () => '' };
    };
    const supplied = AbortSignal.timeout(60_000);

    await withRequestTimeout(recording, 1000)('https://provider.example/txn', {
      signal: supplied,
    });

    assert.equal(seen[0], supplied);
  });

  test('turns a hung provider into a TRANSPORT.TIMED_OUT fault instead of hanging', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, rejectWith) => {
        const signal = init?.signal as unknown as AbortSignal & {
          addEventListener(type: string, listener: () => void): void;
        };
        signal.addEventListener('abort', () => rejectWith(signal.reason));
      });

    const keepEventLoopAlive = setTimeout(() => {}, 5000);
    try {
      await assert.rejects(
        requestJson(withRequestTimeout(hanging, 5), {
          method: 'GET',
          url: 'https://provider.example/txn',
        }),
        (error: unknown) =>
          hasCode(error, 'TRANSPORT.TIMED_OUT') && (error as { retryable: boolean }).retryable,
      );
    } finally {
      clearTimeout(keepEventLoopAlive);
    }
  });
});
