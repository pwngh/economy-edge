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

export type Outcome<T, E = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function reject<E>(reason: E): {
  readonly ok: false;
  readonly reason: E;
} {
  return { ok: false, reason };
}
