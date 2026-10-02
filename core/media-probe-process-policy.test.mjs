import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_PROBE_EXECUTOR_BINDING_CLASS,
  MEDIA_PROBE_PROCESS_LIMITS,
  MediaProbeProcessPolicyError,
  createMediaProbeProcessPolicy,
  publicMediaProbeProcessPolicy,
} from './media-probe-process-policy.mjs';

const digestA = 'a'.repeat(64), digestB = 'b'.repeat(64), digestC = 'c'.repeat(64);
function fixture(platform = 'linux') {
  const ffprobePath = platform === 'win32' ? 'C:\\CineForge\\tools\\ffprobe.exe' : '/opt/cineforge/tools/ffprobe';
  const root = platform === 'win32' ? 'C:\\CineForge\\staging' : '/var/lib/cineforge/staging';
  return {
    platform,
    source: { private_root: root, relative_path: 'project-a/asset.bin', content_hash: digestA, byte_size: 1234 },
    toolchain: {
      capability: 'LOCAL_RENDERER_TOOLCHAIN_PREFLIGHT', state: 'READY', overall_state: 'READY',
      verification_state: 'ARTIFACT_VERIFIED', execution_state: 'DISABLED',
      toolchain_id: 'ffmpeg-certified', toolchain_version: '9.0.2', manifest_schema_version: 1,
      manifest_sha256: digestB, manifest_byte_size: 512, network_policy: 'DENY', shell_execution: 'NOT_USED',
      binaries: {
        ffmpeg: { state: 'VERIFIED', sha256: 'd'.repeat(64), byte_size: 150000, version: '9.0.2' },
        ffprobe: { state: 'VERIFIED', sha256: digestC, byte_size: 120000, version: '9.0.2' },
      }, reason_codes: [], checks: [], next_step: 'private executor remains disabled',
    },
    executor_binding: {
      class: MEDIA_PROBE_EXECUTOR_BINDING_CLASS, startup_bound: true,
      toolchain_id: 'ffmpeg-certified', toolchain_version: '9.0.2', manifest_sha256: digestB,
      ffprobe_path: ffprobePath, ffprobe_sha256: digestC, ffprobe_byte_size: 120000,
    },
  };
}
function expectCode(fn, code) { assert.throws(fn, (e) => e instanceof MediaProbeProcessPolicyError && e.code === code, code); }

test('accepts the existing path-free renderer preflight shape plus a matching private startup binding', () => {
  const value = fixture();
  assert.equal(Object.hasOwn(value.toolchain.binaries.ffprobe, 'path'), false);
  const plan = createMediaProbeProcessPolicy(value);
  assert.equal(plan.state, 'PLANNED'); assert.equal(plan.verification_state, 'UNKNOWN'); assert.equal(plan.execution_authorized, false);
  assert.deepEqual(plan.argv, ['-v','error','-protocol_whitelist','pipe','-show_format','-show_streams','-of','json','-i','pipe:0']);
  assert.equal(plan.process.shell, false); assert.equal(plan.process.network, 'DENY_REQUIRED');
  assert.equal(plan.process.containment, 'PROCESS_GROUP_REQUIRED'); assert.equal(plan.io.stdin, 'PINNED_SOURCE_FD');
});

test('public projection redacts private source/binary paths, binding and raw argv', () => {
  const projection = publicMediaProbeProcessPolicy(createMediaProbeProcessPolicy(fixture()));
  const text = JSON.stringify(projection);
  for (const forbidden of ['/opt/cineforge', '/var/lib/cineforge', 'pipe:0', 'executor_binding', 'ffprobe_path']) assert.equal(text.includes(forbidden), false);
  assert.equal(Object.hasOwn(projection, 'argv'), false); assert.equal(projection.execution_authorized, false);
});

test('caller cannot inject argv/env/shell or widen any hard limit', () => {
  const injected = fixture(); injected.argv = ['-version']; expectCode(() => createMediaProbeProcessPolicy(injected), 'PROCESS_POLICY_OPTIONS_INVALID');
  for (const [field, hard] of Object.entries(MEDIA_PROBE_PROCESS_LIMITS)) {
    const widened = fixture(); widened.limits = { [field]: hard + 1 };
    expectCode(() => createMediaProbeProcessPolicy(widened), 'PROCESS_POLICY_LIMIT_INVALID');
  }
});

test('rejects source traversal, URI input and network roots', () => {
  const traversal = fixture(); traversal.source.relative_path = '../secret.mp4'; expectCode(() => createMediaProbeProcessPolicy(traversal), 'PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  const uri = fixture(); uri.source.relative_path = 'https://example.invalid/a.mp4'; expectCode(() => createMediaProbeProcessPolicy(uri), 'PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  const network = fixture(); network.source.private_root = '//server/share'; expectCode(() => createMediaProbeProcessPolicy(network), 'PROCESS_POLICY_LOCAL_PATH_INVALID');
});

test('private executor binding must be startup-bound and exactly match redacted preflight evidence', () => {
  const untrusted = fixture(); untrusted.executor_binding.startup_bound = false; expectCode(() => createMediaProbeProcessPolicy(untrusted), 'PROCESS_POLICY_EXECUTOR_BINDING_UNTRUSTED');
  for (const [field, value] of [['toolchain_id','other-tool'], ['toolchain_version','9.0.3'], ['manifest_sha256',digestC], ['ffprobe_sha256',digestA], ['ffprobe_byte_size',120001]]) {
    const mismatch = fixture(); mismatch.executor_binding[field] = value;
    expectCode(() => createMediaProbeProcessPolicy(mismatch), 'PROCESS_POLICY_EXECUTOR_BINDING_MISMATCH');
  }
});

test('requires exact ffprobe executable name only in the private binding', () => {
  const wrong = fixture(); wrong.executor_binding.ffprobe_path = '/opt/cineforge/tools/python';
  expectCode(() => createMediaProbeProcessPolicy(wrong), 'PROCESS_POLICY_FFPROBE_NAME_INVALID');
});

test('rejects unverified or execution-enabled renderer preflight and network/shell drift', () => {
  const unknown = fixture(); unknown.toolchain.verification_state = 'UNKNOWN'; expectCode(() => createMediaProbeProcessPolicy(unknown), 'PROCESS_POLICY_TOOLCHAIN_UNVERIFIED');
  const enabled = fixture(); enabled.toolchain.execution_state = 'ENABLED'; expectCode(() => createMediaProbeProcessPolicy(enabled), 'PROCESS_POLICY_TOOLCHAIN_UNVERIFIED');
  const network = fixture(); network.toolchain.network_policy = 'ALLOW'; expectCode(() => createMediaProbeProcessPolicy(network), 'PROCESS_POLICY_TOOLCHAIN_BOUNDARY_INVALID');
  const shell = fixture(); shell.toolchain.shell_execution = 'USED'; expectCode(() => createMediaProbeProcessPolicy(shell), 'PROCESS_POLICY_TOOLCHAIN_BOUNDARY_INVALID');
});

test('windows policy remains fail-closed pending job-object descendant containment', () => {
  const plan = createMediaProbeProcessPolicy(fixture('win32'));
  assert.equal(plan.process.containment, 'WINDOWS_JOB_OBJECT_REQUIRED'); assert.equal(plan.execution_authorized, false);
  assert.deepEqual(plan.environment.allowlist, ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']);
});
