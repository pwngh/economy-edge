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

import type { FetchLike } from '../providers/fetch.ts';

export interface Route {
  readonly when: (url: string, method: string) => boolean;
  readonly status?: number;
  readonly body?: string;
  readonly bodyBytes?: Uint8Array;
  readonly fail?: boolean;
}

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export function fakeFetch(routes: Route[]): { doFetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const doFetch: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ?? '',
    });
    const route = routes.find((candidate) => candidate.when(url, init?.method ?? 'GET'));
    if (route === undefined) {
      return routeResponse({ when: () => true, status: 404, body: '' });
    }
    if (route.fail === true) {
      throw new Error('socket hang up');
    }
    return routeResponse(route);
  };
  return { doFetch, requests };
}

function routeResponse(route: Route) {
  const status = route.status ?? 200;
  const bytes = route.bodyBytes ?? new TextEncoder().encode(route.body ?? '');
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => route.body ?? new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
}
