import crypto from 'node:crypto';

export const MEDIA_PROBE_EVIDENCE_SCHEMA_VERSION = 'MEDIA_PROBE_PARSED_EVIDENCE_V1';
export const MEDIA_PROBE_EVIDENCE_MAX_RAW_BYTES = 8 * 1024 * 1024;

const PARSER_SCHEMA_VERSION = 'MEDIA_PROBE_V1';
const PARSER_POLICY_VERSION = 'MEDIA_PROBE_PARSER_V1';
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/;
const SOURCE_KEYS = new Set(['project_id', 'asset_revision_id', 'content_hash', 'byte_size']);
const OPTION_KEYS = new Set(['source', 'toolchain', 'raw_stdout', 'parsed']);
const FORBIDDEN_EVIDENCE_KEYS = new Set(['path', 'filename', 'argv', 'command', 'environment', 'uri', 'url']);
const MAX_PARSED_NODES = 50_000;
const MAX_PARSED_STRING_BYTES = 4_096;

export class MediaProbeEvidenceError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'MediaProbeEvidenceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = {}) {
  throw new MediaProbeEvidenceError(code, details);
}

function objectLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value, allowed, code, scope) {
  if (!objectLike(value)) fail(code, { scope });
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, { scope, field: key });
  }
}

function requireSha256(value, field) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) fail('EVIDENCE_SHA256_INVALID', { field });
  return value;
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail('EVIDENCE_IDENTIFIER_INVALID', { field });
  return value;
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('EVIDENCE_UUID_INVALID', { field });
  return value.toLowerCase();
}

function requirePositiveSafeInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('EVIDENCE_INTEGER_INVALID', { field });
  return value;
}

function strictJsonCopy(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > MAX_PARSED_NODES) fail('EVIDENCE_TOO_MANY_NODES');
  if (depth > 40) fail('EVIDENCE_VALUE_TOO_DEEP');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_PARSED_STRING_BYTES) fail('EVIDENCE_STRING_TOO_LARGE');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail('EVIDENCE_NUMBER_INVALID');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) fail('EVIDENCE_ARRAY_TOO_LARGE');
    return value.map((item) => strictJsonCopy(item, depth + 1, state));
  }
  if (objectLike(value)) {
    const keys = Object.keys(value);
    if (keys.length > 256) fail('EVIDENCE_OBJECT_TOO_LARGE');
    const copy = {};
    for (const key of keys.sort()) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('EVIDENCE_UNSAFE_KEY', { field: key });
      if (FORBIDDEN_EVIDENCE_KEYS.has(key.toLowerCase())) fail('EVIDENCE_REDACTION_VIOLATION', { field: key });
      copy[key] = strictJsonCopy(value[key], depth + 1, state);
    }
    return copy;
  }
  fail('EVIDENCE_VALUE_INVALID');
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function rawBytes(value) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = Buffer.from(value);
  else if (value instanceof Uint8Array) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else fail('EVIDENCE_RAW_BYTES_REQUIRED');
  if (bytes.byteLength < 2 || bytes.byteLength > MEDIA_PROBE_EVIDENCE_MAX_RAW_BYTES) fail('EVIDENCE_RAW_SIZE_INVALID');
  return bytes;
}

function sourceIdentity(value) {
  onlyKeys(value, SOURCE_KEYS, 'EVIDENCE_SOURCE_INVALID', 'source');
  return {
    project_id: requireUuid(value.project_id, 'source.project_id'),
    asset_revision_id: requireUuid(value.asset_revision_id, 'source.asset_revision_id'),
    content_hash: requireSha256(value.content_hash, 'source.content_hash'),
    byte_size: requirePositiveSafeInteger(value.byte_size, 'source.byte_size'),
  };
}

function toolchainIdentity(value) {
  if (!objectLike(value)) fail('EVIDENCE_TOOLCHAIN_INVALID');
  if (value.state !== 'READY' || value.verification_state !== 'ARTIFACT_VERIFIED') fail('EVIDENCE_TOOLCHAIN_UNVERIFIED');
  if (value.network_policy !== 'DENY' || value.shell_execution !== 'NOT_USED') fail('EVIDENCE_TOOLCHAIN_POLICY_INVALID');
  if (!objectLike(value.binaries) || !objectLike(value.binaries.ffprobe)) fail('EVIDENCE_FFPROBE_MISSING');
  const ffprobe = value.binaries.ffprobe;
  if (ffprobe.state !== 'VERIFIED') fail('EVIDENCE_FFPROBE_UNVERIFIED');
  const toolchainVersion = requireIdentifier(value.toolchain_version, 'toolchain.toolchain_version');
  const ffprobeVersion = requireIdentifier(ffprobe.version, 'toolchain.binaries.ffprobe.version');
  if (ffprobeVersion !== toolchainVersion) fail('EVIDENCE_TOOLCHAIN_VERSION_MISMATCH');
  return {
    toolchain_id: requireIdentifier(value.toolchain_id, 'toolchain.toolchain_id'),
    toolchain_version: toolchainVersion,
    manifest_schema_version: requirePositiveSafeInteger(value.manifest_schema_version, 'toolchain.manifest_schema_version', 1_000_000),
    manifest_sha256: requireSha256(value.manifest_sha256, 'toolchain.manifest_sha256'),
    manifest_byte_size: requirePositiveSafeInteger(value.manifest_byte_size, 'toolchain.manifest_byte_size', 1024 * 1024),
    ffprobe_sha256: requireSha256(ffprobe.sha256, 'toolchain.binaries.ffprobe.sha256'),
    ffprobe_byte_size: requirePositiveSafeInteger(ffprobe.byte_size, 'toolchain.binaries.ffprobe.byte_size', 1024 * 1024 * 1024),
    ffprobe_version: ffprobeVersion,
  };
}

function parsedMetadata(value, expectedByteSize) {
  if (!objectLike(value)) fail('EVIDENCE_PARSED_INVALID');
  if (value.schema_version !== PARSER_SCHEMA_VERSION) fail('EVIDENCE_PROBE_SCHEMA_MISMATCH');
  if (value.parser_policy_version !== PARSER_POLICY_VERSION) fail('EVIDENCE_PARSER_POLICY_MISMATCH');
  if (value.byte_size !== expectedByteSize) fail('EVIDENCE_SOURCE_SIZE_MISMATCH');
  if (!Array.isArray(value.streams) || value.streams.length < 1 || value.streams.length > 256) fail('EVIDENCE_STREAMS_INVALID');
  const copy = strictJsonCopy(value);
  return copy;
}

/**
 * Construct an immutable *unbound* evidence envelope after strict parser output.
 *
 * This deliberately never returns PASS. Core must revalidate source bytes and
 * toolchain identity immediately before a durable transaction can promote the
 * envelope into canonical technical_metadata.
 */
export function makeUnboundMediaProbeEvidence(options) {
  onlyKeys(options, OPTION_KEYS, 'EVIDENCE_OPTIONS_INVALID', 'options');
  const source = sourceIdentity(options.source);
  const toolchain = toolchainIdentity(options.toolchain);
  const bytes = rawBytes(options.raw_stdout);
  const technicalMetadata = parsedMetadata(options.parsed, source.byte_size);
  const rawSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const envelope = {
    evidence_schema_version: MEDIA_PROBE_EVIDENCE_SCHEMA_VERSION,
    verification_state: 'UNKNOWN',
    binding_state: 'PENDING_CORE_TRANSACTION',
    project_id: source.project_id,
    asset_revision_id: source.asset_revision_id,
    source_content_hash: source.content_hash,
    source_byte_size: source.byte_size,
    toolchain,
    probe: {
      schema_version: PARSER_SCHEMA_VERSION,
      parser_policy_version: PARSER_POLICY_VERSION,
      raw_stdout_sha256: rawSha256,
      raw_stdout_byte_size: bytes.byteLength,
    },
    technical_metadata: technicalMetadata,
  };
  const evidenceHash = crypto.createHash('sha256').update(canonicalJson(envelope), 'utf8').digest('hex');
  return freezeDeep({ ...envelope, evidence_hash: evidenceHash });
}
