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

const QUOTE = 34;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;

export function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const delimiterCode = delimiter.charCodeAt(0);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let segmentStart = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === QUOTE && field.length === 0 && segmentStart === index) {
      const quoted = scanQuoted(text, index + 1);
      field = quoted.value;
      index = quoted.next;
      segmentStart = index;
      continue;
    }
    if (code === delimiterCode) {
      row.push(field + text.slice(segmentStart, index));
      field = '';
      segmentStart = index + 1;
    } else if (code === NEWLINE) {
      row.push(field + text.slice(segmentStart, index));
      rows.push(row);
      row = [];
      field = '';
      segmentStart = index + 1;
    } else if (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === NEWLINE) {
      field += text.slice(segmentStart, index);
      segmentStart = index + 1;
    }
    index += 1;
  }
  if (field.length > 0 || segmentStart < text.length || row.length > 0) {
    row.push(field + text.slice(segmentStart));
    rows.push(row);
  }
  return rows.filter((columns) => columns.some((value) => value.length > 0));
}

function scanQuoted(text: string, start: number): { value: string; next: number } {
  let value = '';
  let cursor = start;
  for (;;) {
    const quote = text.indexOf('"', cursor);
    if (quote < 0) {
      return { value: value + text.slice(cursor), next: text.length };
    }
    value += text.slice(cursor, quote);
    if (text.charCodeAt(quote + 1) === QUOTE) {
      value += '"';
      cursor = quote + 2;
    } else {
      return { value, next: quote + 1 };
    }
  }
}

export function columnIndex(header: readonly string[], name: string): number | null {
  const index = header.findIndex((column) => column.trim().toLowerCase() === name.toLowerCase());
  return index === -1 ? null : index;
}
