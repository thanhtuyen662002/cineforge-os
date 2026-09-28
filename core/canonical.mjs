import crypto from 'node:crypto';

export const IDEMPOTENCY_CANONICAL_VERSION = 'IDEMPOTENCY_CANONICAL_V1';

/**
 * Render a JSON-compatible value with deterministic object-key ordering.
 *
 * Command payloads are received from JSON clients, but Core also exposes a
 * direct in-process API.  The renderer follows JSON.stringify's treatment of
 * undefined/function/symbol object members and array entries so equivalent
 * JSON requests receive the same digest regardless of object insertion order.
 */
function render(value, inArray = false) {
  if (value === null) return 'null';
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? 'null' : undefined;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'bigint') throw new TypeError('BigInt values are not valid JSON');
  if (Array.isArray(value)) {
    return `[${value.map((entry) => render(entry, true) ?? 'null').join(',')}]`;
  }
  if (typeof value === 'object') {
    const members = [];
    for (const key of Object.keys(value).sort()) {
      const rendered = render(value[key]);
      if (rendered !== undefined) members.push(`${JSON.stringify(key)}:${rendered}`);
    }
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`Unsupported JSON value type: ${typeof value}`);
}

export function canonicalJson(value) {
  const rendered = render(value);
  if (rendered === undefined) throw new TypeError('A JSON value is required');
  return rendered;
}

/**
 * Bind an idempotency key to both the command payload and optimistic version
 * preconditions.  The wrapper object keeps the two request components
 * distinct while canonicalJson removes irrelevant object-key ordering.
 */
export function idempotencyFingerprint(payload, expectedVersions) {
  return crypto.createHash('sha256')
    .update(canonicalJson({
      canonicalization_version: IDEMPOTENCY_CANONICAL_VERSION,
      payload,
      expected_versions: expectedVersions,
    }), 'utf8')
    .digest('hex');
}

