import crypto from 'node:crypto';

// UUIDv7 is used for externally visible identifiers.  Node 22 does not
// expose uuidv7 on every supported runtime, so this small implementation keeps
// the timestamp and variant/version bits compliant while using cryptographic
// randomness for the remaining bits.
export function uuidv7() {
  const timestampMs = BigInt(Date.now()) & ((1n << 48n) - 1n);
  const random = crypto.randomBytes(10);
  const randomA = (BigInt(random[0]) << 4n | BigInt(random[1] >> 4)) & 0xfffn;
  let randomB = 0n;
  for (let i = 2; i < 10; i += 1) randomB = (randomB << 8n) | BigInt(random[i]);
  randomB &= (1n << 62n) - 1n;

  const value = (timestampMs << 80n)
    | (7n << 76n)
    | (randomA << 64n)
    | (2n << 62n)
    | randomB;
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowUtcUs() {
  return Date.now() * 1000;
}

export function rfc3339FromUs(value) {
  return new Date(Math.floor(Number(value) / 1000)).toISOString();
}

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
