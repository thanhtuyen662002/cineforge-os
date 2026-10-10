import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { canonicalJson } from './canonical.mjs';
import { decodeBoundedMediaProbeJson } from './media-probe.mjs';

// PREPARED private transport. No public Core command or HTTP activation.
export const MEDIA_PROBE_BROKER_VERSION = 'NATIVE_MEDIA_PROBE_BROKER_V1';
const DOMAIN = Buffer.from('CINEFORGE_MEDIA_PROBE_BROKER_FRAME_V1\0');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const COMMON = ['contract', 'role', 'type', 'sequence', 'installation_id', 'library_id', 'core_epoch', 'session_id', 'client_nonce', 'server_nonce'];
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const mac = (bytes, key) => crypto.createHmac('sha256', key).update(DOMAIN).update(bytes).digest();
class BrokerError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new BrokerError(code); };
function exact(object, fields) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).length !== fields.length
    || !Object.keys(object).every((key) => fields.includes(key))) fail('PROBE_BROKER_SCHEMA_INVALID');
}
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
function decode(bytes) {
  try { return decodeBoundedMediaProbeJson(bytes, { maxBytes: 16384, maxDepth: 8, maxNodes: 256 }); }
  catch { fail('PROBE_BROKER_JSON_INVALID'); }
}
export function encodeProbeBrokerFrame(payload, key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) fail('PROBE_BROKER_KEY_INVALID');
  const bytes = Buffer.from(canonicalJson(payload)); decode(bytes);
  const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes, mac(bytes, key)]);
}
export async function* readProbeBrokerFrames(stream, key) {
  let header = Buffer.alloc(4); let headerOffset = 0; let body = null; let offset = 0; let count = 0;
  for await (const chunk of stream) {
    let position = 0;
    while (position < chunk.length) {
      if (!body) {
        const n = Math.min(4 - headerOffset, chunk.length - position);
        chunk.copy(header, headerOffset, position, position + n); headerOffset += n; position += n;
        if (headerOffset !== 4) continue;
        const size = header.readUInt32LE();
        if (size < 1 || size > 16384) fail('PROBE_BROKER_FRAME_LIMIT');
        body = Buffer.alloc(size + 32); offset = 0;
      }
      const n = Math.min(body.length - offset, chunk.length - position);
      chunk.copy(body, offset, position, position + n); offset += n; position += n;
      if (offset !== body.length) continue;
      if (++count > 4100) fail('PROBE_BROKER_FRAME_COUNT_LIMIT');
      const bytes = body.subarray(0, body.length - 32);
      if (!crypto.timingSafeEqual(mac(bytes, key), body.subarray(body.length - 32))) fail('PROBE_BROKER_MAC_REJECTED');
      const payload = decode(bytes);
      body = null; headerOffset = 0;
      yield { payload, bytes };
    }
  }
  if (body || headerOffset) fail('PROBE_BROKER_FRAME_TRUNCATED');
}
export function validateProbeBrokerRequest(request) {
  exact(request.scope, ['project_id', 'asset_revision_id', 'job_id', 'attempt_id', 'fencing_token']);
  for (const key of ['project_id', 'asset_revision_id', 'job_id', 'attempt_id']) if (!matches(UUID, request.scope[key])) fail('PROBE_BROKER_SCOPE_INVALID');
  if (!matches(HASH, request.scope.fencing_token)) fail('PROBE_BROKER_SCOPE_INVALID');
  exact(request.pins, ['source_hash', 'source_bytes', 'binary_hash', 'manifest_hash', 'certificate_hash', 'trust_generation', 'rights_generation']);
  for (const [key, value] of Object.entries(request.pins)) if (key === 'source_bytes'
    ? !integer(value, 1, 1073741824) : !matches(HASH, value)) fail('PROBE_BROKER_PIN_INVALID');
  exact(request.input, ['source_path', 'binary_path', 'attempt_root']);
  for (const value of Object.values(request.input)) {
    if (typeof value !== 'string' || !/^[A-Za-z]:[\\/]/.test(value) || /[\x00-\x1f]/.test(value)
      || value.slice(2).includes(':') || Buffer.byteLength(value) > 4096) fail('PROBE_BROKER_PATH_INVALID');
  }
  exact(request.budgets, ['wall_time_ms', 'stdout_limit', 'stderr_limit', 'memory_limit']);
  for (const [key, min, max] of [['wall_time_ms', 1, 120000], ['stdout_limit', 1, 8388608],
    ['stderr_limit', 1, 1048576], ['memory_limit', 1048576, 536870912]]) {
    if (!integer(request.budgets[key], min, max)) fail('PROBE_BROKER_POLICY_INVALID');
  }
}
function observation(value) {
  exact(value, ['contract', 'code', 'tree_stopped', 'exit_code', 'cpu_time_ms', 'peak_memory_bytes', 'profile_released',
    'retained_attempt_root', 'retained_profile', 'phase', 'native_error', 'failure_type', 'app_container_verified',
    'stdout_bytes', 'stderr_bytes', 'stdout_sha256', 'stderr_sha256']);
  if (value.contract !== 'NATIVE_MEDIA_PROBE_V1' || !matches(/^PROBE_[A-Z0-9_]{1,64}$/, value.code)
    || !['tree_stopped', 'profile_released', 'app_container_verified'].every((k) => typeof value[k] === 'boolean')
    || !['cpu_time_ms', 'peak_memory_bytes', 'stdout_bytes', 'stderr_bytes'].every((k) => integer(value[k], 0, Number.MAX_SAFE_INTEGER))
    || !['stdout_sha256', 'stderr_sha256'].every((k) => matches(HASH, value[k]))
    || (value.exit_code !== null && (!integer(value.exit_code, 0, 4294967295) || value.exit_code === 259))
    || (value.native_error !== null && !integer(value.native_error, -2147483648, 2147483647))
    || !matches(/^[A-Z_]{1,64}$/, value.phase)
    || (value.failure_type !== null && !matches(/^[A-Za-z0-9_]{1,64}$/, value.failure_type))
    || !['retained_attempt_root', 'retained_profile'].every((k) => value[k] === null || (typeof value[k] === 'string' && Buffer.byteLength(value[k]) <= 4096))) {
    fail('PROBE_BROKER_OBSERVATION_INVALID');
  }
}

/** Called only by the reviewed Core dispatcher, never by an HTTP/UI action. */
export function validateProbeBrokerDescriptor(descriptor) {
  exact(descriptor, ['pipe_name', 'broker_process_id', 'installation_id', 'library_id', 'core_epoch', 'session_id', 'key']);
  if (!matches(/^CineForge\.MediaProbe\.[0-9a-f]{64}$/, descriptor.pipe_name)
    || !integer(descriptor.broker_process_id, 1, 4294967295)
    || !(descriptor.key instanceof Uint8Array) || descriptor.key.byteLength !== 32
    || !['installation_id', 'library_id', 'core_epoch', 'session_id'].every(field => matches(UUID, descriptor[field]))) {
    fail('PROBE_BROKER_DESCRIPTOR_INVALID');
  }
}

export async function runNativeProbeBroker({ descriptor, request, signal, onStarted, onResult } = {}) {
  let socket; let timer; let key;
  let cancel;
  try {
    if (process.platform !== 'win32') fail('PROBE_BROKER_PLATFORM_UNSUPPORTED');
    if (signal?.aborted) fail('PROBE_BROKER_CANCELLED_BEFORE_CONNECT');
    if (onResult !== undefined && typeof onResult !== 'function') fail('PROBE_BINDING_CALLBACK_INVALID');
    validateProbeBrokerDescriptor(descriptor);
    key = Buffer.from(descriptor.key);
    const common = { contract: MEDIA_PROBE_BROKER_VERSION, installation_id: descriptor.installation_id,
      library_id: descriptor.library_id, core_epoch: descriptor.core_epoch, session_id: descriptor.session_id,
      client_nonce: crypto.randomBytes(32).toString('hex'), server_nonce: '' };
    for (const field of ['installation_id', 'library_id', 'core_epoch', 'session_id']) if (!matches(UUID, common[field])) fail('PROBE_BROKER_DESCRIPTOR_INVALID');
    exact(request, ['scope', 'pins', 'input', 'budgets']); validateProbeBrokerRequest(request);
    socket = net.createConnection({ path: '\\\\.\\pipe\\' + descriptor.pipe_name });
    socket.on('error', () => {});
    timer = setTimeout(() => socket.destroy(new BrokerError('PROBE_BROKER_DEADLINE')), 150000); timer.unref();
    await once(socket, 'connect');
    const reader = readProbeBrokerFrames(socket, key);
    const send = (type, sequence, extra = {}) => socket.write(encodeProbeBrokerFrame({ ...common, role: 'CLIENT', type, sequence, ...extra }, key));
    const receive = async (type, sequence, extra) => {
      const next = await reader.next(); if (next.done) fail('PROBE_BROKER_DISCONNECTED');
      const frame = next.value.payload; exact(frame, [...COMMON, ...extra]);
      if (frame.role !== 'SERVER' || frame.type !== type || frame.sequence !== sequence
        || Object.entries(common).some(([k, v]) => k !== 'server_nonce' && frame[k] !== v)) fail('PROBE_BROKER_SESSION_MISMATCH');
      return frame;
    };
    send('HELLO', 0);
    const challenge = await receive('CHALLENGE', 0, ['broker_process_id']);
    if (!matches(HASH, challenge.server_nonce) || challenge.broker_process_id !== descriptor.broker_process_id) fail('PROBE_BROKER_SERVER_MISMATCH');
    common.server_nonce = challenge.server_nonce; send('AUTH', 0);
    if (signal?.aborted) fail('PROBE_BROKER_CANCELLED_BEFORE_DISPATCH');
    const guardVersion = 'MEDIA_PROBE_BINDING_GUARD_V1';
    const probe = { ...common, role: 'CLIENT', type: 'PROBE', sequence: 1, ...request,
      ...(onResult ? { binding_guard_version: guardVersion } : {}) };
    const dispatchHash = digest(Buffer.from(canonicalJson(probe))); socket.write(encodeProbeBrokerFrame(probe, key));
    let guard = null;
    // After guard transfer, callback completion/rollback releases the OS pins.
    // Cancellation must not race a release against a still-running callback.
    cancel = () => { if (!guard && !socket.destroyed) send('CANCEL', 2, { dispatch_hash: dispatchHash }); };
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    let sequence = 0; let started = false;
    const chunks = { STDOUT: [], STDERR: [] }; const sizes = { STDOUT: 0, STDERR: 0 };
    const hashes = { STDOUT: crypto.createHash('sha256'), STDERR: crypto.createHash('sha256') };
    for await (const { payload: frame } of reader) {
      if (++sequence > 4096 || frame.sequence !== sequence || frame.role !== 'SERVER'
        || Object.entries(common).some(([k, v]) => frame[k] !== v) || frame.dispatch_hash !== dispatchHash) fail('PROBE_BROKER_SESSION_MISMATCH');
      if (frame.type === 'STARTED') {
        exact(frame, [...COMMON, 'dispatch_hash', 'process_id']);
        if (started || !integer(frame.process_id, 1, 4294967295)) fail('PROBE_BROKER_SEQUENCE_INVALID');
        started = true; onStarted?.(frame.process_id);
      } else if (frame.type === 'OUTPUT') {
        exact(frame, [...COMMON, 'dispatch_hash', 'channel', 'data']);
        if (!started) fail('PROBE_BROKER_SEQUENCE_INVALID');
        if (!Object.hasOwn(chunks, frame.channel) || typeof frame.data !== 'string' || frame.data.length < 1 || frame.data.length > 4096) fail('PROBE_BROKER_OUTPUT_INVALID');
        const bytes = Buffer.from(frame.data, 'base64');
        if (bytes.toString('base64') !== frame.data || bytes.length > 3072) fail('PROBE_BROKER_OUTPUT_INVALID');
        sizes[frame.channel] += bytes.length;
        if (sizes[frame.channel] > request.budgets[frame.channel === 'STDOUT' ? 'stdout_limit' : 'stderr_limit']) fail('PROBE_BROKER_OUTPUT_LIMIT');
        chunks[frame.channel].push(bytes); hashes[frame.channel].update(bytes);
      } else if (frame.type === 'BINDING_GUARD') {
        exact(frame, [...COMMON, 'dispatch_hash', 'binding_guard_version', 'lease_id', 'core_process_id',
          'source_hash', 'source_bytes', 'binary_hash', 'binary_bytes']);
        if (!onResult || !started || guard || frame.binding_guard_version !== guardVersion || !matches(UUID, frame.lease_id)
          || frame.core_process_id !== process.pid || frame.source_hash !== request.pins.source_hash
          || frame.source_bytes !== request.pins.source_bytes || frame.binary_hash !== request.pins.binary_hash
          || !integer(frame.binary_bytes, 1, 536870912)) fail('PROBE_BINDING_GUARD_REJECTED');
        guard = Object.freeze(frame);
      } else if (frame.type === 'RESULT') {
        exact(frame, [...COMMON, 'dispatch_hash', 'observation']); observation(frame.observation);
        const result = frame.observation;
        if ((!started && (result.exit_code !== null || result.code === 'PROBE_PROCESS_STOPPED'
          || result.stdout_bytes !== 0 || result.stderr_bytes !== 0)) || (started && !result.app_container_verified)) fail('PROBE_BROKER_SEQUENCE_INVALID');
        for (const channel of ['STDOUT', 'STDERR']) {
          if (result[channel.toLowerCase() + '_bytes'] !== sizes[channel]
            || result[channel.toLowerCase() + '_sha256'] !== hashes[channel].digest('hex')) fail('PROBE_BROKER_OUTPUT_HASH_MISMATCH');
        }
        const observed = Object.freeze({ dispatch_hash: dispatchHash, observation: Object.freeze(result),
          stdout: Buffer.concat(chunks.STDOUT, sizes.STDOUT), stderr: Buffer.concat(chunks.STDERR, sizes.STDERR) });
        if (!onResult) return observed;
        const clean = started && result.code === 'PROBE_PROCESS_STOPPED' && result.tree_stopped
          && result.exit_code === 0 && result.app_container_verified && result.profile_released;
        if (!clean) {
          if (guard) fail('PROBE_BINDING_GUARD_REJECTED');
          return Object.freeze({ ...observed, binding_guard: null, binding_result: null, binding_released: true });
        }
        if (!guard) fail('PROBE_BINDING_GUARD_REQUIRED');
        let callback; let callbackError;
        try {
          if (signal?.aborted) fail('PROBE_BINDING_CANCELLED');
          callback = await onResult(Object.freeze({ ...observed, binding_guard: guard }));
          exact(callback, ['committed', 'value']);
          if (typeof callback.committed !== 'boolean') fail('PROBE_BINDING_CALLBACK_INVALID');
        } catch (error) { callbackError = error; }
        let released = false;
        try {
          send('BINDING_DONE', 2, { dispatch_hash: dispatchHash, binding_guard_version: guardVersion,
            lease_id: guard.lease_id, outcome: !callbackError && callback.committed ? 'COMMITTED' : 'ABORTED' });
          const ack = await reader.next();
          if (!ack.done) {
            const frame = ack.value.payload;
            exact(frame, [...COMMON, 'dispatch_hash', 'binding_guard_version', 'lease_id']);
            released = frame.type === 'BINDING_RELEASED' && frame.role === 'SERVER' && frame.sequence === sequence + 1
              && frame.dispatch_hash === dispatchHash && frame.binding_guard_version === guardVersion && frame.lease_id === guard.lease_id
              && Object.entries(common).every(([k, v]) => frame[k] === v);
          }
        } catch { /* Core owns unresolved pins until its process exits. */ }
        if (callbackError) throw callbackError;
        return Object.freeze({ ...observed, binding_guard: guard, binding_result: callback.value, binding_released: released });
      } else fail('PROBE_BROKER_SEQUENCE_INVALID');
    }
    fail('PROBE_BROKER_DISCONNECTED');
  } catch (error) {
    throw error instanceof BrokerError ? error : new BrokerError('PROBE_BROKER_UNAVAILABLE');
  } finally {
    if (cancel) signal?.removeEventListener('abort', cancel);
    clearTimeout(timer); socket?.destroy(); key?.fill(0);
  }
}
