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

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function withRequestTimeout(doFetch: FetchLike, timeoutMs: number): FetchLike {
  return (url, init) =>
    doFetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
}

export function configuredFetch(config: {
  readonly fetch?: FetchLike;
  readonly requestTimeoutMs?: number;
}): FetchLike {
  return withRequestTimeout(
    config.fetch ?? (fetch as FetchLike),
    config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
}
