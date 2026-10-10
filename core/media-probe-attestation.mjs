import crypto from 'node:crypto';
import { canonicalJson } from './canonical.mjs';
import { MEDIA_PROBE_SCHEMA_VERSION, MEDIA_PROBE_PARSER_VERSION } from './media-probe.mjs';

// PREPARED, pure verification. No process, filesystem, DB or public command.
export const MEDIA_PROBE_ATTESTATION_VERSION = 'MEDIA_PROBE_ATTESTATION_V1';
export const MEDIA_PROBE_TRUST_VERSION = 'MEDIA_PROBE_TRUST_V1';
const CAPABILITY = 'PROBE_MEDIA_ASSET_V1';
const DOMAIN = 'CINEFORGE_MEDIA_PROBE_ATTESTATION_V1\0';
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const STATEMENT_FIELDS = ['capability', 'platform', 'toolchain_id', 'toolchain_version', 'manifest_sha256',
  'ffprobe_sha256', 'ffprobe_byte_size', 'ffprobe_version', 'probe_schema_version', 'parser_policy_version',
  'native_contract', 'argv_profile_version', 'sandbox_profile_version', 'resource_profile_version',
  'certification_epoch', 'license_snapshot_sha256', 'runtime_evidence_sha256', 'not_before_utc_ms', 'expires_at_utc_ms'];
const POLICY_FIELDS = ['policy_version', 'policy_epoch', 'not_before_utc_ms', 'expires_at_utc_ms', 'keys', 'revoked_pack_hashes'];
const KEY_FIELDS = ['key_id', 'purpose', 'public_key_spki_base64', 'public_key_spki_sha256', 'state',
  'toolchain_ids', 'minimum_pack_epoch', 'not_before_utc_ms', 'expires_at_utc_ms'];
class Rejected extends Error { constructor(code) { super(code); this.code = code; } }
const reject = (code) => { throw new Rejected(code); };
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const matches = (regex, value) => typeof value === 'string' && regex.test(value);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function fields(value, expected, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== expected.length || !Object.keys(value).every((key) => expected.includes(key))) reject(code);
}
function window(value, code) {
  if (!positive(value.not_before_utc_ms) || !positive(value.expires_at_utc_ms)
    || value.not_before_utc_ms >= value.expires_at_utc_ms) reject(code);
}
const current = (value, now) => value.not_before_utc_ms <= now && now < value.expires_at_utc_ms;
function uniqueList(value, max, regex, sorted = false) {
  return Array.isArray(value) && value.length <= max && value.every((entry) => matches(regex, entry))
    && new Set(value).size === value.length && (!sorted || value.every((entry, i) => i === 0 || value[i - 1] < entry));
}
function bytesCopy(bytes, limit, code) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > limit) reject(code);
  return Buffer.from(bytes);
}
function decode(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { reject('PROBE_ATTESTATION_UTF8_INVALID'); }
  let depth = 0; let quoted = false; let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') { if (++depth > 8) reject('PROBE_ATTESTATION_DEPTH_LIMIT'); }
    else if (char === '}' || char === ']') depth--;
  }
  let value;
  try { value = JSON.parse(text); } catch { reject('PROBE_ATTESTATION_JSON_INVALID'); }
  const pending = [value]; let nodes = 0;
  while (pending.length) {
    const next = pending.pop();
    if (++nodes > 10000) reject('PROBE_ATTESTATION_NODE_LIMIT');
    if (typeof next === 'string' && Buffer.byteLength(next, 'utf8') > 4096) reject('PROBE_ATTESTATION_STRING_LIMIT');
    if (next !== null && typeof next === 'object') {
      for (const key of Object.keys(next)) { pending.push(key, next[key]); }
    }
  }
  if (canonicalJson(value) !== text) reject('PROBE_ATTESTATION_NOT_CANONICAL');
  return value;
}
function validatePolicy(policy) {
  fields(policy, POLICY_FIELDS, 'PROBE_TRUST_POLICY_INVALID');
  if (policy.policy_version !== MEDIA_PROBE_TRUST_VERSION || !positive(policy.policy_epoch)
    || !Array.isArray(policy.keys) || policy.keys.length < 1 || policy.keys.length > 16
    || !uniqueList(policy.revoked_pack_hashes, 1024, HASH, true)) reject('PROBE_TRUST_POLICY_INVALID');
  window(policy, 'PROBE_TRUST_WINDOW_INVALID');
  const ids = new Set();
  for (const key of policy.keys) {
    fields(key, KEY_FIELDS, 'PROBE_TRUST_KEY_INVALID');
    if (!matches(ID, key.key_id) || ids.has(key.key_id) || !matches(ID, key.purpose)
      || !['ACTIVE', 'REVOKED', 'EXPIRED'].includes(key.state) || !positive(key.minimum_pack_epoch)
      || !uniqueList(key.toolchain_ids, 64, ID) || key.toolchain_ids.length < 1
      || !matches(HASH, key.public_key_spki_sha256)
      || typeof key.public_key_spki_base64 !== 'string' || key.public_key_spki_base64.length !== 60) reject('PROBE_TRUST_KEY_INVALID');
    ids.add(key.key_id); window(key, 'PROBE_TRUST_KEY_INVALID');
    const der = Buffer.from(key.public_key_spki_base64, 'base64');
    if (der.length !== 44 || der.toString('base64') !== key.public_key_spki_base64
      || der.subarray(0, 12).toString('hex') !== '302a300506032b6570032100'
      || hash(der) !== key.public_key_spki_sha256) reject('PROBE_TRUST_KEY_PIN_MISMATCH');
  }
}
function validateStatement(statement) {
  fields(statement, STATEMENT_FIELDS, 'PROBE_ATTESTATION_STATEMENT_INVALID');
  if (statement.capability !== CAPABILITY) reject('PROBE_ATTESTATION_CAPABILITY_MISMATCH');
  if (statement.platform !== 'win32-x64' || statement.probe_schema_version !== MEDIA_PROBE_SCHEMA_VERSION
    || statement.parser_policy_version !== MEDIA_PROBE_PARSER_VERSION || statement.native_contract !== 'NATIVE_MEDIA_PROBE_V1'
    || statement.argv_profile_version !== 'MEDIA_PROBE_ARGV_V1'
    || statement.sandbox_profile_version !== 'WINDOWS_APPCONTAINER_PROBE_V1'
    || statement.resource_profile_version !== 'MEDIA_PROBE_RESOURCE_V1') reject('PROBE_ATTESTATION_PROFILE_MISMATCH');
  if (!matches(ID, statement.toolchain_id) || !matches(VERSION, statement.toolchain_version)
    || statement.ffprobe_version !== statement.toolchain_version || !positive(statement.ffprobe_byte_size)
    || statement.ffprobe_byte_size > 536870912 || !positive(statement.certification_epoch)
    || !['manifest_sha256', 'ffprobe_sha256', 'license_snapshot_sha256', 'runtime_evidence_sha256']
      .every((field) => matches(HASH, statement[field]))) reject('PROBE_ATTESTATION_STATEMENT_INVALID');
  window(statement, 'PROBE_ATTESTATION_WINDOW_INVALID');
}

/** Trusted Core-only inputs; HTTP/UI values must never supply trustContext. */
export function verifyMediaProbeAttestation({ envelopeBytes, trustPolicyBytes, trustContext, artifact } = {}) {
  try {
    if (trustContext?.timeHealth !== 'TRUSTED' || !positive(trustContext.nowUtcMs)) reject('PROBE_ATTESTATION_TIME_UNTRUSTED');
    if (trustContext.trustFreshness !== 'FRESH') reject('PROBE_ATTESTATION_TRUST_STALE');
    if (!positive(trustContext.minimumPolicyEpoch) || !matches(HASH, trustContext.policySha256)) reject('PROBE_TRUST_CONTEXT_INVALID');
    const policyBytes = bytesCopy(trustPolicyBytes, 262144, 'PROBE_TRUST_POLICY_SIZE_INVALID');
    const policyHash = hash(policyBytes);
    if (policyHash !== trustContext.policySha256) reject('PROBE_TRUST_POLICY_PIN_MISMATCH');
    const policy = decode(policyBytes); validatePolicy(policy);
    if (policy.policy_epoch < trustContext.minimumPolicyEpoch) reject('PROBE_TRUST_POLICY_ROLLBACK');
    if (!current(policy, trustContext.nowUtcMs)) reject('PROBE_TRUST_POLICY_EXPIRED_OR_EARLY');
    const envelopeCopy = bytesCopy(envelopeBytes, 65536, 'PROBE_ATTESTATION_SIZE_INVALID');
    const certificateHash = hash(envelopeCopy);
    if (policy.revoked_pack_hashes.includes(certificateHash)) reject('PROBE_ATTESTATION_REVOKED');
    const envelope = decode(envelopeCopy);
    fields(envelope, ['envelope_version', 'statement', 'signature'], 'PROBE_ATTESTATION_ENVELOPE_INVALID');
    if (envelope.envelope_version !== MEDIA_PROBE_ATTESTATION_VERSION) reject('PROBE_ATTESTATION_ENVELOPE_INVALID');
    fields(envelope.signature, ['algorithm', 'key_id', 'signature_hex'], 'PROBE_ATTESTATION_SIGNATURE_INVALID');
    if (envelope.signature.algorithm !== 'ED25519' || !matches(ID, envelope.signature.key_id)
      || !matches(/^[0-9a-f]{128}$/, envelope.signature.signature_hex)) reject('PROBE_ATTESTATION_SIGNATURE_INVALID');
    validateStatement(envelope.statement);
    const key = policy.keys.find((entry) => entry.key_id === envelope.signature.key_id);
    if (!key || key.state !== 'ACTIVE') reject('PROBE_ATTESTATION_KEY_NOT_ACTIVE');
    if (key.purpose !== CAPABILITY || !key.toolchain_ids.includes(envelope.statement.toolchain_id)) reject('PROBE_ATTESTATION_KEY_SCOPE_MISMATCH');
    if (envelope.statement.certification_epoch < key.minimum_pack_epoch) reject('PROBE_ATTESTATION_PACK_ROLLBACK');
    if (!current(key, trustContext.nowUtcMs) || !current(envelope.statement, trustContext.nowUtcMs)
      || envelope.statement.not_before_utc_ms < key.not_before_utc_ms
      || envelope.statement.expires_at_utc_ms > key.expires_at_utc_ms) reject('PROBE_ATTESTATION_WINDOW_REJECTED');
    const publicKey = crypto.createPublicKey({ key: Buffer.from(key.public_key_spki_base64, 'base64'), format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519' || !crypto.verify(null,
      Buffer.from(DOMAIN + canonicalJson(envelope.statement), 'utf8'), publicKey,
      Buffer.from(envelope.signature.signature_hex, 'hex'))) reject('PROBE_ATTESTATION_SIGNATURE_REJECTED');
    const s = envelope.statement; const binary = artifact?.binaries?.ffprobe;
    if (artifact?.capability !== 'LOCAL_RENDERER_TOOLCHAIN_PREFLIGHT' || artifact.state !== 'READY'
      || artifact.verification_state !== 'ARTIFACT_VERIFIED' || artifact.execution_state !== 'DISABLED'
      || artifact.network_policy !== 'DENY' || artifact.toolchain_id !== s.toolchain_id
      || artifact.toolchain_version !== s.toolchain_version || artifact.manifest_sha256 !== s.manifest_sha256
      || binary?.state !== 'VERIFIED' || binary.sha256 !== s.ffprobe_sha256 || binary.byte_size !== s.ffprobe_byte_size
      || binary.version !== s.ffprobe_version) reject('PROBE_ATTESTATION_ARTIFACT_MISMATCH');
    return Object.freeze({ contract: MEDIA_PROBE_ATTESTATION_VERSION, state: 'ATTESTATION_VERIFIED',
      code: 'PROBE_ATTESTATION_VERIFIED', execution_state: 'DISABLED', capability: CAPABILITY,
      certificate_sha256: certificateHash, trust_generation: policyHash, policy_epoch: policy.policy_epoch,
      certification_epoch: s.certification_epoch, key_id: key.key_id, key_spki_sha256: key.public_key_spki_sha256,
      toolchain_id: s.toolchain_id, toolchain_version: s.toolchain_version, manifest_sha256: s.manifest_sha256,
      ffprobe_sha256: s.ffprobe_sha256, ffprobe_byte_size: s.ffprobe_byte_size, expires_at_utc_ms: s.expires_at_utc_ms,
      valid_from_utc_ms: Math.max(s.not_before_utc_ms, key.not_before_utc_ms, policy.not_before_utc_ms),
      valid_until_utc_ms: Math.min(s.expires_at_utc_ms, key.expires_at_utc_ms, policy.expires_at_utc_ms),
      probe_schema_version: s.probe_schema_version, parser_policy_version: s.parser_policy_version,
      native_contract: s.native_contract, argv_profile_version: s.argv_profile_version,
      sandbox_profile_version: s.sandbox_profile_version, resource_profile_version: s.resource_profile_version,
      license_snapshot_sha256: s.license_snapshot_sha256, runtime_evidence_sha256: s.runtime_evidence_sha256 });
  } catch (error) {
    return Object.freeze({ contract: MEDIA_PROBE_ATTESTATION_VERSION, state: 'BLOCKED_TOOLCHAIN',
      code: error instanceof Rejected ? error.code : 'PROBE_ATTESTATION_INVALID', execution_state: 'DISABLED' });
  }
}
