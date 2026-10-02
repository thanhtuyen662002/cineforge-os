import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_PROBE_PROCESS_LIMITS,
  MediaProbeProcessPolicyError,
  createMediaProbeProcessPolicy,
  publicMediaProbeProcessPolicy,
} from './media-probe-process-policy.mjs';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);

function fixture(platform = 'linux') {
  const ffprobe = platform === 'win32' ? 'C:\\CineForge\\tools\\ffprobe.exe' : '/opt/cineforge/tools/ffprobe';
  const root = platform === 'win32' ? 'C:\\CineForge\\staging' : '/var/lib/cineforge/staging';
  return {
    platform,
    source: { private_root: root, relative_path: 'project-a/asset.bin', content_hash: digestA, byte_size: 1234 },
    toolchain: {
      state: 'READY', verification_state: 'ARTIFACT_VERIFIED', network_policy: 'DENY', shell_execution: 'NOT_USED',
      toolchain_id: 'ffmpeg-certified', toolchain_version: '9.0.2', manifest_sha256: digestB,
      binaries: { ffprobe: { state: 'VERIFIED', path: ffprobe, sha256: digestC, byte_size: 120000, version: '9.0.2' } },
    },
    certification: { class: 'CERTIFIED_LOCAL_PACK', startup_bound: true, manifest_sha256: digestB },
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof MediaProbeProcessPolicyError && error.code === code, code);
}

test('builds a fixed pipe-only, shell-free, network-denied policy but never authorizes execution', () => {
  const plan = createMediaProbeProcessPolicy(fixture());
  assert.equal(plan.state, 'PLANNED');
  assert.equal(plan.verification_state, 'UNKNOWN');
  assert.equal(plan.execution_authorized, false);
  assert.deepEqual(plan.argv, ['-v','error','-protocol_whitelist','pipe','-show_format','-show_streams','-of','json','-i','pipe:0']);
  assert.equal(plan.process.shell, false);
  assert.equal(plan.process.network, 'DENY_REQUIRED');
  assert.equal(plan.process.containment, 'PROCESS_GROUP_REQUIRED');
  assert.equal(plan.io.stdin, 'PINNED_SOURCE_FD');
  assert.equal(Object.isFrozen(plan), true);
});

test('public projection redacts executable/source paths and raw argv', () => {
  const plan = createMediaProbeProcessPolicy(fixture());
  const projection = publicMediaProbeProcessPolicy(plan);
  const text = JSON.stringify(projection);
  assert.equal(text.includes('/opt/cineforge'), false);
  assert.equal(text.includes('/var/lib/cineforge'), false);
  assert.equal(text.includes('pipe:0'), false);
  assert.equal(Object.hasOwn(projection, 'argv'), false);
  assert.equal(projection.execution_authorized, false);
  assert.equal(projection.source_content_hash, digestA);
});

test('caller cannot inject argv/env/shell or widen any hard limit', () => {
  const value = fixture();
  value.argv = ['-version'];
  expectCode(() => createMediaProbeProcessPolicy(value), 'PROCESS_POLICY_OPTIONS_INVALID');
  for (const [field, hard] of Object.entries(MEDIA_PROBE_PROCESS_LIMITS)) {
    const widened = fixture();
    widened.limits = { [field]: hard + 1 };
    expectCode(() => createMediaProbeProcessPolicy(widened), 'PROCESS_POLICY_LIMIT_INVALID');
  }
});

test('rejects path escape, URI input and non-local/network roots', () => {
  const traversal = fixture(); traversal.source.relative_path = '../secret.mp4';
  expectCode(() => createMediaProbeProcessPolicy(traversal), 'PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  const uri = fixture(); uri.source.relative_path = 'https://example.invalid/a.mp4';
  expectCode(() => createMediaProbeProcessPolicy(uri), 'PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  const network = fixture(); network.source.private_root = '//server/share';
  expectCode(() => createMediaProbeProcessPolicy(network), 'PROCESS_POLICY_LOCAL_PATH_INVALID');
});

test('requires startup-bound certified pack and exact manifest/toolchain identity', () => {
  const fixtureClass = fixture(); fixtureClass.certification.class = 'TEST_FIXTURE';
  expectCode(() => createMediaProbeProcessPolicy(fixtureClass), 'PROCESS_POLICY_TOOLCHAIN_NOT_CERTIFIED');
  const mismatch = fixture(); mismatch.certification.manifest_sha256 = digestC;
  expectCode(() => createMediaProbeProcessPolicy(mismatch), 'PROCESS_POLICY_CERTIFICATION_MANIFEST_MISMATCH');
  const unverified = fixture(); unverified.toolchain.verification_state = 'UNKNOWN';
  expectCode(() => createMediaProbeProcessPolicy(unverified), 'PROCESS_POLICY_TOOLCHAIN_UNVERIFIED');
  const wrongVersion = fixture(); wrongVersion.toolchain.binaries.ffprobe.version = '9.0.3';
  expectCode(() => createMediaProbeProcessPolicy(wrongVersion), 'PROCESS_POLICY_TOOLCHAIN_VERSION_MISMATCH');
});

test('requires exact ffprobe executable name and rejects network/shell-enabled toolchain', () => {
  const wrongName = fixture(); wrongName.toolchain.binaries.ffprobe.path = '/opt/cineforge/tools/python';
  expectCode(() => createMediaProbeProcessPolicy(wrongName), 'PROCESS_POLICY_FFPROBE_NAME_INVALID');
  const network = fixture(); network.toolchain.network_policy = 'ALLOW';
  expectCode(() => createMediaProbeProcessPolicy(network), 'PROCESS_POLICY_TOOLCHAIN_BOUNDARY_INVALID');
  const shell = fixture(); shell.toolchain.shell_execution = 'USED';
  expectCode(() => createMediaProbeProcessPolicy(shell), 'PROCESS_POLICY_TOOLCHAIN_BOUNDARY_INVALID');
});

test('windows policy is fail-closed until job-object descendant containment exists', () => {
  const plan = createMediaProbeProcessPolicy(fixture('win32'));
  assert.equal(plan.process.containment, 'WINDOWS_JOB_OBJECT_REQUIRED');
  assert.equal(plan.execution_authorized, false);
  assert.deepEqual(plan.environment.allowlist, ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']);
});
