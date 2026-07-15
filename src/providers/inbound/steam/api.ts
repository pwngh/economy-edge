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

import { fault } from '../../../canonical/fault.ts';
import { requestJson } from '../../transport.ts';

import type { FetchLike } from '../../fetch.ts';
import type { SteamConfig } from './config.ts';

export type SteamCall =
  | {
      readonly result: 'ok';
      readonly params: Readonly<Record<string, unknown>>;
    }
  | { readonly result: 'failure'; readonly errorcode: number };

export async function steamGet(
  config: SteamConfig,
  doFetch: FetchLike,
  call: { readonly path: string; readonly params: Record<string, string> },
): Promise<SteamCall> {
  const response = await requestJson(doFetch, {
    method: 'GET',
    url: `${interfaceUrl(config)}/${call.path}/?${encodeParams(config, call.params)}`,
  });
  return unwrap(response.ok, response.status, response.body);
}

export async function steamPost(
  config: SteamConfig,
  doFetch: FetchLike,
  call: { readonly path: string; readonly params: Record<string, string> },
): Promise<SteamCall> {
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: `${interfaceUrl(config)}/${call.path}/`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: encodeParams(config, call.params),
  });
  return unwrap(response.ok, response.status, response.body);
}

function interfaceUrl(config: SteamConfig): string {
  const name =
    config.environment === 'sandbox'
      ? 'ISteamMicroTxnSandbox'
      : 'ISteamMicroTxn';
  return `https://partner.steam-api.com/${name}`;
}

function encodeParams(
  config: SteamConfig,
  params: Record<string, string>,
): string {
  const withAuth = {
    key: config.publisherWebApiKey,
    appid: String(config.appId),
    ...params,
  };
  return Object.entries(withAuth)
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

function unwrap(ok: boolean, status: number, body: unknown): SteamCall {
  if (!ok) {
    throw fault('STEAM.HTTP_FAILED', `Steam returned a ${status} status.`, {
      retryable: status === 429 || status >= 500,
      detail: { status },
    });
  }
  const envelope = (body as { response?: unknown } | null)?.response;
  if (
    envelope === null ||
    envelope === undefined ||
    typeof envelope !== 'object'
  ) {
    throw fault(
      'STEAM.MALFORMED_RESPONSE',
      'The Steam response envelope is missing.',
      {
        retryable: true,
      },
    );
  }
  const record = envelope as {
    result?: unknown;
    params?: unknown;
    error?: unknown;
  };
  if (record.result === 'OK') {
    const params = record.params;
    return {
      result: 'ok',
      params:
        params !== null && typeof params === 'object'
          ? (params as Record<string, unknown>)
          : {},
    };
  }
  const errorcode = (record.error as { errorcode?: unknown } | undefined)
    ?.errorcode;
  return { result: 'failure', errorcode: Number(errorcode ?? -1) };
}
