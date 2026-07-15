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
import { zipEntries } from '#src/providers/zip.ts';
import { buildZip } from '#test/support/zip.ts';

const EOCD_SIGNATURE = 'PK';

function endRecordOffset(zip: Uint8Array): number {
  return zip.length - 22;
}

function centralDirectoryOffset(zip: Uint8Array): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  return view.getUint32(endRecordOffset(zip) + 16, true);
}

describe('zipEntries', () => {
  test('reads stored names and inflated contents back out of an archive', async () => {
    const zip = buildZip([
      { name: 'a.csv', content: 'x,y\n1,2\n' },
      { name: 'b.csv', content: 'p,q\n3,4\n' },
    ]);

    const entries = await zipEntries(zip);

    assert.deepEqual(
      entries.map((entry) => ({
        name: entry.name,
        text: new TextDecoder().decode(entry.bytes),
      })),
      [
        { name: 'a.csv', text: 'x,y\n1,2\n' },
        { name: 'b.csv', text: 'p,q\n3,4\n' },
      ],
    );
  });

  test('finds the true end record when the archive comment contains its signature', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x,y\n1,2\n' }], {
      comment: `${EOCD_SIGNATURE}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
    });

    const entries = await zipEntries(zip);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.name, 'a.csv');
  });

  test('refuses an empty or truncated archive with a malformed fault, never a range error', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x,y\n1,2\n' }]);

    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array(10),
      zip.slice(0, zip.length - 4),
    ]) {
      await assert.rejects(zipEntries(bytes), (error: unknown) =>
        hasCode(error, 'ARCHIVE.MALFORMED'),
      );
    }
  });

  test('refuses a central directory that overruns the archive with a malformed fault', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x,y\n1,2\n' }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint32(endRecordOffset(zip) + 16, zip.length - 8, true);

    await assert.rejects(zipEntries(zip), (error: unknown) =>
      hasCode(error, 'ARCHIVE.MALFORMED'),
    );
  });

  test('refuses zip64 markers with an unsupported fault instead of misreading them', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x,y\n1,2\n' }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint16(endRecordOffset(zip) + 10, 0xffff, true);

    await assert.rejects(zipEntries(zip), (error: unknown) =>
      hasCode(error, 'ARCHIVE.UNSUPPORTED'),
    );
  });

  test('refuses an entry whose declared size exceeds the cap before inflating it', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x'.repeat(100) }]);

    await assert.rejects(
      zipEntries(zip, { maxEntryBytes: 8 }),
      (error: unknown) => hasCode(error, 'ARCHIVE.ENTRY_TOO_LARGE'),
    );
  });

  test('stops inflating at the cap when the declared size lies about a zip bomb', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x'.repeat(100_000) }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint32(centralDirectoryOffset(zip) + 24, 4, true);

    await assert.rejects(
      zipEntries(zip, { maxEntryBytes: 64 }),
      (error: unknown) => hasCode(error, 'COMPRESSION.OUTPUT_TOO_LARGE'),
    );
  });

  test('wraps a corrupt deflate stream as a compression fault, never a bare throw', async () => {
    const zip = buildZip([{ name: 'a.csv', content: 'x,y\n1,2\n' }]);
    const nameLength = 'a.csv'.length;
    zip.fill(0xff, 30 + nameLength, 30 + nameLength + 4);

    await assert.rejects(zipEntries(zip), (error: unknown) =>
      hasCode(error, 'COMPRESSION.MALFORMED'),
    );
  });
});
