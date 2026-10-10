import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import net from 'node:net';
import { once } from 'node:events';
import { encodeProbeBrokerFrame, readProbeBrokerFrames, validateProbeBrokerRequest, runNativeProbeBroker } from './media-probe-broker.mjs';

const key = crypto.randomBytes(32);
const uuid = () => crypto.randomUUID();
const hash = () => crypto.randomBytes(32).toString('hex');
const consume = async (chunks, secret = key) => { const result = []; for await (const frame of readProbeBrokerFrames(Readable.from(chunks), secret)) result.push(frame.payload); return result; };
function rawFrame(text) {
  const bytes = Buffer.from(text); const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
  const signature = crypto.createHmac('sha256', key).update('CINEFORGE_MEDIA_PROBE_BROKER_FRAME_V1\0').update(bytes).digest();
  return Buffer.concat([header, bytes, signature]);
}
function request() {
  return { scope: { project_id: uuid(), asset_revision_id: uuid(), job_id: uuid(), attempt_id: uuid(), fencing_token: hash() },
    pins: { source_hash: hash(), source_bytes: 10, binary_hash: hash(), manifest_hash: hash(), certificate_hash: hash(), trust_generation: hash(), rights_generation: hash() },
    input: { source_path: 'D:\\private\\nguồn media.bin', binary_path: 'D:\\managed\\ffprobe.exe', attempt_root: 'D:\\private\\new-attempt' },
    budgets: { wall_time_ms: 120000, stdout_limit: 8388608, stderr_limit: 1048576, memory_limit: 536870912 } };
}
test('authenticated frames survive individual-byte fragmentation and combined frames', async () => {
  const messages = [{ type: 'HELLO', sequence: 0, nonce: hash() }, { type: 'OUTPUT', sequence: 1, data: Buffer.alloc(3072, 7).toString('base64') }];
  const bytes = Buffer.concat(messages.map((value) => encodeProbeBrokerFrame(value, key)));
  const fragmented = await consume([...bytes].map((byte) => Buffer.from([byte])));
  assert.ok(fragmented.every((value) => Object.getPrototypeOf(value) === null));
  assert.deepEqual(fragmented.map((value) => ({ ...value })), messages);
  assert.deepEqual((await consume([bytes])).map((value) => ({ ...value })), messages);
});
test('MAC tampering and an unrelated session key cannot decode a frame', async () => {
  const wire = encodeProbeBrokerFrame({ x: 1 }, key); wire[wire.length - 1] ^= 1;
  await assert.rejects(consume([wire]), { code: 'PROBE_BROKER_MAC_REJECTED' });
  await assert.rejects(consume([encodeProbeBrokerFrame({ x: 1 }, key)], crypto.randomBytes(32)), { code: 'PROBE_BROKER_MAC_REJECTED' });
});
test('incomplete headers, bodies and MACs remain truncated', async () => {
  const wire = encodeProbeBrokerFrame({ x: 1 }, key);
  for (const length of [1, 3, 5, wire.length - 1]) await assert.rejects(consume([wire.subarray(0, length)]), { code: 'PROBE_BROKER_FRAME_TRUNCATED' });
});
test('declared frame limit is checked before reading or allocating an attacker body', async () => {
  for (const size of [0, 16385, 0xffffffff]) { const header = Buffer.alloc(4); header.writeUInt32LE(size); await assert.rejects(consume([header]), { code: 'PROBE_BROKER_FRAME_LIMIT' }); }
});
for (const [name, json] of [['duplicate key', '{"x":1,"x":2}'], ['prototype key', '{"__proto__":{}}'],
  ['exponent number', '{"x":1e3}'], ['unsafe integer', '{"x":9007199254740992}'],
  ['depth bomb', '['.repeat(9) + '0' + ']'.repeat(9)], ['string bomb', JSON.stringify({ x: 'x'.repeat(4097) })]]) {
  test(name + ' fails even with a valid MAC', async () => { await assert.rejects(consume([rawFrame(json)]), { code: 'PROBE_BROKER_JSON_INVALID' }); });
}
test('malformed UTF8 fails despite valid authentication', async () => {
  const bytes = Buffer.from([255]); const header = Buffer.alloc(4); header.writeUInt32LE(1);
  const signature = crypto.createHmac('sha256', key).update('CINEFORGE_MEDIA_PROBE_BROKER_FRAME_V1\0').update(bytes).digest();
  await assert.rejects(consume([Buffer.concat([header, bytes, signature])]), { code: 'PROBE_BROKER_JSON_INVALID' });
});
test('valid exact private request accepts tightened budgets without changing pins', () => {
  const input = request(); input.budgets.wall_time_ms = 500; const before = structuredClone(input);
  validateProbeBrokerRequest(input); assert.deepEqual(input, before);
});
for (const [name, change, code] of [
  ['missing job scope', (r) => { delete r.scope.job_id; }, 'PROBE_BROKER_SCHEMA_INVALID'],
  ['latest revision', (r) => { r.scope.asset_revision_id = 'latest'; }, 'PROBE_BROKER_SCOPE_INVALID'],
  ['arbitrary argv', (r) => { r.input.argv = ['--unsafe']; }, 'PROBE_BROKER_SCHEMA_INVALID'],
  ['network path', (r) => { r.input.source_path = '\\\\host\\share\\source'; }, 'PROBE_BROKER_PATH_INVALID'],
  ['bare binary', (r) => { r.input.binary_path = 'ffprobe.exe'; }, 'PROBE_BROKER_PATH_INVALID'],
  ['ADS path', (r) => { r.input.source_path += ':stream'; }, 'PROBE_BROKER_PATH_INVALID'],
  ['NUL hash', (r) => { r.pins.binary_hash = '0'.repeat(63) + '\0'; }, 'PROBE_BROKER_PIN_INVALID'],
  ['unknown credential field', (r) => { r.pins.token = 'secret'; }, 'PROBE_BROKER_SCHEMA_INVALID'],
  ['oversized source', (r) => { r.pins.source_bytes = 1073741825; }, 'PROBE_BROKER_PIN_INVALID'],
  ['wall limit expansion', (r) => { r.budgets.wall_time_ms++; }, 'PROBE_BROKER_POLICY_INVALID'],
  ['stdout expansion', (r) => { r.budgets.stdout_limit++; }, 'PROBE_BROKER_POLICY_INVALID'],
  ['memory expansion', (r) => { r.budgets.memory_limit++; }, 'PROBE_BROKER_POLICY_INVALID'],
]) test(name + ' is rejected before connection', () => { const input = request(); change(input); assert.throws(() => validateProbeBrokerRequest(input), { code }); });

for (const [name, variant, code] of [
  ['authenticated producer output hash mismatch', 'BAD_HASH', 'PROBE_BROKER_OUTPUT_HASH_MISMATCH'],
  ['authenticated producer output budget overflow', 'OVERFLOW', 'PROBE_BROKER_OUTPUT_LIMIT'],
  ['output without process start evidence', 'NO_START', 'PROBE_BROKER_SEQUENCE_INVALID'],
  ['authenticated response sequence replay', 'REPLAY', 'PROBE_BROKER_SESSION_MISMATCH'],
]) test(name, { skip: process.platform !== 'win32' }, async () => {
  // Malicious authenticated fixture producer; no media process or certification.
  const descriptor = { pipe_name: 'CineForge.MediaProbe.' + hash(), broker_process_id: process.pid,
    installation_id: uuid(), library_id: uuid(), core_epoch: uuid(), session_id: uuid(), key };
  let peer; let serverFailure; let task;
  const server = net.createServer((socket) => {
    peer = socket; socket.on('error', () => {});
    task = (async () => {
      const iterator = readProbeBrokerFrames(socket, key);
      const hello = (await iterator.next()).value.payload;
      const common = { ...hello, role: 'SERVER', server_nonce: hash() };
      const send = (value) => socket.write(encodeProbeBrokerFrame(value, key));
      send({ ...common, type: 'CHALLENGE', sequence: 0, broker_process_id: process.pid });
      await iterator.next(); const dispatch = (await iterator.next()).value;
      common.dispatch_hash = crypto.createHash('sha256').update(dispatch.bytes).digest('hex');
      if (variant !== 'NO_START') send({ ...common, type: 'STARTED', sequence: 1, process_id: 123 });
      const bytes = Buffer.from('untrusted');
      send({ ...common, type: 'OUTPUT', sequence: variant === 'REPLAY' ? 1 : variant === 'NO_START' ? 1 : 2,
        channel: 'STDOUT', data: bytes.toString('base64') });
      send({ ...common, type: 'RESULT', sequence: 3, observation: { contract: 'NATIVE_MEDIA_PROBE_V1', code: 'PROBE_PROCESS_STOPPED',
        tree_stopped: true, exit_code: 0, cpu_time_ms: 1, peak_memory_bytes: 1, profile_released: true,
        retained_attempt_root: null, retained_profile: null, phase: 'OBSERVE', native_error: null, failure_type: null,
        app_container_verified: true, stdout_bytes: bytes.length, stderr_bytes: 0,
        stdout_sha256: '0'.repeat(64), stderr_sha256: crypto.createHash('sha256').update('').digest('hex') } });
    })().catch((error) => { serverFailure = error; });
  });
  server.listen('\\\\.\\pipe\\' + descriptor.pipe_name); await once(server, 'listening');
  try {
    const input = request(); if (variant === 'OVERFLOW') input.budgets.stdout_limit = 1;
    await assert.rejects(runNativeProbeBroker({ descriptor, request: input }), { code });
    await task; assert.equal(serverFailure, undefined);
  } finally { peer?.destroy(); await new Promise((resolve) => server.close(resolve)); }
});
