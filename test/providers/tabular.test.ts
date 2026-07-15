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

import { columnIndex, parseDelimited } from '#src/providers/tabular.ts';
import { array, check, choice, map } from '#test/support/propcheck.ts';

describe('parseDelimited', () => {
  test('handles the quote-placement edge cases one rule at a time', () => {
    const cases: Array<{ text: string; rows: string[][] }> = [
      { text: 'a"b,c', rows: [['a"b', 'c']] },
      { text: '"abc', rows: [['abc']] },
      { text: '"a""b"', rows: [['a"b']] },
      { text: '"a,b",c', rows: [['a,b', 'c']] },
      { text: '"a\r\nb",c', rows: [['a\r\nb', 'c']] },
      { text: '"a"x,c', rows: [['ax', 'c']] },
      { text: '"a\r"\n', rows: [['a\r']] },
    ];

    for (const { text, rows } of cases) {
      assert.deepEqual(parseDelimited(text, ','), rows, JSON.stringify(text));
    }
  });

  test('splits CRLF rows without leaking the carriage return into fields', () => {
    assert.deepEqual(parseDelimited('a,b\r\nc,d\r\n', ','), [
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('keeps trailing empty fields and drops all-empty rows', () => {
    assert.deepEqual(parseDelimited('a,\n\n\nb,c', ','), [
      ['a', ''],
      ['b', 'c'],
    ]);
  });

  test('round-trips every table through RFC 4180 encoding, shrinking failures to a minimum', () => {
    const field = map(
      array(choice('a', 'B', '7', ' ', '"', ',', '\t', '\r', '\n', 'é'), 5),
      (characters) => characters.join(''),
      (value) => value.split(''),
    );
    const table = array(array(field, 3), 4);

    for (const [delimiter, newline, seed] of [
      [',', '\n', 20260709],
      [',', '\r\n', 20260710],
      ['\t', '\n', 20260711],
      ['\t', '\r\n', 20260712],
    ] as const) {
      const report = check(
        table,
        (rows) => {
          const text = rows
            .map((columns) =>
              columns
                .map((value) => encodeField(value, delimiter))
                .join(delimiter),
            )
            .join(newline);
          const expected = rows.filter((columns) =>
            columns.some((value) => value.length > 0),
          );

          const parsed = parseDelimited(text, delimiter);

          return JSON.stringify(parsed) === JSON.stringify(expected);
        },
        { seed, runs: 300 },
      );

      assert.ok(report.ok, JSON.stringify({ delimiter, newline, report }));
    }
  });
});

describe('columnIndex', () => {
  test('matches a header case-insensitively and ignoring padding', () => {
    assert.equal(columnIndex(['  SKU ', 'Units'], 'sku'), 0);
    assert.equal(columnIndex(['SKU', 'Units'], 'Missing'), null);
  });
});

function encodeField(field: string, delimiter: string): string {
  if (
    field.includes('"') ||
    field.includes(delimiter) ||
    field.includes('\r') ||
    field.includes('\n')
  ) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}
