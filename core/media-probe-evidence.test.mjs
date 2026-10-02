import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_PROBE_EVIDENCE_MAX_RAW_BYTES,
  MEDIA_PROBE_EVIDENCE_SCHEMA_VERSION,
  MediaProbeEvidenceError,
  makeUnboundMediaProbeEvidence,
} from './media-probe-evidence.mjs';

const projectId = '018f1234-5678-7abc-8def-0123456789ab';
const assetRevisionId = '018f1234-5678-7abc-9def-0123456789ab';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);

function toolchain() {
  return {
    state: 'READY',
    overall_state: 'READY',
    verification_state: 'ARTIFACT_VERIFIED',
    execution_state: 'DISABLED',
    toolchain_id: 'ffmpeg-fixture',
    toolchain_version: '9.0.2',
    manifest_schema_version: 1,
    manifest_sha256: digestB,
    manifest_byte_size: 512,
    network_policy: 'DENY',
    shell_execution: 'NOT_USED',
    binaries: {
      ffmpeg: { state: 'VERIFIED', sha256: digestA, byte_size: 100, version: '9.0.2' },
      ffprobe: { state: 'VERIFIED', sha256: digestC, byte_size: 120, version: '9.0.2' },
    },
  };
}

function parsed(byteSize = 1234567) {
  return {
    schema_version: 'MEDIA_PROBE_V1',
    parser_policy_version: 'MEDIA_PROBE_PARSER_V1',
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: { num: 1001, den: 100 },
    byte_size: byteSize,
    bit_rate: 986667,
    streams: [
      { index: 0, kind: 'video', codec: 'h264', width: 1920, height: 1080, frame_rate: { num: 30000, den: 1001 } },
      { index: 1, kind: 'audio', codec: 'aac', sample_rate: 48000, channels: 2 },
    ],
  };
}

function options() {
  return {
    source: { project_id: projectId, asset_revision_id: assetRevisionId, content_hash: digestA, byte_size: 1234567 },
    toolchain: toolchain(),
    raw_stdout: Buffer.from('{"fixed":"ffprobe-profile"}', 'utf8'),
    parsed: parsed(),
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof MediaProbeEvidenceError && error.code === code, code);
}

test('binds exact source/toolchain/raw identities but remains UNKNOWN until Core transaction', () => {
  const evidence = makeUnboundMediaProbeEvidence(options());
  assert.equal(evidence.evidence_schema_version, MEDIA_PROBE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.verification_state, 'UNKNOWN');
  assert.equal(evidence.binding_state, 'PENDING_CORE_TRANSACTION');
  assert.equal(evidence.project_id, projectId);
  assert.equal(evidence.asset_revision_id, assetRevisionId);
  assert.equal(evidence.toolchain.ffprobe_sha256, digestC);
  assert.match(evidence.probe.raw_stdout_sha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.evidence_hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.toolchain), true);
  assert.equal(JSON.stringify(evidence).includes('path'), false);
  assert.equal(JSON.stringify(evidence).includes('argv'), false);
});

test('evidence hash is deterministic across parsed object insertion order', () => {
  const first = options();
  const second = options();
  second.parsed = {
    streams: second.parsed.streams,
    bit_rate: second.parsed.bit_rate,
    byte_size: second.parsed.byte_size,
    duration: second.parsed.duration,
    container: second.parsed.container,
    parser_policy_version: second.parsed.parser_policy_version,
    schema_version: second.parsed.schema_version,
  };
  assert.equal(makeUnboundMediaProbeEvidence(first).evidence_hash, makeUnboundMediaProbeEvidence(second).evidence_hash);
});

test('changing raw probe bytes changes both raw and envelope identity', () => {
  const first = makeUnboundMediaProbeEvidence(options());
  const changed = options();
  changed.raw_stdout = Buffer.from('{"fixed":"different-profile"}', 'utf8');
  const second = makeUnboundMediaProbeEvidence(changed);
  assert.notEqual(first.probe.raw_stdout_sha256, second.probe.raw_stdout_sha256);
  assert.notEqual(first.evidence_hash, second.evidence_hash);
});

test('rejects source identity drift and parser/source byte-size mismatch', () => {
  const upper = options();
  upper.source.content_hash = 'A'.repeat(64);
  expectCode(() => makeUnboundMediaProbeEvidence(upper), 'EVIDENCE_SHA256_INVALID');

  const wrongSize = options();
  wrongSize.parsed = parsed(1234568);
  expectCode(() => makeUnboundMediaProbeEvidence(wrongSize), 'EVIDENCE_SOURCE_SIZE_MISMATCH');

  const wrongProject = options();
  wrongProject.source.project_id = 'not-a-uuid';
  expectCode(() => makeUnboundMediaProbeEvidence(wrongProject), 'EVIDENCE_UUID_INVALID');
});

test('rejects unverified, network-enabled, shell-enabled or mismatched ffprobe toolchains', () => {
  for (const mutate of [
    (value) => { value.state = 'BLOCKED'; },
    (value) => { value.verification_state = 'UNKNOWN'; },
    (value) => { value.network_policy = 'ALLOW'; },
    (value) => { value.shell_execution = 'USED'; },
  ]) {
    const value = options();
    mutate(value.toolchain);
    expectCode(() => makeUnboundMediaProbeEvidence(value), value.toolchain.state === 'BLOCKED' || value.toolchain.verification_state === 'UNKNOWN'
      ? 'EVIDENCE_TOOLCHAIN_UNVERIFIED' : 'EVIDENCE_TOOLCHAIN_POLICY_INVALID');
  }
  const binary = options();
  binary.toolchain.binaries.ffprobe.state = 'FAIL';
  expectCode(() => makeUnboundMediaProbeEvidence(binary), 'EVIDENCE_FFPROBE_UNVERIFIED');
  const version = options();
  version.toolchain.binaries.ffprobe.version = '9.0.3';
  expectCode(() => makeUnboundMediaProbeEvidence(version), 'EVIDENCE_TOOLCHAIN_VERSION_MISMATCH');
});

test('rejects parser schema/policy drift and unsafe metadata values', () => {
  const schema = options();
  schema.parsed.schema_version = 'MEDIA_PROBE_V2';
  expectCode(() => makeUnboundMediaProbeEvidence(schema), 'EVIDENCE_PROBE_SCHEMA_MISMATCH');
  const policy = options();
  policy.parsed.parser_policy_version = 'MEDIA_PROBE_PARSER_V2';
  expectCode(() => makeUnboundMediaProbeEvidence(policy), 'EVIDENCE_PARSER_POLICY_MISMATCH');
  const nonfinite = options();
  nonfinite.parsed.bit_rate = Infinity;
  expectCode(() => makeUnboundMediaProbeEvidence(nonfinite), 'EVIDENCE_NUMBER_INVALID');
  const forbidden = options();
  forbidden.parsed.streams[0].path = 'C:\\secret\\asset.mp4';
  expectCode(() => makeUnboundMediaProbeEvidence(forbidden), 'EVIDENCE_REDACTION_VIOLATION');
});

test('raw evidence requires bytes and enforces the hard stdout bound', () => {
  const textValue = options();
  textValue.raw_stdout = '{"not":"bytes"}';
  expectCode(() => makeUnboundMediaProbeEvidence(textValue), 'EVIDENCE_RAW_BYTES_REQUIRED');
  const huge = options();
  huge.raw_stdout = Buffer.alloc(MEDIA_PROBE_EVIDENCE_MAX_RAW_BYTES + 1, 0x20);
  expectCode(() => makeUnboundMediaProbeEvidence(huge), 'EVIDENCE_RAW_SIZE_INVALID');
});

test('callers cannot inject a precomputed evidence hash or unknown option fields', () => {
  const value = options();
  value.evidence_hash = 'd'.repeat(64);
  expectCode(() => makeUnboundMediaProbeEvidence(value), 'EVIDENCE_OPTIONS_INVALID');
});
