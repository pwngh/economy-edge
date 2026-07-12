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

import type { FetchLike } from '../../fetch.ts';

export interface AppleReportsConfig {
  readonly issuerId: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly vendorNumber: string;
}

export interface AppleConfig {
  readonly environment: 'production' | 'sandbox';
  readonly bundleId: string;
  readonly issuerId: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly reports?: AppleReportsConfig;
  readonly appleRootCertificates?: readonly string[];
  readonly requestTimeoutMs?: number;
  readonly fetch?: FetchLike;
}
