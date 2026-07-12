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

import type { PurchaseStatus } from '../../../canonical/index.ts';

export async function purchaseStatus(): Promise<PurchaseStatus> {
  return { state: 'UNKNOWN' };
}
