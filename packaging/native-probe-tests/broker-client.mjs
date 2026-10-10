import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { canonicalJson } from '../../core/canonical.mjs';
import { runNativeProbeBroker, encodeProbeBrokerFrame, readProbeBrokerFrames } from '../../core/media-probe-broker.mjs';

// Trusted local test harness, not a product command or authority fixture.
const config = JSON.parse(process.env.CINEFORGE_TEST_BROKER);
delete process.env.CINEFORGE_TEST_BROKER;
const { key_hex, request, mode, guard_test_root, ...fields } = config;
const descriptor = { ...fields, key: Buffer.from(mode === 'WRONG_KEY' ? '00'.repeat(32) : key_hex, 'hex') };
let socket;
try {
  if (mode === 'PIN_BAD_LEASE') {
    socket = net.createConnection({ path: '\\\\.\\pipe\\' + descriptor.pipe_name }); socket.on('error', () => {}); await once(socket, 'connect');
    const iterator = readProbeBrokerFrames(socket, descriptor.key);
    const common = { contract: 'NATIVE_MEDIA_PROBE_BROKER_V1', role: 'CLIENT', installation_id: descriptor.installation_id,
      library_id: descriptor.library_id, core_epoch: descriptor.core_epoch, session_id: descriptor.session_id,
      client_nonce: crypto.randomBytes(32).toString('hex'), server_nonce: '' };
    const send = frame => socket.write(encodeProbeBrokerFrame(frame, descriptor.key));
    send({ ...common, type: 'HELLO', sequence: 0 }); common.server_nonce = (await iterator.next()).value.payload.server_nonce;
    send({ ...common, type: 'AUTH', sequence: 0 });
    const probe = { ...common, type: 'PROBE', sequence: 1, ...request, binding_guard_version: 'MEDIA_PROBE_BINDING_GUARD_V1' };
    const dispatchHash = crypto.createHash('sha256').update(canonicalJson(probe)).digest('hex'); send(probe);
    let guard;
    for (;;) {
      const frame = (await iterator.next()).value.payload;
      if (frame.type === 'BINDING_GUARD') guard = frame;
      if (frame.type === 'RESULT') break;
    }
    if (!guard || guard.core_process_id !== process.pid) throw new Error('PROBE_BINDING_FIXTURE_GUARD_MISSING');
    send({ ...common, type: 'BINDING_DONE', sequence: 2, dispatch_hash: dispatchHash,
      binding_guard_version: 'MEDIA_PROBE_BINDING_GUARD_V1', lease_id: crypto.randomUUID(), outcome: 'COMMITTED' });
    if (!(await iterator.next()).done) throw new Error('PROBE_BINDING_BAD_LEASE_ACCEPTED');
    for (const file of [request.input.source_path, request.input.binary_path]) {
      try { const fd = fs.openSync(file, 'r+'); fs.closeSync(fd); throw new Error('PROBE_BINDING_PIN_NOT_HELD'); }
      catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
    }
    console.log(JSON.stringify({ code: 'PROBE_BINDING_FIXTURE_PASS', invalid_completion_rejected: true, release: false, retained_until_core_exit: true }));
  } else if (mode === 'PIN_CANCEL') {
    const controller = new AbortController(); let called = false;
    const result = await runNativeProbeBroker({ descriptor, request, signal: controller.signal,
      onStarted() { controller.abort(); }, onResult() { called = true; throw new Error('PROBE_BINDING_CANCEL_GRANTED'); } });
    if (called || result.observation.code !== 'PROBE_CANCELLED' || result.binding_guard !== null) throw new Error('PROBE_BINDING_CANCEL_INVALID');
    console.log(JSON.stringify({ code: 'PROBE_BINDING_FIXTURE_PASS', callback: false, release: true, cancelled: true }));
  } else if (mode.startsWith('PIN_')) {
    let called = false;
    const writeDenied = file => {
      try { const fd = fs.openSync(file, 'r+'); fs.closeSync(fd); throw new Error('PROBE_BINDING_PIN_NOT_HELD'); }
      catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
    };
    const sourceMutationDenied = () => {
      // Only the runner-created source sibling of this unique guard directory
      // is eligible for destructive negative attempts. Restore on a bad gate.
      const file = request.input.source_path;
      if (path.resolve(path.dirname(file)) !== path.resolve(path.dirname(guard_test_root))) throw new Error('PROBE_BINDING_FIXTURE_SCOPE_INVALID');
      const bytes = fs.readFileSync(file); const moved = file + '.guard-rename-' + process.pid;
      try { fs.renameSync(file, moved); fs.renameSync(moved, file); throw new Error('PROBE_BINDING_RENAME_NOT_HELD'); }
      catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
      try { fs.unlinkSync(file); fs.writeFileSync(file, bytes); throw new Error('PROBE_BINDING_DELETE_NOT_HELD'); }
      catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
    };
    let result;
    try {
      result = await runNativeProbeBroker({ descriptor, request, onResult: async observed => {
        called = true;
        if (observed.binding_guard.binary_bytes !== fs.statSync(request.input.binary_path).size) throw new Error('PROBE_BINDING_PIN_SIZE_INVALID');
        writeDenied(request.input.source_path); writeDenied(request.input.binary_path);
        sourceMutationDenied();
        if (mode === 'PIN_DISCONNECT' || mode === 'PIN_DEATH') {
          fs.writeFileSync(path.join(guard_test_root, 'guard-ready'), 'READY');
          for (let i = 0; i < 100 && !fs.existsSync(path.join(guard_test_root, 'broker-disposed')); i++) await delay(20);
          if (!fs.existsSync(path.join(guard_test_root, 'broker-disposed'))) throw new Error('PROBE_BINDING_FIXTURE_DEADLINE');
          writeDenied(request.input.source_path); writeDenied(request.input.binary_path);
          sourceMutationDenied();
          if (mode === 'PIN_DEATH') {
            // This PID is the sole test broker parent that supplied this private
            // descriptor. Run only in the isolated death-fixture lane.
            execFileSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/F', '/PID', String(descriptor.broker_process_id)], { windowsHide: true, stdio: 'ignore' });
            writeDenied(request.input.source_path); writeDenied(request.input.binary_path);
            sourceMutationDenied();
            fs.writeFileSync(path.join(guard_test_root, 'broker-death-proof.json'), JSON.stringify({ state: 'PASS',
              scope: 'FIXTURE_CORE_OS_PINS_SURVIVE_BROKER_DEATH', core_process_id: process.pid,
              broker_process_id: descriptor.broker_process_id, source_path: request.input.source_path,
              binary_path: request.input.binary_path, source_write_denied: true, binary_write_denied: true }));
          }
        }
        if (mode === 'PIN_ABORT') throw new Error('fixture callback aborted');
        return { committed: false, value: { guard_callback: true } };
      } });
    } catch (error) { if (mode !== 'PIN_ABORT' || error.code !== 'PROBE_BROKER_UNAVAILABLE') throw error; }
    if (!called) throw new Error('PROBE_BINDING_CALLBACK_MISSING');
    if (mode === 'PIN_DISCONNECT' || mode === 'PIN_DEATH') {
      if (result.binding_released !== false) throw new Error('PROBE_BINDING_RELEASE_FABRICATED');
      writeDenied(request.input.source_path); writeDenied(request.input.binary_path);
    } else {
      if (mode === 'PIN_GOOD' && result.binding_released !== true) throw new Error('PROBE_BINDING_RELEASE_MISSING');
      for (const file of [request.input.source_path, request.input.binary_path]) { const fd = fs.openSync(file, 'r+'); fs.closeSync(fd); }
    }
    if (mode !== 'PIN_DEATH') console.log(JSON.stringify({ code: 'PROBE_BINDING_FIXTURE_PASS', callback: true,
      release: mode !== 'PIN_DISCONNECT', retained_until_core_exit: mode === 'PIN_DISCONNECT' }));
  } else if (mode.startsWith('CORE_')) {
    const { exerciseCoreDispatch } = await import('./core-dispatch-client.mjs');
    console.log(JSON.stringify(await exerciseCoreDispatch(descriptor, config)));
  } else if (['GOOD', 'CANCEL', 'DISCONNECT', 'WRONG_KEY', 'WRONG_PID'].includes(mode)) {
    const controller = new AbortController();
    const result = await runNativeProbeBroker({ descriptor, request, signal: controller.signal, onStarted() {
      if (mode === 'CANCEL') controller.abort();
      if (mode === 'DISCONNECT') { console.log(JSON.stringify({ disconnected_at_started: true })); process.exit(0); }
    } });
    if (mode === 'GOOD' && result.stdout.toString() !== '{"private_input_read":true}') throw new Error('PROBE_FIXTURE_OUTPUT_INVALID');
    console.log(JSON.stringify({ code: result.observation.code, tree_stopped: result.observation.tree_stopped }));
  } else {
    socket = net.createConnection({ path: '\\\\.\\pipe\\' + descriptor.pipe_name }); socket.on('error', () => {}); await once(socket, 'connect');
    const iterator = readProbeBrokerFrames(socket, descriptor.key);
    const common = { contract: 'NATIVE_MEDIA_PROBE_BROKER_V1', role: 'CLIENT', installation_id: descriptor.installation_id,
      library_id: descriptor.library_id, core_epoch: descriptor.core_epoch, session_id: descriptor.session_id,
      client_nonce: crypto.randomBytes(32).toString('hex'), server_nonce: '' };
    socket.write(encodeProbeBrokerFrame({ ...common, type: 'HELLO', sequence: 0 }, descriptor.key));
    const challenge = await iterator.next(); common.server_nonce = challenge.value.payload.server_nonce;
    socket.write(encodeProbeBrokerFrame({ ...common, type: 'AUTH', sequence: 0,
      ...(mode === 'STALE_SESSION' ? { session_id: crypto.randomUUID() } : {}) }, descriptor.key));
    if (mode === 'BAD_LENGTH') { const header = Buffer.alloc(4); header.writeUInt32LE(16385); socket.write(header); }
    else if (mode !== 'STALE_SESSION') {
      const probe = { ...common, type: 'PROBE', sequence: 1, ...request };
      socket.write(encodeProbeBrokerFrame(probe, descriptor.key));
      const started = await iterator.next(); if (started.value.payload.type !== 'STARTED') throw new Error('PROBE_FIXTURE_NOT_STARTED');
      socket.write(encodeProbeBrokerFrame(mode === 'REPLAY' ? probe
        : { ...common, type: 'CANCEL', sequence: 2, dispatch_hash: '0'.repeat(64) }, descriptor.key));
    }
    const stopped = await iterator.next(); if (!stopped.done) throw new Error('PROBE_FIXTURE_UNSAFE_REPLY');
    console.log(JSON.stringify({ rejected: true }));
  }
} catch (error) {
  if (mode.startsWith('CORE_') || mode.startsWith('PIN_')) { console.error(error); process.exitCode = 1; }
  const code = error.code?.startsWith('PROBE_') ? error.code : 'PROBE_BROKER_UNAVAILABLE';
  console.log(JSON.stringify({ code, rejected: true }));
} finally { socket?.destroy(); descriptor.key.fill(0); }
