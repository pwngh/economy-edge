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

export const PROVIDER_IDS = [
  'steam',
  'meta',
  'google',
  'apple',
  'pico',
  'tilia',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface PayoutRef {
  readonly provider: ProviderId;
  readonly id: string;
}

export function isProviderId(value: unknown): value is ProviderId {
  return (PROVIDER_IDS as readonly unknown[]).includes(value);
}
