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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { hasCode } from '#src/canonical/fault.ts';
import {
  add,
  currencyExponent,
  decodeMoney,
  encodeMoney,
  money,
  moneyFromDecimal,
  subtract,
} from '#src/canonical/money.ts';

describe('Money', () => {
  test('round-trips a decimal through decode and encode unchanged', () => {
    const cases = ['0.00', '12.34', '0.05', '1000000.99'];

    for (const decimal of cases) {
      assert.equal(
        encodeMoney(moneyFromDecimal(decimal, 'USD')),
        `USD:${decimal}`,
      );
    }
  });

  test('decodes minor units exactly as a bigint', () => {
    assert.deepEqual(moneyFromDecimal('12.34', 'USD'), money('USD', 1234n));
  });

  test('decodes a bare integer as whole units with zero cents', () => {
    assert.deepEqual(moneyFromDecimal('7', 'USD'), money('USD', 700n));
  });

  test('decodes a single decimal place as tens of cents', () => {
    assert.deepEqual(moneyFromDecimal('4.5', 'USD'), money('USD', 450n));
  });

  test('round-trips a negative amount', () => {
    assert.equal(encodeMoney(moneyFromDecimal('-0.01', 'USD')), 'USD:-0.01');
  });

  test('decodes the encoded form back to the same value', () => {
    assert.deepEqual(decodeMoney('USD:12.34'), money('USD', 1234n));
  });

  test('rejects a decimal with excess precision as a fault', () => {
    assert.throws(
      () => moneyFromDecimal('1.234', 'USD'),
      (error: unknown) => hasCode(error, 'MONEY.INVALID_AMOUNT'),
    );
  });

  test('rejects an encoded amount without a currency prefix', () => {
    assert.throws(
      () => decodeMoney('12.34'),
      (error: unknown) => hasCode(error, 'MONEY.INVALID_AMOUNT'),
    );
  });

  test('rejects a lowercase currency code', () => {
    assert.throws(
      () => money('usd', 1n),
      (error: unknown) => hasCode(error, 'MONEY.INVALID_CURRENCY'),
    );
  });

  test('adds two same-currency amounts in minor units', () => {
    assert.deepEqual(
      add(money('USD', 150n), money('USD', 225n)),
      money('USD', 375n),
    );
  });

  test('subtracts in minor units', () => {
    assert.deepEqual(
      subtract(money('USD', 500n), money('USD', 49n)),
      money('USD', 451n),
    );
  });

  test('gives zero-exponent currencies no invented decimals', () => {
    assert.deepEqual(moneyFromDecimal('1234', 'JPY'), money('JPY', 1234n));
    assert.equal(encodeMoney(money('JPY', 1234n)), 'JPY:1234');
    assert.equal(encodeMoney(money('JPY', -50n)), 'JPY:-50');
    assert.throws(
      () => moneyFromDecimal('10.5', 'JPY'),
      (error: unknown) => hasCode(error, 'MONEY.INVALID_AMOUNT'),
    );
  });

  test('gives three-exponent currencies their thousandths', () => {
    assert.deepEqual(moneyFromDecimal('1.234', 'BHD'), money('BHD', 1234n));
    assert.equal(encodeMoney(money('BHD', 1234n)), 'BHD:1.234');
    assert.equal(encodeMoney(money('KWD', 5n)), 'KWD:0.005');
  });

  test('defaults unknown currency codes to two minor digits', () => {
    assert.equal(currencyExponent('CREDIT'), 2);
    assert.deepEqual(
      moneyFromDecimal('12.34', 'CREDIT'),
      money('CREDIT', 1234n),
    );
  });

  test('names each currency exponent', () => {
    assert.equal(currencyExponent('USD'), 2);
    assert.equal(currencyExponent('JPY'), 0);
    assert.equal(currencyExponent('KWD'), 3);
    assert.equal(currencyExponent('CLF'), 4);
  });

  test('refuses cross-currency arithmetic as a fault', () => {
    assert.throws(
      () => add(money('USD', 1n), money('CREDIT', 1n)),
      (error: unknown) => hasCode(error, 'MONEY.CROSS_CURRENCY'),
    );
  });

  test('holds every amount inside a signed 64-bit minor-unit count', () => {
    assert.equal(
      moneyFromDecimal('92233720368547758.07', 'USD').minor,
      9223372036854775807n,
    );
    assert.throws(
      () => money('USD', 9223372036854775808n),
      (error: unknown) => hasCode(error, 'MONEY.OVERFLOW'),
    );
    assert.throws(
      () => add(money('USD', 9223372036854775807n), money('USD', 1n)),
      (error: unknown) => hasCode(error, 'MONEY.OVERFLOW'),
    );
    assert.throws(
      () => moneyFromDecimal('92233720368547758.08', 'USD'),
      (error: unknown) => hasCode(error, 'MONEY.INVALID_AMOUNT'),
    );
  });
});
