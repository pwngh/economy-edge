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

export const MAX_DECOMPRESSED_BYTES = 268_435_456;

export async function decompressBytes(
  bytes: Uint8Array,
  format: 'gzip' | 'deflate-raw',
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
): Promise<Uint8Array> {
  const decompressed = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new DecompressionStream(format));
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await readChunk(reader, format);
    if (done) {
      break;
    }
    if (value !== undefined) {
      chunks.push(value);
      total += value.length;
      if (total > maxBytes) {
        throw fault(
          'COMPRESSION.OUTPUT_TOO_LARGE',
          `The decompressed output exceeds the ${maxBytes}-byte cap.`,
          { detail: { format, maxBytes } },
        );
      }
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

async function readChunk(
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
  format: string,
): Promise<{ done: boolean; value?: Uint8Array }> {
  try {
    return await reader.read();
  } catch (error) {
    throw fault(
      'COMPRESSION.MALFORMED',
      'The compressed stream did not decode.',
      {
        cause: error,
        detail: { format },
      },
    );
  }
}
