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

import type { ProductType } from '../../../canonical/index.ts';
import type { FetchLike } from '../../fetch.ts';

export interface SteamConfig {
  readonly publisherWebApiKey: string;
  readonly appId: number;
  readonly environment: 'production' | 'sandbox';
  readonly productTypeOf?: (itemId: string) => ProductType;
  readonly requestTimeoutMs?: number;
  readonly fetch?: FetchLike;
}
