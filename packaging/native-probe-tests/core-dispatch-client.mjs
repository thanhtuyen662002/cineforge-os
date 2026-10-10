import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CoreService } from '../../core/core.mjs';
import { canonicalJson } from '../../core/canonical.mjs';
import { preflightRendererToolchain } from '../../core/renderer-toolchain.mjs';

// Privileged local fixture only. The fake executable and ephemeral signer do
// not certify ffprobe, trusted time, public admission or metadata binding.
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
      return { envelopeBytes, trustPolicyBytes, trustContext: { nowUtcMs: Date.now(), minimumPolicyEpoch: 1,
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
    const project = execute('CreateProject', { code: 'native-fixture', title: 'Kiểm thử runtime' });
    const sourcePath = path.join(root, 'source.txt');
    const source = Buffer.from(config.mode === 'CORE_CLOSE' ? 'HANG\n' : 'GOOD\n'); fs.writeFileSync(sourcePath, source);
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
        assert.equal(core.db.prepare('SELECT state FROM media_probe_attempts WHERE id=?').get(request.attempt_id).state, 'EXECUTING');
        assert.equal(core.db.prepare('SELECT state FROM media_probe_jobs WHERE id=?').get(jobId).state, 'RUNNING');
        assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE action_type='media_probe.dispatch_unknown'").get().n, 0);
        core.close();
      }
      core = new CoreService({ ...options, instanceEpoch: crypto.randomUUID(), mediaProbeBrokerSource: null });
    } else receipt = await pending;
    const job = core.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(jobId);
    const attempt = core.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(request.attempt_id);
    assert.equal(job.state, 'UNKNOWN'); assert.equal(job.needs_user, 1); assert.equal(job.current_attempt_id, null); assert.equal(job.fencing_token, null);
    assert.equal(attempt.state, 'ABANDONED');
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM technical_metadata').get().n, 0);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM media_probe_evidence').get().n, 0);
    assert.equal(digest(fs.readFileSync(managedSource)), config.mode === 'CORE_SOURCE_SWAP' ? digest(Buffer.alloc(source.length, 120)) : digest(source));
    if (receipt) {
      assert.equal(receipt.execution_started, config.mode !== 'CORE_SOURCE_SWAP');
      if (config.mode === 'CORE_SOURCE_SWAP') {
        assert.equal(receipt.code, 'PROBE_FILE_HASH_MISMATCH'); assert.equal(receipt.physical_tree, 'UNKNOWN');
        assert.equal(attempt.stdout_bytes, 0); assert.equal(attempt.stderr_bytes, 0);
      }
      if (config.mode === 'CORE_GOOD') {
        assert.equal(receipt.code, 'PROBE_OBSERVATION_UNBOUND'); assert.equal(receipt.physical_tree, 'STOPPED');
        assert.ok(attempt.stdout_bytes > 0); assert.match(attempt.output_envelope_hash, /^[a-f0-9]{64}$/);
      }
      if (config.mode === 'CORE_RIGHTS') { assert.equal(receipt.code, 'PROBE_RIGHTS_BLOCKED'); assert.equal(receipt.physical_tree, 'STOPPED'); }
      if (config.mode === 'CORE_AUDIT') { assert.equal(receipt.code, 'PROBE_BROKER_UNAVAILABLE'); assert.equal(receipt.physical_tree, 'UNKNOWN'); }
      const replay = await core.dispatchMediaProbeAttempt(request); assert.deepEqual(replay, receipt);
      const dispatch = core.db.prepare("SELECT * FROM commands WHERE command_type='PREPARED_DISPATCH_MEDIA_PROBE_V1'").get();
      const rows = [dispatch, ...core.db.prepare('SELECT * FROM domain_events WHERE command_id=?').all(dispatch.id),
        ...core.db.prepare('SELECT * FROM audit_records WHERE command_id=?').all(dispatch.id)];
      const text = JSON.stringify(rows); assert.equal(text.includes(root), false); assert.equal(text.includes(descriptor.pipe_name), false);
    }
    return { mode: config.mode, core_dispatch: 'PASS', code: receipt?.code ?? config.mode,
      native_started: receipt?.execution_started ?? true, state: job.state, metadata_rows: 0, privileged_queued_fixture: true, certified_ffprobe: false };
  } finally {
    clearInterval(closeTimer); core?.close();
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'cineforge-core-native-fixture-')));
    // Retain the uncertain transport-failure root for the parent broker's
    // independent teardown evidence. Never race deletion against unknown work.
    if (config.mode !== 'CORE_AUDIT') fs.rmSync(root, { recursive: true, force: true });
  }
}
