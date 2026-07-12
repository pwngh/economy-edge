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

export interface ParsedCertificate {
  readonly der: Uint8Array;
  readonly tbs: Uint8Array;
  readonly spki: Uint8Array;
  readonly namedCurve: 'P-256' | 'P-384';
  readonly coordinateSize: 32 | 48;
  readonly signatureHash: 'SHA-256' | 'SHA-384';
  readonly signatureDer: Uint8Array;
  readonly notBefore: number;
  readonly notAfter: number;
}

interface Tlv {
  readonly tag: number;
  readonly start: number;
  readonly contentStart: number;
  readonly contentEnd: number;
}

const EC_PUBLIC_KEY_OID = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const CURVE_P256_OID = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
const CURVE_P384_OID = [0x2b, 0x81, 0x04, 0x00, 0x22];
const ECDSA_SHA256_OID = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];
const ECDSA_SHA384_OID = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03];

export function parseCertificate(der: Uint8Array): ParsedCertificate | null {
  const certificate = readTlv(der, 0);
  if (certificate === null || certificate.tag !== 0x30) {
    return null;
  }
  const [tbs, signatureAlgorithm, signatureBits] = childrenOf(der, certificate);
  if (
    tbs === undefined ||
    tbs.tag !== 0x30 ||
    signatureAlgorithm === undefined ||
    signatureBits === undefined ||
    signatureBits.tag !== 0x03
  ) {
    return null;
  }
  const spki = spkiTlvOf(der, tbs);
  if (spki === null) {
    return null;
  }
  const curve = curveOf(der, spki);
  const hash = hashOf(der, signatureAlgorithm);
  const validity = validityOf(der, tbs);
  if (curve === null || hash === null || validity === null) {
    return null;
  }
  return {
    der,
    tbs: der.slice(tbs.start, tbs.contentEnd),
    spki: der.slice(spki.start, spki.contentEnd),
    namedCurve: curve.namedCurve,
    coordinateSize: curve.coordinateSize,
    signatureHash: hash,
    signatureDer: der.slice(signatureBits.contentStart + 1, signatureBits.contentEnd),
    notBefore: validity.notBefore,
    notAfter: validity.notAfter,
  };
}

export function ecdsaDerToRaw(signature: Uint8Array, coordinateSize: number): Uint8Array | null {
  const sequence = readTlv(signature, 0);
  if (sequence === null || sequence.tag !== 0x30) {
    return null;
  }
  const [r, s] = childrenOf(signature, sequence);
  const rBytes = integerBytes(signature, r, coordinateSize);
  const sBytes = integerBytes(signature, s, coordinateSize);
  if (rBytes === null || sBytes === null) {
    return null;
  }
  const raw = new Uint8Array(coordinateSize * 2);
  raw.set(rBytes, 0);
  raw.set(sBytes, coordinateSize);
  return raw;
}

function spkiTlvOf(bytes: Uint8Array, tbs: Tlv): Tlv | null {
  const fields = childrenOf(bytes, tbs);
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  const spki = fields[base + 5];
  return spki !== undefined && spki.tag === 0x30 ? spki : null;
}

function validityOf(bytes: Uint8Array, tbs: Tlv): { notBefore: number; notAfter: number } | null {
  const fields = childrenOf(bytes, tbs);
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  const validity = fields[base + 3];
  if (validity === undefined || validity.tag !== 0x30) {
    return null;
  }
  const [notBefore, notAfter] = childrenOf(bytes, validity);
  const from = timeOf(bytes, notBefore);
  const to = timeOf(bytes, notAfter);
  if (from === null || to === null) {
    return null;
  }
  return { notBefore: from, notAfter: to };
}

function timeOf(bytes: Uint8Array, tlv: Tlv | undefined): number | null {
  if (tlv === undefined || (tlv.tag !== 0x17 && tlv.tag !== 0x18)) {
    return null;
  }
  const text = String.fromCharCode(...bytes.slice(tlv.contentStart, tlv.contentEnd));
  const digits = tlv.tag === 0x17 ? 12 : 14;
  const match = new RegExp(`^(\\d{${digits}})Z$`).exec(text);
  if (match === null) {
    return null;
  }
  const stamp = match[1]!;
  const yearDigits = digits - 10;
  const shortYear = Number(stamp.slice(0, yearDigits));
  const year = tlv.tag === 0x17 ? (shortYear >= 50 ? 1900 : 2000) + shortYear : shortYear;
  const rest = stamp.slice(yearDigits);
  return Date.UTC(
    year,
    Number(rest.slice(0, 2)) - 1,
    Number(rest.slice(2, 4)),
    Number(rest.slice(4, 6)),
    Number(rest.slice(6, 8)),
    Number(rest.slice(8, 10)),
  );
}

function curveOf(
  bytes: Uint8Array,
  spki: Tlv,
): { namedCurve: 'P-256' | 'P-384'; coordinateSize: 32 | 48 } | null {
  const [algorithm] = childrenOf(bytes, spki);
  if (algorithm === undefined || algorithm.tag !== 0x30) {
    return null;
  }
  const [keyType, curve] = childrenOf(bytes, algorithm);
  if (!oidMatches(bytes, keyType, EC_PUBLIC_KEY_OID)) {
    return null;
  }
  if (oidMatches(bytes, curve, CURVE_P256_OID)) {
    return { namedCurve: 'P-256', coordinateSize: 32 };
  }
  if (oidMatches(bytes, curve, CURVE_P384_OID)) {
    return { namedCurve: 'P-384', coordinateSize: 48 };
  }
  return null;
}

function hashOf(bytes: Uint8Array, signatureAlgorithm: Tlv): 'SHA-256' | 'SHA-384' | null {
  const [oid] = childrenOf(bytes, signatureAlgorithm);
  if (oidMatches(bytes, oid, ECDSA_SHA256_OID)) {
    return 'SHA-256';
  }
  if (oidMatches(bytes, oid, ECDSA_SHA384_OID)) {
    return 'SHA-384';
  }
  return null;
}

function oidMatches(bytes: Uint8Array, tlv: Tlv | undefined, oid: number[]): boolean {
  if (tlv === undefined || tlv.tag !== 0x06 || tlv.contentEnd - tlv.contentStart !== oid.length) {
    return false;
  }
  for (let index = 0; index < oid.length; index += 1) {
    if (bytes[tlv.contentStart + index] !== oid[index]) {
      return false;
    }
  }
  return true;
}

function integerBytes(bytes: Uint8Array, tlv: Tlv | undefined, size: number): Uint8Array | null {
  if (tlv === undefined || tlv.tag !== 0x02) {
    return null;
  }
  let start = tlv.contentStart;
  while (start < tlv.contentEnd && bytes[start] === 0) {
    start += 1;
  }
  const length = tlv.contentEnd - start;
  if (length > size) {
    return null;
  }
  const padded = new Uint8Array(size);
  padded.set(bytes.slice(start, tlv.contentEnd), size - length);
  return padded;
}

function readTlv(bytes: Uint8Array, start: number): Tlv | null {
  if (start + 2 > bytes.length) {
    return null;
  }
  const tag = bytes[start];
  const first = bytes[start + 1];
  if ((first & 0x80) === 0) {
    const contentStart = start + 2;
    const contentEnd = contentStart + first;
    return contentEnd <= bytes.length ? { tag, start, contentStart, contentEnd } : null;
  }
  const lengthBytes = first & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 3 || start + 2 + lengthBytes > bytes.length) {
    return null;
  }
  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    length = length * 256 + bytes[start + 2 + index];
  }
  const contentStart = start + 2 + lengthBytes;
  const contentEnd = contentStart + length;
  return contentEnd <= bytes.length ? { tag, start, contentStart, contentEnd } : null;
}

function childrenOf(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const children: Tlv[] = [];
  let offset = parent.contentStart;
  while (offset < parent.contentEnd) {
    const child = readTlv(bytes, offset);
    if (child === null) {
      return children;
    }
    children.push(child);
    offset = child.contentEnd;
  }
  return children;
}
