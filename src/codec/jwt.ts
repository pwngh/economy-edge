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

import { fault, hasCode } from '../canonical/fault.ts';

export async function signJwt(input: {
  readonly algorithm: 'RS256' | 'ES256';
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly privateKeyPem: string;
}): Promise<string> {
  const key = await importPrivateKey(input.algorithm, input.privateKeyPem);
  const signingInput = `${base64UrlOfString(JSON.stringify(input.header))}.${base64UrlOfString(
    JSON.stringify(input.payload),
  )}`;
  const signature = await crypto.subtle.sign(
    signParams(input.algorithm),
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlOfBytes(new Uint8Array(signature))}`;
}

export function decodeJwsPayload(jws: unknown): unknown | null {
  if (typeof jws !== 'string') {
    return null;
  }
  const segments = jws.split('.');
  if (segments.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(stringOfBase64Url(segments[1]!));
  } catch {
    return null;
  }
}

export function stringOfBase64(base64: string): string {
  return new TextDecoder().decode(bytesOfBase64(base64));
}

export function decodeJwsHeader(jws: unknown): unknown | null {
  if (typeof jws !== 'string') {
    return null;
  }
  const segments = jws.split('.');
  if (segments.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(stringOfBase64Url(segments[0]!));
  } catch {
    return null;
  }
}

export function bytesOfBase64Url(segment: string): Uint8Array | null {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
  return decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

export function decodeBase64(base64: string): Uint8Array | null {
  try {
    return bytesOfBase64(base64);
  } catch {
    return null;
  }
}

async function importPrivateKey(algorithm: 'RS256' | 'ES256', pem: string): Promise<CryptoKey> {
  const params =
    algorithm === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };
  try {
    return await crypto.subtle.importKey('pkcs8', pemBytes(pem), params, false, ['sign']);
  } catch (error) {
    if (hasCode(error, 'JWT.MALFORMED_KEY')) {
      throw error;
    }
    throw fault('JWT.MALFORMED_KEY', 'The private key did not import for signing.', {
      cause: error,
    });
  }
}

function signParams(algorithm: 'RS256' | 'ES256'): string | { name: string; hash: string } {
  return algorithm === 'RS256' ? 'RSASSA-PKCS1-v1_5' : { name: 'ECDSA', hash: 'SHA-256' };
}

function pemBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (base64.length === 0) {
    throw fault('JWT.MALFORMED_KEY', 'The private key PEM has no base64 body.');
  }
  try {
    return bytesOfBase64(base64);
  } catch (error) {
    throw fault('JWT.MALFORMED_KEY', 'The private key PEM body is not valid base64.', {
      cause: error,
    });
  }
}

const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesOfBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function base64UrlOfBytes(bytes: Uint8Array): string {
  let encoded = '';
  const full = bytes.length - (bytes.length % 3);
  for (let index = 0; index < full; index += 3) {
    const chunk = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    encoded +=
      BASE64_URL_ALPHABET[chunk >>> 18]! +
      BASE64_URL_ALPHABET[(chunk >>> 12) & 63]! +
      BASE64_URL_ALPHABET[(chunk >>> 6) & 63]! +
      BASE64_URL_ALPHABET[chunk & 63]!;
  }
  if (bytes.length - full === 1) {
    const chunk = bytes[full]! << 16;
    encoded += BASE64_URL_ALPHABET[chunk >>> 18]! + BASE64_URL_ALPHABET[(chunk >>> 12) & 63]!;
  }
  if (bytes.length - full === 2) {
    const chunk = (bytes[full]! << 16) | (bytes[full + 1]! << 8);
    encoded +=
      BASE64_URL_ALPHABET[chunk >>> 18]! +
      BASE64_URL_ALPHABET[(chunk >>> 12) & 63]! +
      BASE64_URL_ALPHABET[(chunk >>> 6) & 63]!;
  }
  return encoded;
}

function base64UrlOfString(text: string): string {
  return base64UrlOfBytes(new TextEncoder().encode(text));
}

function stringOfBase64Url(segment: string): string {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
  return stringOfBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}
