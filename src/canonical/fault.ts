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

export interface Fault extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly detail: Readonly<Record<string, unknown>>;
}

export function fault(
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    detail?: Record<string, unknown>;
    cause?: unknown;
  } = {},
): Fault {
  const error =
    options.cause === undefined ? new Error(message) : new Error(message, { cause: options.cause });
  return Object.assign(error, {
    code,
    retryable: options.retryable ?? false,
    detail: options.detail ?? {},
  });
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === code;
}
