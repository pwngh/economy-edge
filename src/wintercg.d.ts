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

interface TextEncoder {
  encode(input?: string): Uint8Array;
}
declare const TextEncoder: { new (): TextEncoder };

interface TextDecoder {
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
declare const TextDecoder: { new (label?: string): TextDecoder };

declare function atob(data: string): string;

type KeyUsage = 'sign' | 'verify';
type KeyFormat = 'raw' | 'pkcs8' | 'spki' | 'jwk';

interface CryptoKey {
  readonly type: string;
  readonly extractable: boolean;
  readonly usages: readonly KeyUsage[];
}

type BufferSource = ArrayBufferView | ArrayBuffer;

type AlgorithmParams = string | { name: string; hash?: string; namedCurve?: string };

interface JsonWebKeyLike {
  kty?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  alg?: string;
  kid?: string;
  use?: string;
}

interface SubtleCrypto {
  digest(algorithm: AlgorithmParams, data: BufferSource): Promise<ArrayBuffer>;
  sign(algorithm: AlgorithmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  importKey(
    format: 'jwk',
    keyData: JsonWebKeyLike,
    algorithm: AlgorithmParams,
    extractable: boolean,
    keyUsages: readonly KeyUsage[],
  ): Promise<CryptoKey>;
  verify(
    algorithm: AlgorithmParams,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean>;
  importKey(
    format: KeyFormat,
    keyData: BufferSource,
    algorithm: AlgorithmParams,
    extractable: boolean,
    keyUsages: readonly KeyUsage[],
  ): Promise<CryptoKey>;
}

interface Crypto {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
}

declare const crypto: Crypto;

interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
}
declare const AbortSignal: {
  new (): AbortSignal;
  abort(reason?: unknown): AbortSignal;
  timeout(ms: number): AbortSignal;
};

declare function fetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

interface ReadableStreamDefaultReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock(): void;
}
interface ReadableStream {
  pipeThrough(transform: { readable: ReadableStream; writable: unknown }): ReadableStream;
  getReader(): ReadableStreamDefaultReader;
}
declare const ReadableStream: {
  new (source: {
    start(controller: { enqueue(chunk: Uint8Array): void; close(): void }): void;
  }): ReadableStream;
};

interface DecompressionStream {
  readonly readable: ReadableStream;
  readonly writable: unknown;
}
declare const DecompressionStream: { new (format: string): DecompressionStream };
