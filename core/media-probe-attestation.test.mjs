import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson } from './canonical.mjs';
import { preflightRendererToolchain } from './renderer-toolchain.mjs';
import { verifyMediaProbeAttestation } from './media-probe-attestation.mjs';

// Ephemeral fixture signing authority, never written or used by product startup.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const publicDer = publicKey.export({ format: 'der', type: 'spki' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-attestation-'));
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(canonicalJson(value), 'utf8');
const binary = Buffer.from('INERT FIXTURE; NOT A CERTIFIED EXECUTABLE');
const manifest = { manifest_type: 'CINEFORGE_RENDERER_TOOLCHAIN', manifest_schema_version: 1,
  toolchain_id: 'fixture-toolchain', toolchain_version: '1.0.0', network: false, binaries: {} };
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(root, process.platform === 'win32' ? name + '.exe' : name);
  fs.writeFileSync(file, binary);
  manifest.binaries[name] = { path: file, sha256: digest(binary), version: '1.0.0', size: binary.length };
}
const manifestPath = path.join(root, 'renderer-toolchain.json'); fs.writeFileSync(manifestPath, encode(manifest));
const preflight = () => preflightRendererToolchain({ root, manifestPath, allowObjectManifest: false });
const artifact = preflight(); assert.equal(artifact.verification_state, 'ARTIFACT_VERIFIED');
after(() => {
  for (const name of ['ffmpeg', 'ffprobe']) fs.unlinkSync(manifest.binaries[name].path);
  fs.unlinkSync(manifestPath); fs.rmdirSync(root);
});
const NOW = 1800000000000;
const originalStatement = {
  capability: 'PROBE_MEDIA_ASSET_V1', platform: 'win32-x64', toolchain_id: 'fixture-toolchain', toolchain_version: '1.0.0',
  manifest_sha256: artifact.manifest_sha256, ffprobe_sha256: digest(binary), ffprobe_byte_size: binary.length,
  ffprobe_version: '1.0.0', probe_schema_version: 'MEDIA_PROBE_V1', parser_policy_version: 'MEDIA_PROBE_PARSER_V1',
  native_contract: 'NATIVE_MEDIA_PROBE_V1', argv_profile_version: 'MEDIA_PROBE_ARGV_V1',
  sandbox_profile_version: 'WINDOWS_APPCONTAINER_PROBE_V1', resource_profile_version: 'MEDIA_PROBE_RESOURCE_V1',
  certification_epoch: 5, license_snapshot_sha256: digest('fixture license snapshot'),
  runtime_evidence_sha256: digest('fixture runtime report'), not_before_utc_ms: NOW - 1000, expires_at_utc_ms: NOW + 1000,
};
const originalPolicy = {
  policy_version: 'MEDIA_PROBE_TRUST_V1', policy_epoch: 8, not_before_utc_ms: NOW - 10000, expires_at_utc_ms: NOW + 10000,
  keys: [{ key_id: 'fixture-key', purpose: 'PROBE_MEDIA_ASSET_V1', public_key_spki_base64: publicDer.toString('base64'),
    public_key_spki_sha256: digest(publicDer), state: 'ACTIVE', toolchain_ids: ['fixture-toolchain'], minimum_pack_epoch: 5,
    not_before_utc_ms: NOW - 10000, expires_at_utc_ms: NOW + 10000 }], revoked_pack_hashes: [],
};
function fixture(statementChange = () => {}, policyChange = () => {}) {
  const statement = structuredClone(originalStatement); statementChange(statement);
  const envelope = { envelope_version: 'MEDIA_PROBE_ATTESTATION_V1', statement,
    signature: { algorithm: 'ED25519', key_id: 'fixture-key', signature_hex: crypto.sign(null,
      Buffer.from('CINEFORGE_MEDIA_PROBE_ATTESTATION_V1\0' + canonicalJson(statement)), privateKey).toString('hex') } };
  const envelopeBytes = encode(envelope);
  const policy = structuredClone(originalPolicy); policyChange(policy, envelopeBytes);
  const trustPolicyBytes = encode(policy);
  return { envelopeBytes, trustPolicyBytes, artifact: structuredClone(artifact), trustContext: {
    policySha256: digest(trustPolicyBytes), minimumPolicyEpoch: 8, nowUtcMs: NOW, timeHealth: 'TRUSTED', trustFreshness: 'FRESH',
  } };
}
function blocked(input, code) {
  const result = verifyMediaProbeAttestation(input);
  assert.deepEqual(result, { contract: 'MEDIA_PROBE_ATTESTATION_V1', state: 'BLOCKED_TOOLCHAIN', code, execution_state: 'DISABLED' });
}
function editEnvelope(input, change) {
  const value = JSON.parse(input.envelopeBytes); change(value); input.envelopeBytes = encode(value);
}

test('valid signature binds actual file preflight while retaining execution disabled and redaction', () => {
  const input = fixture(); const result = verifyMediaProbeAttestation(input);
  assert.equal(result.state, 'ATTESTATION_VERIFIED', result.code); assert.equal(result.execution_state, 'DISABLED');
  assert.equal(result.certificate_sha256, digest(input.envelopeBytes));
  assert.equal(result.trust_generation, digest(input.trustPolicyBytes));
  assert.equal(result.manifest_sha256, artifact.manifest_sha256); assert.equal(result.ffprobe_sha256, digest(binary));
  assert.equal(result.capability, 'PROBE_MEDIA_ASSET_V1'); assert.ok(Object.isFrozen(result));
  const projected = JSON.stringify(result);
  for (const forbidden of [root, 'signature_hex', 'public_key_spki_base64', 'PRIVATE KEY']) assert.ok(!projected.includes(forbidden));
  assert.equal(fs.readFileSync(manifest.binaries.ffprobe.path).equals(binary), true);
});
test('an altered signed statement is rejected', () => {
  const input = fixture(); editEnvelope(input, (value) => { value.statement.ffprobe_sha256 = '0'.repeat(64); });
  blocked(input, 'PROBE_ATTESTATION_SIGNATURE_REJECTED');
});
test('signature from a different authority is rejected', () => {
  const input = fixture(); const other = crypto.generateKeyPairSync('ed25519');
  editEnvelope(input, (value) => { value.signature.signature_hex = crypto.sign(null,
    Buffer.from('CINEFORGE_MEDIA_PROBE_ATTESTATION_V1\0' + canonicalJson(value.statement)), other.privateKey).toString('hex'); });
  blocked(input, 'PROBE_ATTESTATION_SIGNATURE_REJECTED');
});
test('signature cannot be replayed from a different message domain', () => {
  const input = fixture(); editEnvelope(input, (value) => { value.signature.signature_hex = crypto.sign(null,
    encode(value.statement), privateKey).toString('hex'); }); blocked(input, 'PROBE_ATTESTATION_SIGNATURE_REJECTED');
});
for (const [name, mutate, code] of [
  ['unknown key', (e) => { e.signature.key_id = 'not-trusted'; }, 'PROBE_ATTESTATION_KEY_NOT_ACTIVE'],
  ['algorithm negotiation', (e) => { e.signature.algorithm = 'RSA'; }, 'PROBE_ATTESTATION_SIGNATURE_INVALID'],
  ['short signature', (e) => { e.signature.signature_hex = '00'; }, 'PROBE_ATTESTATION_SIGNATURE_INVALID'],
  ['caller supplied key', (e) => { e.signature.public_key = publicDer.toString('base64'); }, 'PROBE_ATTESTATION_SIGNATURE_INVALID'],
  ['unknown envelope field', (e) => { e.path = root; }, 'PROBE_ATTESTATION_ENVELOPE_INVALID'],
  ['wrong envelope version', (e) => { e.envelope_version = 'MEDIA_PROBE_ATTESTATION_V2'; }, 'PROBE_ATTESTATION_ENVELOPE_INVALID'],
]) test(name, () => { const input = fixture(); editEnvelope(input, mutate); blocked(input, code); });
for (const [name, mutate, code] of [
  ['render capability', (s) => { s.capability = 'RENDER_MASTER'; }, 'PROBE_ATTESTATION_CAPABILITY_MISMATCH'],
  ['platform mismatch', (s) => { s.platform = 'linux-x64'; }, 'PROBE_ATTESTATION_PROFILE_MISMATCH'],
  ['parser mismatch', (s) => { s.parser_policy_version = 'other'; }, 'PROBE_ATTESTATION_PROFILE_MISMATCH'],
  ['arbitrary argv profile', (s) => { s.argv_profile_version = 'SHELL'; }, 'PROBE_ATTESTATION_PROFILE_MISMATCH'],
  ['sandbox downgrade', (s) => { s.sandbox_profile_version = 'NONE'; }, 'PROBE_ATTESTATION_PROFILE_MISMATCH'],
  ['resource profile downgrade', (s) => { s.resource_profile_version = 'UNLIMITED'; }, 'PROBE_ATTESTATION_PROFILE_MISMATCH'],
  ['unsafe binary size', (s) => { s.ffprobe_byte_size = 536870913; }, 'PROBE_ATTESTATION_STATEMENT_INVALID'],
  ['version mismatch', (s) => { s.ffprobe_version = '2.0.0'; }, 'PROBE_ATTESTATION_STATEMENT_INVALID'],
  ['NUL digest', (s) => { s.manifest_sha256 = '0'.repeat(63) + '\0'; }, 'PROBE_ATTESTATION_STATEMENT_INVALID'],
  ['arbitrary statement option', (s) => { s.argv = ['--shell']; }, 'PROBE_ATTESTATION_STATEMENT_INVALID'],
  ['pack epoch rollback', (s) => { s.certification_epoch = 4; }, 'PROBE_ATTESTATION_PACK_ROLLBACK'],
  ['not yet valid', (s) => { s.not_before_utc_ms = NOW + 1; }, 'PROBE_ATTESTATION_WINDOW_REJECTED'],
  ['exclusive expiry', (s) => { s.expires_at_utc_ms = NOW; }, 'PROBE_ATTESTATION_WINDOW_REJECTED'],
  ['outlives key', (s) => { s.expires_at_utc_ms = NOW + 10001; }, 'PROBE_ATTESTATION_WINDOW_REJECTED'],
]) test(name, () => blocked(fixture(mutate), code));
for (const [name, mutate, code] of [
  ['revoked key', (p) => { p.keys[0].state = 'REVOKED'; }, 'PROBE_ATTESTATION_KEY_NOT_ACTIVE'],
  ['expired key', (p) => { p.keys[0].state = 'EXPIRED'; }, 'PROBE_ATTESTATION_KEY_NOT_ACTIVE'],
  ['wrong key purpose', (p) => { p.keys[0].purpose = 'RELEASE_SIGNING'; }, 'PROBE_ATTESTATION_KEY_SCOPE_MISMATCH'],
  ['wrong key scope', (p) => { p.keys[0].toolchain_ids = ['different-toolchain']; }, 'PROBE_ATTESTATION_KEY_SCOPE_MISMATCH'],
  ['SPKI hash mismatch', (p) => { p.keys[0].public_key_spki_sha256 = '0'.repeat(64); }, 'PROBE_TRUST_KEY_PIN_MISMATCH'],
  ['malformed SPKI', (p) => { p.keys[0].public_key_spki_base64 = 'A'.repeat(60); }, 'PROBE_TRUST_KEY_PIN_MISMATCH'],
  ['duplicate authority', (p) => { p.keys.push(structuredClone(p.keys[0])); }, 'PROBE_TRUST_KEY_INVALID'],
  ['policy epoch rollback', (p) => { p.policy_epoch = 7; }, 'PROBE_TRUST_POLICY_ROLLBACK'],
  ['expired policy', (p) => { p.expires_at_utc_ms = NOW; }, 'PROBE_TRUST_POLICY_EXPIRED_OR_EARLY'],
  ['future policy', (p) => { p.not_before_utc_ms = NOW + 1; }, 'PROBE_TRUST_POLICY_EXPIRED_OR_EARLY'],
  ['revoked pack', (p, bytes) => { p.revoked_pack_hashes = [digest(bytes)]; }, 'PROBE_ATTESTATION_REVOKED'],
]) test(name, () => blocked(fixture(undefined, mutate), code));
for (const [name, mutate, code] of [
  ['untrusted time', (i) => { i.trustContext.timeHealth = 'UNTRUSTED'; }, 'PROBE_ATTESTATION_TIME_UNTRUSTED'],
  ['invalid time', (i) => { i.trustContext.nowUtcMs = NaN; }, 'PROBE_ATTESTATION_TIME_UNTRUSTED'],
  ['stale trust', (i) => { i.trustContext.trustFreshness = 'STALE'; }, 'PROBE_ATTESTATION_TRUST_STALE'],
  ['missing durable floor', (i) => { delete i.trustContext.minimumPolicyEpoch; }, 'PROBE_TRUST_CONTEXT_INVALID'],
  ['unapproved policy hash', (i) => { i.trustContext.policySha256 = '0'.repeat(64); }, 'PROBE_TRUST_POLICY_PIN_MISMATCH'],
  ['changed manifest', (i) => { i.artifact.manifest_sha256 = '0'.repeat(64); }, 'PROBE_ATTESTATION_ARTIFACT_MISMATCH'],
  ['changed observed binary hash', (i) => { i.artifact.binaries.ffprobe.sha256 = '0'.repeat(64); }, 'PROBE_ATTESTATION_ARTIFACT_MISMATCH'],
  ['changed observed size', (i) => { i.artifact.binaries.ffprobe.byte_size++; }, 'PROBE_ATTESTATION_ARTIFACT_MISMATCH'],
  ['unverified artifact', (i) => { i.artifact.verification_state = 'UNKNOWN'; }, 'PROBE_ATTESTATION_ARTIFACT_MISMATCH'],
]) test(name, () => { const input = fixture(); mutate(input); blocked(input, code); });
test('tampered fixture bytes fail a new actual preflight and cannot satisfy attestation', () => {
  try {
    fs.writeFileSync(manifest.binaries.ffprobe.path, Buffer.alloc(binary.length, 1));
    const input = fixture(); input.artifact = preflight(); blocked(input, 'PROBE_ATTESTATION_ARTIFACT_MISMATCH');
  } finally { fs.writeFileSync(manifest.binaries.ffprobe.path, binary); }
});
for (const [name, change, code] of [
  ['duplicate key', (b) => Buffer.from(b.toString().replace('"envelope_version":', '"envelope_version":"MEDIA_PROBE_ATTESTATION_V1","envelope_version":')), 'PROBE_ATTESTATION_NOT_CANONICAL'],
  ['BOM', (b) => Buffer.concat([Buffer.from([239, 187, 191]), b]), 'PROBE_ATTESTATION_JSON_INVALID'],
  ['malformed UTF8', () => Buffer.from([255]), 'PROBE_ATTESTATION_UTF8_INVALID'],
  ['noncanonical whitespace', (b) => Buffer.concat([Buffer.from(' '), b]), 'PROBE_ATTESTATION_NOT_CANONICAL'],
  ['oversized envelope', () => Buffer.alloc(65537), 'PROBE_ATTESTATION_SIZE_INVALID'],
  ['depth bomb', () => Buffer.from('['.repeat(9) + '0' + ']'.repeat(9)), 'PROBE_ATTESTATION_DEPTH_LIMIT'],
  ['node bomb', () => encode(Array(6000).fill(0)), 'PROBE_ATTESTATION_NODE_LIMIT'],
  ['string bomb', () => encode('x'.repeat(4097)), 'PROBE_ATTESTATION_STRING_LIMIT'],
]) test(name, () => { const input = fixture(); input.envelopeBytes = change(input.envelopeBytes); blocked(input, code); });
test('missing context and oversized policy block without leaking input', () => {
  blocked({}, 'PROBE_ATTESTATION_TIME_UNTRUSTED');
  const input = fixture(); input.trustPolicyBytes = Buffer.alloc(262145); blocked(input, 'PROBE_TRUST_POLICY_SIZE_INVALID');
});
test('inclusive not-before is accepted with correct authority and artifact', () => {
  const input = fixture((s) => { s.not_before_utc_ms = NOW; }); assert.equal(verifyMediaProbeAttestation(input).state, 'ATTESTATION_VERIFIED');
});
