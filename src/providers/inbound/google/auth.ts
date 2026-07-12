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
import { signJwt } from '../../../codec/jwt.ts';
import { requestJson } from '../../transport.ts';

import type { FetchLike } from '../../fetch.ts';
import type { GoogleConfig } from './config.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export async function accessToken(
  config: GoogleConfig,
  doFetch: FetchLike,
  scope: string = SCOPE,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    algorithm: 'RS256',
    header: { alg: 'RS256', typ: 'JWT' },
    payload: {
      iss: config.serviceAccountEmail,
      scope,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    privateKeyPem: config.serviceAccountPrivateKey,
  });
  const response = await requestJson(doFetch, {
    method: 'POST',
    url: TOKEN_URL,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
  });
  if (!response.ok) {
    throw fault(
      'GOOGLE.AUTH_FAILED',
      `The Google token request returned a ${response.status} status.`,
      {
        retryable: response.status === 429 || response.status >= 500,
        detail: { status: response.status },
      },
    );
  }
  const token = (response.body as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    throw fault('GOOGLE.AUTH_FAILED', 'The Google token response is missing an access_token.', {
      retryable: true,
    });
  }
  return token;
}

export function purchaseUrl(
  config: GoogleConfig,
  call: { productId: string; token: string },
): string {
  const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
  return `${base}/${encodeURIComponent(config.packageName)}/purchases/products/${encodeURIComponent(
    call.productId,
  )}/tokens/${encodeURIComponent(call.token)}`;
}
