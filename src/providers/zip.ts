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

import { fault } from '../canonical/fault.ts';
import { decompressBytes, MAX_DECOMPRESSED_BYTES } from './compression.ts';

import type { Fault } from '../canonical/fault.ts';

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const ZIP64_COUNT_MARKER = 0xffff;
const ZIP64_SIZE_MARKER = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;

export async function zipEntries(
  bytes: Uint8Array,
  limits: { readonly maxEntryBytes?: number } = {},
): Promise<ZipEntry[]> {
  const maxEntryBytes = limits.maxEntryBytes ?? MAX_DECOMPRESSED_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endRecord = findEndRecord(view);
  const count = readUint16(view, endRecord + 10);
  const firstEntry = readUint32(view, endRecord + 16);
  if (count === ZIP64_COUNT_MARKER || firstEntry === ZIP64_SIZE_MARKER) {
    throw unsupportedZip64();
  }
  const entries: ZipEntry[] = [];
  let offset = firstEntry;
  for (let index = 0; index < count; index += 1) {
    const entry = directoryEntry(view, offset);
    entries.push({
      name: new TextDecoder().decode(
        bytes.slice(offset + 46, offset + 46 + entry.nameLength),
      ),
      bytes: await entryBytes(bytes, view, entry, maxEntryBytes),
    });
    offset += 46 + entry.nameLength + entry.extraLength + entry.commentLength;
  }
  return entries;
}

interface DirectoryEntry {
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly nameLength: number;
  readonly extraLength: number;
  readonly commentLength: number;
  readonly localOffset: number;
}

function directoryEntry(view: DataView, offset: number): DirectoryEntry {
  if (readUint32(view, offset) !== CENTRAL_DIRECTORY_ENTRY) {
    throw malformed('a central directory entry is missing');
  }
  const entry = {
    method: readUint16(view, offset + 10),
    compressedSize: readUint32(view, offset + 20),
    uncompressedSize: readUint32(view, offset + 24),
    nameLength: readUint16(view, offset + 28),
    extraLength: readUint16(view, offset + 30),
    commentLength: readUint16(view, offset + 32),
    localOffset: readUint32(view, offset + 42),
  };
  if (
    entry.compressedSize === ZIP64_SIZE_MARKER ||
    entry.uncompressedSize === ZIP64_SIZE_MARKER ||
    entry.localOffset === ZIP64_SIZE_MARKER
  ) {
    throw unsupportedZip64();
  }
  return entry;
}

async function entryBytes(
  bytes: Uint8Array,
  view: DataView,
  entry: DirectoryEntry,
  maxEntryBytes: number,
): Promise<Uint8Array> {
  if (entry.uncompressedSize > maxEntryBytes) {
    throw fault(
      'ARCHIVE.ENTRY_TOO_LARGE',
      `A ZIP entry declares ${entry.uncompressedSize} bytes, over the ${maxEntryBytes}-byte cap.`,
      { detail: { declaredBytes: entry.uncompressedSize, maxEntryBytes } },
    );
  }
  if (readUint32(view, entry.localOffset) !== LOCAL_FILE_HEADER) {
    throw malformed('a local file header is missing');
  }
  const nameLength = readUint16(view, entry.localOffset + 26);
  const extraLength = readUint16(view, entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  if (dataStart + entry.compressedSize > bytes.length) {
    throw malformed('an entry overruns the archive');
  }
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === STORED) {
    return compressed;
  }
  if (entry.method === DEFLATED) {
    return decompressBytes(compressed, 'deflate-raw', maxEntryBytes);
  }
  throw malformed(`compression method ${entry.method} is unsupported`);
}

function findEndRecord(view: DataView): number {
  for (
    let offset = view.byteLength - END_RECORD_SIZE;
    offset >= 0;
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY &&
      reachesEnd(view, offset)
    ) {
      return offset;
    }
  }
  throw malformed('the end-of-central-directory record is missing');
}

function reachesEnd(view: DataView, endRecord: number): boolean {
  const commentLength = view.getUint16(endRecord + 20, true);
  return endRecord + END_RECORD_SIZE + commentLength === view.byteLength;
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw malformed('a structure overruns the archive');
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw malformed('a structure overruns the archive');
  }
  return view.getUint32(offset, true);
}

function unsupportedZip64(): Fault {
  return fault(
    'ARCHIVE.UNSUPPORTED',
    'The ZIP archive uses zip64, which is unsupported.',
  );
}

function malformed(reason: string): Fault {
  return fault(
    'ARCHIVE.MALFORMED',
    `The ZIP archive is malformed: ${reason}.`,
    {
      detail: { reason },
    },
  );
}
