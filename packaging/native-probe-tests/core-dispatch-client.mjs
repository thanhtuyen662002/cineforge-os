import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CoreService } from '../../core/core.mjs';
import { canonicalJson } from '../../core/canonical.mjs';
import { preflightRendererToolchain } from '../../core/renderer-toolchain.mjs';

// Privileged local fixture only. The fake executable and ephemeral signer do
// do not certify ffprobe, trusted time or public admission. The WAV case
// proves the private Core writer against actual OS pins and fixture output.
export async function exerciseCoreDispatch(descriptor, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-core-native-fixture-'));
  const toolRoot = path.join(root, 'pack'); fs.mkdirSync(toolRoot);
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = { manifest_type: 'CINEFORGE_RENDERER_TOOLCHAIN', manifest_schema_version: 1,
    toolchain_id: 'core-native-fixture', toolchain_version: '1.0.0', network: false, binaries: {} };
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binaryPath = path.join(toolRoot, name + '.exe');
    if (name === 'ffprobe') fs.copyFileSync(config.request.input.binary_path, binaryPath);
    else fs.writeFileSync(binaryPath, 'INERT UNUSED FFMPEG FIXTURE');
    const bytes = fs.readFileSync(binaryPath);
    manifest.binaries[name] = { path: binaryPath, sha256: digest(bytes), size: bytes.length, version: '1.0.0' };
  }
  const manifestPath = path.join(toolRoot, 'renderer-toolchain.json');
  fs.writeFileSync(manifestPath, canonicalJson(manifest));
  const artifact = preflightRendererToolchain({ root: toolRoot, manifestPath, allowObjectManifest: false });
  assert.equal(artifact.state, 'READY');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }); const now = Date.now();
  const statement = { capability: 'PROBE_MEDIA_ASSET_V1', platform: 'win32-x64', toolchain_id: manifest.toolchain_id,
    toolchain_version: '1.0.0', manifest_sha256: artifact.manifest_sha256, ffprobe_sha256: manifest.binaries.ffprobe.sha256,
    ffprobe_byte_size: manifest.binaries.ffprobe.size, ffprobe_version: '1.0.0', probe_schema_version: 'MEDIA_PROBE_V1',
    parser_policy_version: 'MEDIA_PROBE_PARSER_V1', native_contract: 'NATIVE_MEDIA_PROBE_V1', argv_profile_version: 'MEDIA_PROBE_ARGV_V1',
    sandbox_profile_version: 'WINDOWS_APPCONTAINER_PROBE_V1', resource_profile_version: 'MEDIA_PROBE_RESOURCE_V1',
    certification_epoch: 1, license_snapshot_sha256: digest('fixture license'), runtime_evidence_sha256: digest('fixture runtime'),
    not_before_utc_ms: now - 10000, expires_at_utc_ms: now + 300000 };
  const envelopeBytes = Buffer.from(canonicalJson({ envelope_version: 'MEDIA_PROBE_ATTESTATION_V1', statement,
    signature: { algorithm: 'ED25519', key_id: 'fixture-key', signature_hex: crypto.sign(null,
      Buffer.from('CINEFORGE_MEDIA_PROBE_ATTESTATION_V1\0' + canonicalJson(statement)), privateKey).toString('hex') } }));
  const trustPolicyBytes = Buffer.from(canonicalJson({ policy_version: 'MEDIA_PROBE_TRUST_V1', policy_epoch: 1,
    not_before_utc_ms: now - 10000, expires_at_utc_ms: now + 300000,
    keys: [{ key_id: 'fixture-key', purpose: 'PROBE_MEDIA_ASSET_V1', public_key_spki_base64: spki.toString('base64'),
      public_key_spki_sha256: digest(spki), state: 'ACTIVE', toolchain_ids: [manifest.toolchain_id], minimum_pack_epoch: 1,
      not_before_utc_ms: now - 10000, expires_at_utc_ms: now + 300000 }], revoked_pack_hashes: [] }));
  let core; let rightsId; let loads = 0; let revokeAfterResult = false; let closeTimer;
  const options = { dbPath: path.join(root, 'core.sqlite'), assetStorePath: path.join(root, 'assets'),
    instanceEpoch: descriptor.core_epoch, rendererToolchainRoot: toolRoot, rendererToolchainManifest: manifestPath,
    mediaProbeBrokerSource: () => descriptor, mediaProbeTrustSource: () => {
      loads++;
      if (revokeAfterResult && loads === 6) execute('RevokeRights', { rights_identity_id: rightsId, right_type: 'SOURCE_USE', reason: 'fixture revoked before binding' });
      if (config.mode === 'CORE_STALE' && loads === 6) core.db.prepare('UPDATE media_probe_jobs SET row_version=row_version+1').run();
      return { envelopeBytes, trustPolicyBytes, trustContext: { nowUtcMs: config.mode === 'CORE_BIND_EXPIRED' && loads >= 10 ? now + 300000 : Date.now(), minimumPolicyEpoch: 1,
        policySha256: digest(trustPolicyBytes), timeHealth: 'TRUSTED', trustFreshness: 'FRESH' } };
    } };
  const execute = (command_type, payload) => {
    const response = core.handle({ api_version: '1', request_id: crypto.randomUUID(), method: 'command.execute',
      params: { command_type, payload, idempotency_key: crypto.randomUUID() } });
    assert.equal(response.ok, true, JSON.stringify(response.error)); return response.result;
  };
  const insert = (table, row) => {
    const fields = Object.keys(row); core.db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(row));
  };
  try {
    core = new CoreService(options);
    if (config.mode === 'CORE_BIND_RIGHTS') {
      const transact = core._transaction.bind(core); let revoked = false;
      core._transaction = fn => {
        const result = transact(fn);
        // An audited user command between the committed VERIFYING phase and
        // the canonical binding transaction, never a nested writer transaction.
        if (!revoked && result?.cursor?.jobState === 'VERIFYING') {
          revoked = true; execute('RevokeRights', { rights_identity_id: rightsId, right_type: 'SOURCE_USE', reason: 'fixture revoked before canonical commit' });
        }
        return result;
      };
    }
    if (config.mode === 'CORE_BIND_DISCONNECT') {
      const writeAudit = core._insertAudit.bind(core);
      core._insertAudit = (...args) => {
        const result = writeAudit(...args);
        if (args[0].actionType === 'media_probe.bind_evidence') {
          fs.writeFileSync(path.join(config.guard_test_root, 'guard-ready'), 'OWNED_CORE_BIND_TRANSACTION');
          const until = Date.now() + 10000;
          while (!fs.existsSync(path.join(config.guard_test_root, 'broker-disposed'))) {
            if (Date.now() >= until) throw new Error('FIXTURE_BROKER_DISPOSE_TIMEOUT');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
          for (const pinned of [managedSourceForAudit(), manifest.binaries.ffprobe.path]) {
            assert.throws(() => { const fd = fs.openSync(pinned, 'r+'); fs.closeSync(fd); }, e => ['EBUSY','EACCES','EPERM'].includes(e.code));
          }
        }
        return result;
      };
    }
    const managedSourceForAudit = () => path.join(options.assetStorePath, core.db.prepare(`SELECT l.relative_path FROM media_probe_jobs j JOIN storage_object_locations l ON l.id=j.storage_object_location_id LIMIT 1`).get().relative_path);
    const project = execute('CreateProject', { code: 'native-fixture', title: 'Kiểm thử runtime' });
    const sourcePath = path.join(root, 'source.txt');
    let source = Buffer.from(config.mode === 'CORE_CLOSE' ? 'HANG\n' : 'GOOD\n');
    if (config.mode.startsWith('CORE_BIND_') || config.mode === 'CORE_SIZE_CONFLICT') {
      source = Buffer.alloc(76); source.write('RIFF', 0); source.writeUInt32LE(config.mode === 'CORE_SIZE_CONFLICT' ? 69 : 68, 4);
      source.write('WAVEfmt ', 8); source.writeUInt32LE(16, 16); source.writeUInt16LE(1, 20); source.writeUInt16LE(1, 22);
      source.writeUInt32LE(8000, 24); source.writeUInt32LE(16000, 28); source.writeUInt16LE(2, 32); source.writeUInt16LE(16, 34);
      source.write('data', 36); source.writeUInt32LE(32, 40);
    }
    fs.writeFileSync(sourcePath, source);
    const asset = execute('ImportAsset', { project_id: project.id, source_path: sourcePath, asset_type: 'AUDIO', content_hash: digest(source) }).asset;
    rightsId = core.db.prepare('SELECT rights_identity_id FROM assets WHERE id=?').get(asset.id).rights_identity_id;
    execute('CreateRightsRecord', { rights_identity_id: rightsId, right_type: 'SOURCE_USE', status: 'ALLOWED', purpose: { allowed: ['MEDIA_INSPECTION'] } });
    execute('RecordConsent', { rights_identity_id: rightsId, consent_type: 'SOURCE_USE', granted_by: 'fixture-owner' });
    const revision = asset.latest_revision;
    const location = core.db.prepare('SELECT l.id FROM storage_object_locations l JOIN asset_revisions r ON r.storage_object_id=l.storage_object_id WHERE r.id=?').get(revision.id);
    const original = core.db.prepare("SELECT * FROM commands WHERE command_type='ImportAsset'").get();
    const originalId = crypto.randomUUID();
    insert('commands', { ...original, id: originalId, command_type: 'ProbeMediaAsset', status: 'EXECUTING',
      idempotency_key: crypto.randomUUID(), payload_json: JSON.stringify({ asset_revision_id: revision.id }) });
    const jobId = crypto.randomUUID(); const stamp = Date.now() * 1000;
    insert('media_probe_jobs', { id: jobId, project_id: project.id, asset_revision_id: revision.id, storage_object_location_id: location.id,
      command_id: originalId, source_content_hash: digest(source), source_byte_size: source.length, toolchain_manifest_hash: artifact.manifest_sha256,
      toolchain_id: manifest.toolchain_id, toolchain_version: '1.0.0', toolchain_binary_hash: manifest.binaries.ffprobe.sha256,
      probe_schema_version: 'MEDIA_PROBE_V1', parser_policy_version: 'MEDIA_PROBE_PARSER_V1', rights_generation: core._mediaProbeRights(asset.id).generation,
      canonical_request_hash: digest('privileged queued fixture'), idempotency_key: crypto.randomUUID(), correlation_id: crypto.randomUUID(),
      state: 'QUEUED', next_step: 'Fixture', created_at_utc_us: stamp, updated_at_utc_us: stamp });
    const reservation = core.prepareMediaProbeAttempt({ project_id: project.id, job_id: jobId, expected_version: 1, idempotency_key: 'reserve-fixture' });
    const request = { project_id: project.id, job_id: jobId, attempt_id: reservation.attempt_id, expected_version: reservation.job_version, idempotency_key: 'dispatch-fixture' };
    const managedSource = path.join(options.assetStorePath, core._objectRelativePath('SHA-256', digest(source)));
    if (config.mode === 'CORE_SOURCE_SWAP') fs.writeFileSync(managedSource, Buffer.alloc(source.length, 120));
    revokeAfterResult = config.mode === 'CORE_RIGHTS';
    if (config.mode === 'CORE_AUDIT') core.db.exec("CREATE TRIGGER fixture_start_audit BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.dispatch_executing' BEGIN SELECT RAISE(ABORT,'fixture started audit failure'); END;");
    if (config.mode === 'CORE_TERMINAL_AUDIT') core.db.exec("CREATE TRIGGER fixture_terminal_audit BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.dispatch_unknown' BEGIN SELECT RAISE(ABORT,'fixture terminal audit failure'); END;");
    if (['CORE_TERMINAL_AUDIT', 'CORE_BIND_AUDIT'].includes(config.mode)) core.db.exec("CREATE TRIGGER fixture_bind_audit BEFORE INSERT ON audit_records WHEN NEW.action_type='media_probe.bind_evidence' BEGIN SELECT RAISE(ABORT,'fixture bind audit failure'); END;");
    const pending = core.dispatchMediaProbeAttempt(request);
    // The method must journal before it can yield or send through the pipe.
    assert.equal(core.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(request.attempt_id).state, 'DISPATCHING');
    await assert.rejects(core.dispatchMediaProbeAttempt(request), { code: 'PROBE_DISPATCH_BUSY' });
    if (config.mode === 'CORE_CLOSE') closeTimer = setInterval(() => {
      if (core.db?.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(request.attempt_id).state === 'EXECUTING') {
        clearInterval(closeTimer); core.close();
      }
    }, 10);
    let receipt;
    if (['CORE_CLOSE', 'CORE_STALE', 'CORE_TERMINAL_AUDIT'].includes(config.mode)) {
      if (config.mode === 'CORE_CLOSE') await assert.rejects(pending, { code: 'PROBE_CORE_CLOSED' });
      else {
        if (config.mode === 'CORE_STALE') await assert.rejects(pending, { code: 'PROBE_DISPATCH_STALE' });
        else await assert.rejects(pending, /fixture terminal audit failure/);
        assert.equal(core.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(request.attempt_id).state, config.mode === 'CORE_TERMINAL_AUDIT' ? 'VERIFYING' : 'EXECUTING');
        assert.equal(core.db.prepare('SELECT state FROM media_probe_jobs WHERE id=?').get(jobId).state, config.mode === 'CORE_TERMINAL_AUDIT' ? 'VERIFYING' : 'RUNNING');
        assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE action_type='media_probe.dispatch_unknown'").get().n, 0);
        core.close();
      }
      core = new CoreService({ ...options, instanceEpoch: crypto.randomUUID(), mediaProbeBrokerSource: null });
    } else receipt = await pending;
    const job = core.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(jobId);
    const attempt = core.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(request.attempt_id);
    const disconnected = config.mode === 'CORE_BIND_DISCONNECT';
    const bound = config.mode === 'CORE_BIND_AUDIO' || disconnected;
    assert.equal(job.state, bound ? 'COMPLETED' : 'UNKNOWN'); assert.equal(job.needs_user, Number(!bound || disconnected));
    assert.equal(job.current_attempt_id, bound ? attempt.id : null); assert.equal(job.fencing_token, bound ? attempt.fencing_token : null);
    assert.equal(attempt.state, bound ? 'SUCCEEDED' : 'ABANDONED');
    const metadataCount = core.db.prepare('SELECT COUNT(*) AS n FROM technical_metadata').get().n;
    assert.equal(metadataCount, Number(bound));
    const hasEvidence = bound || ['CORE_GOOD', 'CORE_SIZE_CONFLICT'].includes(config.mode);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM media_probe_evidence').get().n, Number(hasEvidence));
    if (hasEvidence) {
      const evidence = core.db.prepare('SELECT * FROM media_probe_evidence').get();
      assert.equal(evidence.outcome, bound ? 'PASS' : config.mode === 'CORE_SIZE_CONFLICT' ? 'CONFLICT' : 'UNKNOWN');
      assert.equal(receipt.binding_pin_state, disconnected ? 'UNKNOWN' : 'RELEASED'); assert.equal(receipt.evidence_id, evidence.id);
    }
    if (bound) {
      const measurement = core.db.prepare('SELECT * FROM technical_metadata').get();
      const stream = core.db.prepare('SELECT * FROM technical_metadata_streams').get();
      assert.equal(measurement.id, receipt.technical_metadata_id); assert.equal(measurement.media_kind, 'AUDIO');
      assert.equal(measurement.source_content_hash, digest(source)); assert.equal(measurement.source_byte_size, source.length);
      assert.equal(measurement.duration_num, 1); assert.equal(measurement.duration_den, 500); assert.equal(measurement.stream_count, 1);
      assert.equal(measurement.sample_rate, 8000); assert.equal(measurement.audio_codec, 'pcm_s16le'); assert.equal(measurement.metadata_json, '{}');
      assert.equal(stream.technical_metadata_id, measurement.id); assert.equal(stream.time_base_num, 1); assert.equal(stream.time_base_den, 8000);
      assert.equal(stream.channels, 1); assert.equal(stream.sample_rate, 8000); assert.equal(stream.duration_den, 500);
      const raw = core.db.prepare('SELECT * FROM storage_objects WHERE id=?').get(measurement.raw_evidence_object_id);
      const rawBytes = fs.readFileSync(path.join(options.assetStorePath, core._objectRelativePath('SHA-256', raw.content_hash)));
      assert.equal(digest(rawBytes), measurement.raw_evidence_hash); assert.equal(rawBytes.length, measurement.raw_evidence_byte_size);
      assert.equal(raw.storage_class, 'LOCAL_MANAGED');
      assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE action_type='media_probe.bind_evidence'").get().n, 1);
      assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE event_type='MEDIA_PROBE_EVIDENCE_BOUND'").get().n, 2);
    }
    const privateStage = core.db.prepare('SELECT * FROM staging_objects WHERE job_attempt_id=?').get(attempt.id);
    if (privateStage) {
      assert.equal(core._stagingObjects().items.some(row => row.id === privateStage.id), false);
      assert.throws(() => core._useExistingImportStaging({ staging_id: privateStage.id }), { code: 'STAGING_PRIVATE_EVIDENCE' });
      assert.throws(() => core._importAsset({ project_id: project.id, staging_id: privateStage.id }), { code: 'STAGING_PRIVATE_EVIDENCE' });
      const before = JSON.stringify(privateStage); core._reconcileStaging({ staging_id: privateStage.id });
      assert.equal(JSON.stringify(core.db.prepare('SELECT * FROM staging_objects WHERE id=?').get(privateStage.id)), before);
      if (config.mode === 'CORE_BIND_RIGHTS') assert.equal(privateStage.state, 'VERIFIED');
      if (['CORE_BIND_AUDIT', 'CORE_TERMINAL_AUDIT', 'CORE_BIND_EXPIRED'].includes(config.mode)) {
        assert.equal(privateStage.state, 'VERIFIED');
        const cas = path.join(options.assetStorePath, core._objectRelativePath('SHA-256', privateStage.sha256));
        assert.equal(digest(fs.readFileSync(cas)), privateStage.sha256);
        assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM storage_objects WHERE content_hash=?').get(privateStage.sha256).n, 0);
      }
    }
    assert.equal(digest(fs.readFileSync(managedSource)), config.mode === 'CORE_SOURCE_SWAP' ? digest(Buffer.alloc(source.length, 120)) : digest(source));
    if (receipt) {
      assert.equal(receipt.execution_started, config.mode !== 'CORE_SOURCE_SWAP');
      if (config.mode === 'CORE_SOURCE_SWAP') {
        assert.ok(['PROBE_BROKER_UNAVAILABLE','PROBE_BROKER_DISCONNECTED'].includes(receipt.code)); assert.equal(receipt.physical_tree, 'UNKNOWN');
        assert.equal(attempt.stdout_bytes, null); assert.equal(attempt.stderr_bytes, null);
      }
      if (config.mode === 'CORE_GOOD') {
        assert.match(receipt.code, /^PROBE_/); assert.equal(receipt.physical_tree, 'STOPPED');
        assert.ok(attempt.stdout_bytes > 0); assert.match(attempt.output_envelope_hash, /^[a-f0-9]{64}$/);
      }
      if (config.mode === 'CORE_RIGHTS') { assert.equal(receipt.code, 'PROBE_RIGHTS_BLOCKED'); assert.equal(receipt.physical_tree, 'STOPPED'); }
      if (config.mode === 'CORE_BIND_RIGHTS') { assert.equal(receipt.code, 'PROBE_RIGHTS_BLOCKED'); assert.equal(receipt.physical_tree, 'STOPPED'); }
      if (config.mode === 'CORE_SIZE_CONFLICT') assert.equal(receipt.code, 'PROBE_SOURCE_SIZE_CONFLICT');
      if (config.mode === 'CORE_BIND_EXPIRED') assert.equal(receipt.code, 'PROBE_TRUST_POLICY_EXPIRED_OR_EARLY');
      if (bound) assert.equal(receipt.code, 'PROBE_METADATA_VERIFIED');
      if (config.mode === 'CORE_AUDIT') { assert.equal(receipt.code, 'PROBE_BROKER_UNAVAILABLE'); assert.equal(receipt.physical_tree, 'UNKNOWN'); }
      const replay = await core.dispatchMediaProbeAttempt(request); assert.deepEqual(replay, receipt);
      const dispatch = core.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1'").get();
      const rows = [dispatch, ...core.db.prepare('SELECT * FROM domain_events WHERE command_id=?').all(dispatch.id),
        ...core.db.prepare('SELECT * FROM audit_records WHERE command_id=?').all(dispatch.id)];
      const text = JSON.stringify(rows); assert.equal(text.includes(root), false); assert.equal(text.includes(descriptor.pipe_name), false);
    }
    if (disconnected) {
      assert.match(job.next_step, /khởi động lại/);
      const verifyBlocked = async () => {
        const secondId = crypto.randomUUID();
        insert('media_probe_jobs', { ...job, id: secondId, row_version: 1, state: 'QUEUED', current_attempt_id: null, fencing_token: null,
          canonical_request_hash: digest(secondId), idempotency_key: secondId });
        const second = core.prepareMediaProbeAttempt({ project_id: project.id, job_id: secondId, expected_version: 1, idempotency_key: secondId });
        await assert.rejects(core.dispatchMediaProbeAttempt({ project_id: project.id, job_id: secondId, attempt_id: second.attempt_id,
          expected_version: second.job_version, idempotency_key: crypto.randomUUID() }), { code: 'PROBE_BINDING_RELEASE_UNCERTAIN' });
        assert.equal(core.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(second.attempt_id).state, 'CREATED');
      };
      await verifyBlocked(); core.close();
      core = new CoreService({ ...options, instanceEpoch: crypto.randomUUID() });
      await verifyBlocked();
      assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM technical_metadata').get().n, 1);
    }
    return { mode: config.mode, core_dispatch: 'PASS', code: receipt?.code ?? config.mode,
      native_started: receipt?.execution_started ?? true, state: job.state, metadata_rows: metadataCount, privileged_queued_fixture: true, certified_ffprobe: false };
  } finally {
    clearInterval(closeTimer); core?.close();
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'cineforge-core-native-fixture-')));
    // Retain the uncertain transport-failure root for the parent broker's
    // independent teardown evidence. Never race deletion against unknown work.
    if (!['CORE_AUDIT','CORE_BIND_DISCONNECT'].includes(config.mode)) fs.rmSync(root, { recursive: true, force: true });
  }
}
