import path from 'node:path';

export const MEDIA_PROBE_PROCESS_POLICY_VERSION = 'MEDIA_PROBE_PROCESS_POLICY_V1';
export const MEDIA_PROBE_EXECUTOR_BINDING_CLASS = 'CINEFORGE_MEDIA_PROBE_EXECUTOR_BINDING_V1';
export const MEDIA_PROBE_PROCESS_LIMITS = Object.freeze({
  stdout_max_bytes: 8 * 1024 * 1024,
  stderr_max_bytes: 1024 * 1024,
  wall_time_ms: 120_000,
  cancellation_grace_ms: 2_000,
  max_attempts: 3,
});

const OPTION_KEYS = new Set(['source', 'toolchain', 'executor_binding', 'limits', 'platform']);
const SOURCE_KEYS = new Set(['private_root', 'relative_path', 'content_hash', 'byte_size']);
const BINDING_KEYS = new Set([
  'class', 'startup_bound', 'toolchain_id', 'toolchain_version', 'manifest_sha256',
  'ffprobe_path', 'ffprobe_sha256', 'ffprobe_byte_size',
]);
const LIMIT_KEYS = new Set(Object.keys(MEDIA_PROBE_PROCESS_LIMITS));
const SHA256_HEX = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/;
const PLATFORM = new Set(['linux', 'darwin', 'win32']);
const FIXED_ARGV = Object.freeze([
  '-v', 'error',
  '-protocol_whitelist', 'pipe',
  '-show_format', '-show_streams', '-of', 'json',
  '-i', 'pipe:0',
]);

export class MediaProbeProcessPolicyError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'MediaProbeProcessPolicyError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = {}) { throw new MediaProbeProcessPolicyError(code, details); }
function objectLike(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(value, allowed, code, scope) {
  if (!objectLike(value)) fail(code, { scope });
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, { scope, field: key });
}
function sha256(value, field) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) fail('PROCESS_POLICY_SHA256_INVALID', { field });
  return value;
}
function identifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail('PROCESS_POLICY_IDENTIFIER_INVALID', { field });
  return value;
}
function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('PROCESS_POLICY_INTEGER_INVALID', { field });
  return value;
}
function localAbsolutePath(value, field, platform) {
  if (typeof value !== 'string' || value.length < 1 || value.includes('\0')) fail('PROCESS_POLICY_LOCAL_PATH_INVALID', { field });
  const isWindows = platform === 'win32';
  const isAbsolute = isWindows ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
  if (!isAbsolute || /^(?:\\\\|\/\/)/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    fail('PROCESS_POLICY_LOCAL_PATH_INVALID', { field });
  }
  return isWindows ? path.win32.normalize(value) : path.posix.normalize(value);
}
function sourceIdentity(value, platform) {
  onlyKeys(value, SOURCE_KEYS, 'PROCESS_POLICY_SOURCE_INVALID', 'source');
  const privateRoot = localAbsolutePath(value.private_root, 'source.private_root', platform);
  if (typeof value.relative_path !== 'string' || value.relative_path.length < 1 || value.relative_path.includes('\0')) fail('PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  if (path.posix.isAbsolute(value.relative_path) || path.win32.isAbsolute(value.relative_path)
      || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value.relative_path)) fail('PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  const segments = value.relative_path.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) fail('PROCESS_POLICY_SOURCE_RELATIVE_PATH_INVALID');
  return Object.freeze({
    private_root: privateRoot,
    relative_path: segments.join('/'),
    content_hash: sha256(value.content_hash, 'source.content_hash'),
    byte_size: positiveInteger(value.byte_size, 'source.byte_size'),
  });
}
function toolchainIdentity(value) {
  if (!objectLike(value)) fail('PROCESS_POLICY_TOOLCHAIN_INVALID');
  if (value.state !== 'READY' || value.verification_state !== 'ARTIFACT_VERIFIED' || value.execution_state !== 'DISABLED') fail('PROCESS_POLICY_TOOLCHAIN_UNVERIFIED');
  if (value.network_policy !== 'DENY' || value.shell_execution !== 'NOT_USED') fail('PROCESS_POLICY_TOOLCHAIN_BOUNDARY_INVALID');
  if (!objectLike(value.binaries) || !objectLike(value.binaries.ffprobe)) fail('PROCESS_POLICY_FFPROBE_MISSING');
  const ffprobe = value.binaries.ffprobe;
  if (ffprobe.state !== 'VERIFIED') fail('PROCESS_POLICY_FFPROBE_UNVERIFIED');
  const version = identifier(value.toolchain_version, 'toolchain.toolchain_version');
  if (ffprobe.version !== version) fail('PROCESS_POLICY_TOOLCHAIN_VERSION_MISMATCH');
  return Object.freeze({
    toolchain_id: identifier(value.toolchain_id, 'toolchain.toolchain_id'),
    toolchain_version: version,
    manifest_sha256: sha256(value.manifest_sha256, 'toolchain.manifest_sha256'),
    ffprobe_sha256: sha256(ffprobe.sha256, 'toolchain.binaries.ffprobe.sha256'),
    ffprobe_byte_size: positiveInteger(ffprobe.byte_size, 'toolchain.binaries.ffprobe.byte_size', 512 * 1024 * 1024),
  });
}
function executorBindingIdentity(value, toolchain, platform) {
  onlyKeys(value, BINDING_KEYS, 'PROCESS_POLICY_EXECUTOR_BINDING_INVALID', 'executor_binding');
  if (value.class !== MEDIA_PROBE_EXECUTOR_BINDING_CLASS || value.startup_bound !== true) fail('PROCESS_POLICY_EXECUTOR_BINDING_UNTRUSTED');
  const binding = {
    class: value.class,
    startup_bound: true,
    toolchain_id: identifier(value.toolchain_id, 'executor_binding.toolchain_id'),
    toolchain_version: identifier(value.toolchain_version, 'executor_binding.toolchain_version'),
    manifest_sha256: sha256(value.manifest_sha256, 'executor_binding.manifest_sha256'),
    ffprobe_path: localAbsolutePath(value.ffprobe_path, 'executor_binding.ffprobe_path', platform),
    ffprobe_sha256: sha256(value.ffprobe_sha256, 'executor_binding.ffprobe_sha256'),
    ffprobe_byte_size: positiveInteger(value.ffprobe_byte_size, 'executor_binding.ffprobe_byte_size', 512 * 1024 * 1024),
  };
  const base = platform === 'win32' ? path.win32.basename(binding.ffprobe_path) : path.posix.basename(binding.ffprobe_path);
  const expected = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  if (base.toLowerCase() !== expected) fail('PROCESS_POLICY_FFPROBE_NAME_INVALID');
  for (const field of ['toolchain_id', 'toolchain_version', 'manifest_sha256', 'ffprobe_sha256', 'ffprobe_byte_size']) {
    if (binding[field] !== toolchain[field]) fail('PROCESS_POLICY_EXECUTOR_BINDING_MISMATCH', { field });
  }
  return Object.freeze(binding);
}
function limitsIdentity(value = {}) {
  onlyKeys(value, LIMIT_KEYS, 'PROCESS_POLICY_LIMITS_INVALID', 'limits');
  const limits = { ...MEDIA_PROBE_PROCESS_LIMITS, ...value };
  for (const [key, hardMaximum] of Object.entries(MEDIA_PROBE_PROCESS_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > hardMaximum) fail('PROCESS_POLICY_LIMIT_INVALID', { field: key });
  }
  return Object.freeze(limits);
}
function freezePlan(plan) {
  Object.freeze(plan.argv); Object.freeze(plan.environment.allowlist); Object.freeze(plan.environment);
  Object.freeze(plan.io); Object.freeze(plan.process); return Object.freeze(plan);
}

/**
 * Build a private, non-executing ProbeMediaAsset process policy. The public
 * renderer preflight remains path-free; a separate Core-startup private binding
 * supplies the local ffprobe path and must exactly match that redacted evidence.
 */
export function createMediaProbeProcessPolicy(options) {
  onlyKeys(options, OPTION_KEYS, 'PROCESS_POLICY_OPTIONS_INVALID', 'options');
  const platform = options.platform ?? process.platform;
  if (!PLATFORM.has(platform)) fail('PROCESS_POLICY_PLATFORM_UNSUPPORTED');
  const source = sourceIdentity(options.source, platform);
  const toolchain = toolchainIdentity(options.toolchain);
  const executorBinding = executorBindingIdentity(options.executor_binding, toolchain, platform);
  const limits = limitsIdentity(options.limits ?? {});
  const containment = platform === 'win32' ? 'WINDOWS_JOB_OBJECT_REQUIRED' : 'PROCESS_GROUP_REQUIRED';
  return freezePlan({
    policy_version: MEDIA_PROBE_PROCESS_POLICY_VERSION,
    state: 'PLANNED', verification_state: 'UNKNOWN', execution_authorized: false,
    source, toolchain, executor_binding: executorBinding,
    argv: [...FIXED_ARGV],
    environment: { inherit: false, allowlist: platform === 'win32' ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'] : [], locale: 'C' },
    io: { stdin: 'PINNED_SOURCE_FD', stdout: 'BOUNDED_PRIVATE_BYTES', stderr: 'BOUNDED_DIGEST_ONLY' },
    process: { shell: false, network: 'DENY_REQUIRED', containment, descendant_cancellation_required: true },
    limits,
  });
}

export function publicMediaProbeProcessPolicy(plan) {
  if (!objectLike(plan) || plan.policy_version !== MEDIA_PROBE_PROCESS_POLICY_VERSION) fail('PROCESS_POLICY_PLAN_INVALID');
  return Object.freeze({
    policy_version: plan.policy_version, state: plan.state, verification_state: plan.verification_state,
    execution_authorized: false, source_content_hash: plan.source.content_hash, source_byte_size: plan.source.byte_size,
    toolchain_id: plan.toolchain.toolchain_id, toolchain_version: plan.toolchain.toolchain_version,
    manifest_sha256: plan.toolchain.manifest_sha256, ffprobe_sha256: plan.toolchain.ffprobe_sha256,
    argv_profile: 'FFPROBE_JSON_PIPE_V1', shell: false, network: 'DENY_REQUIRED',
    containment: plan.process.containment, limits: plan.limits,
  });
}
