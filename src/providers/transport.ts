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

import { fault } from '../canonical/fault.ts';

import type { FetchLike } from './fetch.ts';

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
}

export interface BytesResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly bytes: Uint8Array;
}

export async function requestBytes(
  doFetch: FetchLike,
  spec: {
    readonly method: string;
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
  },
): Promise<BytesResponse> {
  const response = await send(doFetch, spec);
  if (response.arrayBuffer === undefined) {
    throw fault(
      'TRANSPORT.BINARY_UNSUPPORTED',
      'The fetch in use cannot return binary bodies.',
    );
  }
  try {
    return {
      ok: response.ok,
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (error) {
    throw fault(
      'TRANSPORT.RESPONSE_UNREADABLE',
      'The provider response body could not be read.',
      {
        retryable: true,
        cause: error,
        detail: { method: spec.method, url: spec.url },
      },
    );
  }
}

export async function requestJson(
  doFetch: FetchLike,
  spec: {
    readonly method: string;
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
): Promise<HttpResponse> {
  const response = await send(doFetch, spec);
  const text = await readBody(response, spec);
  return {
    ok: response.ok,
    status: response.status,
    body: parseJson(text),
    text,
  };
}

async function send(
  doFetch: FetchLike,
  spec: {
    readonly method: string;
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) {
  try {
    return await doFetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      signal: spec.signal,
    });
  } catch (error) {
    if (isAbort(error)) {
      throw fault(
        'TRANSPORT.TIMED_OUT',
        `The ${spec.method} request to the provider timed out.`,
        {
          retryable: true,
          cause: error,
          detail: { method: spec.method, url: spec.url },
        },
      );
    }
    throw fault(
      'TRANSPORT.REQUEST_FAILED',
      `The ${spec.method} request to the provider failed.`,
      {
        retryable: true,
        cause: error,
        detail: { method: spec.method, url: spec.url },
      },
    );
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

async function readBody(
  response: { text(): Promise<string> },
  spec: { readonly method: string; readonly url: string },
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw fault(
      'TRANSPORT.RESPONSE_UNREADABLE',
      'The provider response body could not be read.',
      {
        retryable: true,
        cause: error,
        detail: { method: spec.method, url: spec.url },
      },
    );
  }
}

function parseJson(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
