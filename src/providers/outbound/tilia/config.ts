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

import type { SignatureScheme } from '../../../codec/signature.ts';
import type { FetchLike } from '../../fetch.ts';

export interface TiliaPayee {
  readonly accountId: string;
  readonly sourcePaymentMethodId: string;
  readonly destinationPaymentMethodId: string;
}

export interface TiliaConfig {
  readonly environment: 'staging' | 'production';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly integratorAccountId: string;
  readonly resolvePayee: (userId: string) => Promise<TiliaPayee>;
  readonly webhookVerification: SignatureScheme;
  readonly requestTimeoutMs?: number;
  readonly fetch?: FetchLike;
}
