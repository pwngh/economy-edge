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

/**
 * Money at the edge, implemented on the vendored @pwngh/money amalgamation
 * (money.vendored.ts). This file owns the edge's boundary discipline — structured
 * faults, the currency grammar, the decimal wire — and delegates the semantics:
 * the exponent table, i64 range checks, strict parsing, and locale-free formatting
 * all come from the vendored copy, which is pinned against drift by its embedded
 * selfTest in test/canonical/vendored.test.ts.
 */

import { fault } from './fault.ts';
import {
  add as addMinor,
  amount,
  exponent,
  format,
  parse,
  sub as subMinor,
} from './money.vendored.ts';

export { mulDiv } from './money.vendored.ts';
export type { Rounding } from './money.vendored.ts';

export interface Money {
  readonly minor: bigint;
  readonly currency: string;
  readonly __brand: 'Amount';
}

export function money(currency: string, minor: bigint): Money {
  requireCurrency(currency);
  return {
    minor: inRange(() => amount(currency, minor).minor, currency),
    currency,
    __brand: 'Amount',
  };
}

export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __brand?: unknown }).__brand === 'Amount' &&
    typeof (value as { minor?: unknown }).minor === 'bigint'
  );
}

export function add(left: Money, right: Money): Money {
  requireSameCurrency(left, right, 'add');
  return {
    minor: inRange(() => addMinor(left, right).minor, left.currency),
    currency: left.currency,
    __brand: 'Amount',
  };
}

export function subtract(left: Money, right: Money): Money {
  requireSameCurrency(left, right, 'subtract');
  return {
    minor: inRange(() => subMinor(left, right).minor, left.currency),
    currency: left.currency,
    __brand: 'Amount',
  };
}

export function currencyExponent(currency: string): number {
  requireCurrency(currency);
  return exponent(currency);
}

export function moneyFromDecimal(decimal: string, currency: string): Money {
  const exp = currencyExponent(currency);
  const minor = parse(decimal, exp);
  if (minor === null) {
    throw fault(
      'MONEY.INVALID_AMOUNT',
      `The decimal '${decimal}' does not fit ${currency}, which has ${exp} minor digits.`,
      { detail: { decimal, currency, exponent: exp } },
    );
  }
  return { minor, currency, __brand: 'Amount' };
}

export function encodeMoney(a: Money): string {
  return `${a.currency}:${format(a.minor, currencyExponent(a.currency), { group: '' })}`;
}

export function decodeMoney(text: string): Money {
  const separator = text.indexOf(':');
  if (separator <= 0) {
    throw fault(
      'MONEY.INVALID_AMOUNT',
      `The encoded amount '${text}' must look like 'USD:12.34'.`,
      { detail: { text } },
    );
  }
  return moneyFromDecimal(text.slice(separator + 1), text.slice(0, separator));
}

function inRange(run: () => bigint, currency: string): bigint {
  try {
    return run();
  } catch {
    throw fault(
      'MONEY.OVERFLOW',
      `The ${currency} amount does not fit a signed 64-bit minor-unit count.`,
      { detail: { currency } },
    );
  }
}

function requireCurrency(currency: string): void {
  if (!/^[A-Z]{3,10}$/.test(currency)) {
    throw fault(
      'MONEY.INVALID_CURRENCY',
      `The currency '${currency}' must be an uppercase code.`,
      {
        detail: { currency },
      },
    );
  }
}

function requireSameCurrency(
  left: Money,
  right: Money,
  operation: string,
): void {
  if (left.currency !== right.currency) {
    throw fault(
      'MONEY.CROSS_CURRENCY',
      `Cannot ${operation} ${left.currency} and ${right.currency}.`,
      { detail: { left: left.currency, right: right.currency } },
    );
  }
}
