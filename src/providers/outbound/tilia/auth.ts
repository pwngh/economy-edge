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
import type { TiliaConfig } from './config.ts';

interface TiliaHosts {
  readonly auth: string;
  readonly invoicing: string;
  readonly pii: string;
  readonly wallets: string;
}

export function tiliaHosts(environment: TiliaConfig['environment']): TiliaHosts {
  const domain = environment === 'production' ? 'tilia-inc.com' : 'staging.tilia-inc.com';
  return {
    auth: `https://auth.${domain}`,
    invoicing: `https://invoicing.${domain}`,
    pii: `https://pii.${domain}`,
    wallets: `https://wallets.${domain}`,
  };
}

export async function bearerToken(config: TiliaConfig, doFetch: FetchLike): Promise<string> {
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: `${tiliaHosts(config.environment).auth}/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) {
    throw fault(
      'TILIA.AUTH_FAILED',
      `The Tilia token request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const token = fieldOf(response.body, 'access_token');
  if (token === null) {
    throw fault('TILIA.AUTH_FAILED', 'The Tilia token response is missing an access_token.', {
      retryable: true,
    });
  }
  return token;
}

export function payloadOf(body: unknown): unknown {
  if (body === null || typeof body !== 'object') {
    return null;
  }
  return (body as { payload?: unknown }).payload ?? null;
}

export function fieldOf(value: unknown, name: string): string | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const field = (value as Record<string, unknown>)[name];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}
