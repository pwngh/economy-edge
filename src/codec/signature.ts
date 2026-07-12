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

import { bytesOfBase64Url, decodeBase64, decodeJwsHeader, decodeJwsPayload } from './jwt.ts';
import { ecdsaDerToRaw, parseCertificate } from './x509.ts';

import type { ParsedCertificate } from './x509.ts';
import type { RawWebhook } from '../ports/raw.ts';

export interface OidcJwk {
  readonly kty: string;
  readonly kid?: string;
  readonly n?: string;
  readonly e?: string;
  readonly alg?: string;
}

export type SignatureScheme =
  | {
      readonly scheme: 'hmac-sha256';
      readonly secret: string;
      readonly header: string;
    }
  | { readonly scheme: 'transport' }
  | {
      readonly scheme: 'oidc-jwt';
      readonly issuer: string;
      readonly audience: string;
      readonly keys: readonly OidcJwk[];
    }
  | {
      readonly scheme: 'jws-x5c';
      readonly rootCertificates: readonly string[];
    };

export async function verifySignature(
  scheme: SignatureScheme,
  webhook: RawWebhook,
): Promise<boolean> {
  if (scheme.scheme === 'transport') {
    return true;
  }
  if (scheme.scheme === 'hmac-sha256') {
    return verifyHmac(scheme, webhook);
  }
  if (scheme.scheme === 'oidc-jwt') {
    return verifyOidcJwt(scheme, webhook);
  }
  return verifyJwsX5c(scheme, webhook);
}

async function verifyHmac(
  scheme: { secret: string; header: string },
  webhook: RawWebhook,
): Promise<boolean> {
  const signature = headerValue(webhook.headers, scheme.header);
  const signatureBytes = signature === null ? null : hexToBytes(signature);
  if (signatureBytes === null) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(scheme.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(webhook.body));
}

const CLOCK_SKEW_MS = 300_000;

async function verifyOidcJwt(
  scheme: { issuer: string; audience: string; keys: readonly OidcJwk[] },
  webhook: RawWebhook,
): Promise<boolean> {
  const authorization = headerValue(webhook.headers, 'authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    return false;
  }
  const jwt = authorization.slice('Bearer '.length);
  const segments = jwt.split('.');
  const header = decodeJwsHeader(jwt) as { alg?: unknown; kid?: unknown } | null;
  if (segments.length !== 3 || header === null || header.alg !== 'RS256') {
    return false;
  }
  const signature = bytesOfBase64Url(segments[2]!);
  if (signature === null) {
    return false;
  }
  const candidates = scheme.keys.filter(
    (key) => key.kty === 'RSA' && (header.kid === undefined || key.kid === header.kid),
  );
  const data = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  if (!(await anyKeySigns(candidates, signature, data))) {
    return false;
  }
  const payload = decodeJwsPayload(jwt) as {
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
    nbf?: unknown;
    iat?: unknown;
  } | null;
  return (
    payload !== null &&
    payload.iss === scheme.issuer &&
    payload.aud === scheme.audience &&
    withinTokenLifetime(payload, Date.now())
  );
}

function withinTokenLifetime(
  claims: { exp?: unknown; nbf?: unknown; iat?: unknown },
  at: number,
): boolean {
  if (typeof claims.exp !== 'number' || claims.exp * 1000 + CLOCK_SKEW_MS <= at) {
    return false;
  }
  for (const notBeforeLike of [claims.nbf, claims.iat]) {
    if (notBeforeLike === undefined) {
      continue;
    }
    if (typeof notBeforeLike !== 'number' || notBeforeLike * 1000 - CLOCK_SKEW_MS > at) {
      return false;
    }
  }
  return true;
}

async function anyKeySigns(
  candidates: readonly OidcJwk[],
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

const MAX_CHAIN_CERTIFICATES = 6;
const MAX_CERTIFICATE_BASE64_LENGTH = 16_384;

async function verifyJwsX5c(
  scheme: { rootCertificates: readonly string[] },
  webhook: RawWebhook,
): Promise<boolean> {
  const jws = embeddedJws(webhook.body);
  if (jws === null) {
    return false;
  }
  const header = decodeJwsHeader(jws) as { alg?: unknown; x5c?: unknown } | null;
  const hash = header?.alg === 'ES256' ? 'SHA-256' : header?.alg === 'ES384' ? 'SHA-384' : null;
  if (hash === null || !Array.isArray(header?.x5c) || header.x5c.length === 0) {
    return false;
  }
  const chain = chainOf(header.x5c);
  if (chain === null || !everyCertificateWithinValidity(chain, Date.now())) {
    return false;
  }
  if (!(await leafSignsJws(chain[0]!, jws, hash))) {
    return false;
  }
  for (let index = 0; index + 1 < chain.length; index += 1) {
    if (!(await certificateSignedBy(chain[index]!, chain[index + 1]!))) {
      return false;
    }
  }
  return pinnedRootMatches(scheme.rootCertificates, chain[chain.length - 1]!);
}

function chainOf(x5c: unknown[]): ParsedCertificate[] | null {
  if (x5c.length > MAX_CHAIN_CERTIFICATES) {
    return null;
  }
  const chain: ParsedCertificate[] = [];
  for (const entry of x5c) {
    if (typeof entry !== 'string' || entry.length > MAX_CERTIFICATE_BASE64_LENGTH) {
      return null;
    }
    const der = decodeBase64(entry);
    const certificate = der === null ? null : parseCertificate(der);
    if (certificate === null) {
      return null;
    }
    chain.push(certificate);
  }
  return chain;
}

function everyCertificateWithinValidity(chain: readonly ParsedCertificate[], at: number): boolean {
  return chain.every((certificate) => at >= certificate.notBefore && at <= certificate.notAfter);
}

async function leafSignsJws(
  leaf: ParsedCertificate,
  jws: string,
  hash: 'SHA-256' | 'SHA-384',
): Promise<boolean> {
  const segments = jws.split('.');
  const signature = bytesOfBase64Url(segments[2]!);
  const key = await importCertificateKey(leaf);
  if (signature === null || key === null) {
    return false;
  }
  return crypto.subtle.verify(
    { name: 'ECDSA', hash },
    key,
    signature,
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
}

async function certificateSignedBy(
  child: ParsedCertificate,
  parent: ParsedCertificate,
): Promise<boolean> {
  const raw = ecdsaDerToRaw(child.signatureDer, parent.coordinateSize);
  const key = await importCertificateKey(parent);
  if (raw === null || key === null) {
    return false;
  }
  return crypto.subtle.verify({ name: 'ECDSA', hash: child.signatureHash }, key, raw, child.tbs);
}

async function importCertificateKey(certificate: ParsedCertificate): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey(
      'spki',
      certificate.spki,
      { name: 'ECDSA', namedCurve: certificate.namedCurve },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }
}

function pinnedRootMatches(roots: readonly string[], candidate: ParsedCertificate): boolean {
  for (const root of roots) {
    const der = decodeBase64(root.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    if (der !== null && bytesEqual(der, candidate.der)) {
      return true;
    }
  }
  return false;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function embeddedJws(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { signedPayload?: unknown } | null;
    if (typeof parsed?.signedPayload === 'string') {
      return parsed.signedPayload;
    }
  } catch {
    return body.split('.').length === 3 ? body : null;
  }
  return body.split('.').length === 3 ? body : null;
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [header, value] of Object.entries(headers)) {
    if (header.toLowerCase() === wanted) {
      return value;
    }
  }
  return null;
}

const HEX_CODE_OF = buildHexTable();

function buildHexTable(): Int8Array {
  const table = new Int8Array(128).fill(-1);
  const digits = '0123456789abcdef';
  for (let index = 0; index < digits.length; index += 1) {
    table[digits.charCodeAt(index)] = index;
    table[digits.toUpperCase().charCodeAt(index)] = index;
  }
  return table;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const high = hexValueOf(hex, index * 2);
    const low = hexValueOf(hex, index * 2 + 1);
    if (high < 0 || low < 0) {
      return null;
    }
    bytes[index] = (high << 4) | low;
  }
  return bytes;
}

function hexValueOf(hex: string, index: number): number {
  const code = hex.charCodeAt(index);
  return code < 128 ? HEX_CODE_OF[code]! : -1;
}
