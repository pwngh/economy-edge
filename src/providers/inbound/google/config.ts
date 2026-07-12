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

import type { SkuCatalogEntry } from '../../catalog.ts';
import type { FetchLike } from '../../fetch.ts';

export interface GoogleConfig {
  readonly packageName: string;
  readonly serviceAccountEmail: string;
  readonly serviceAccountPrivateKey: string;
  readonly resolveSku: (sku: string) => SkuCatalogEntry;
  readonly notificationAudience?: string;
  readonly financialReportsBucket?: string;
  readonly requestTimeoutMs?: number;
  readonly fetch?: FetchLike;
}
