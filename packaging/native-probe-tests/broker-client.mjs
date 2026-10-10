import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { canonicalJson } from '../../core/canonical.mjs';
import { runNativeProbeBroker, encodeProbeBrokerFrame, readProbeBrokerFrames } from '../../core/media-probe-broker.mjs';

// Trusted local test harness, not a product command or authority fixture.
const config = JSON.parse(process.env.CINEFORGE_TEST_BROKER);
delete process.env.CINEFORGE_TEST_BROKER;
const { key_hex, request, mode, ...fields } = config;
const descriptor = { ...fields, key: Buffer.from(mode === 'WRONG_KEY' ? '00'.repeat(32) : key_hex, 'hex') };
let socket;
try {
  if (['GOOD', 'CANCEL', 'DISCONNECT', 'WRONG_KEY', 'WRONG_PID'].includes(mode)) {
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
  const code = error.code?.startsWith('PROBE_') ? error.code : 'PROBE_BROKER_UNAVAILABLE';
  console.log(JSON.stringify({ code, rejected: true }));
} finally { socket?.destroy(); descriptor.key.fill(0); }
