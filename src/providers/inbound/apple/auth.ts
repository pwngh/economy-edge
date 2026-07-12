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

import type { AppleConfig } from './config.ts';

export function appleHost(environment: AppleConfig['environment']): string {
  return environment === 'production'
    ? 'https://api.storekit.apple.com'
    : 'https://api.storekit-sandbox.apple.com';
}

export function reportsJwt(config: AppleConfig): Promise<string> {
  const reports = config.reports;
  if (reports === undefined) {
    throw fault(
      'APPLE.REPORTS_UNCONFIGURED',
      'Set the reports team-key credentials to pull sales reports.',
    );
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  return signJwt({
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: reports.keyId, typ: 'JWT' },
    payload: {
      iss: reports.issuerId,
      iat: issuedAt,
      exp: issuedAt + 900,
      aud: 'appstoreconnect-v1',
    },
    privateKeyPem: reports.privateKey,
  });
}

export function appleJwt(config: AppleConfig): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signJwt({
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: config.keyId, typ: 'JWT' },
    payload: {
      iss: config.issuerId,
      iat: issuedAt,
      exp: issuedAt + 3000,
      aud: 'appstoreconnect-v1',
      bid: config.bundleId,
    },
    privateKeyPem: config.privateKey,
  });
}
