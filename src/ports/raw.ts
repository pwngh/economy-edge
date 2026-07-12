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

import type { ProviderId } from '../canonical/index.ts';

export interface RawProof {
  readonly provider: ProviderId;
  readonly proof: unknown;
}

export interface RawWebhook {
  readonly provider: ProviderId;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}
