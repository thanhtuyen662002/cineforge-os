import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

function execute(core, type, payload, expected = {}, key = type) {
  return core.handle({ api_version: '1', request_id: key, method: 'command.execute',
    params: { command_type: type, payload, expected_versions: expected, idempotency_key: key } });
}
function query(core, method, params) {
  return core.handle({ api_version: '1', request_id: 'probe-read', method, params });
}
function good(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.result; }
function setup(t, withRights = true, type = 'AUDIO') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-probe-admission-'));
  const core = new CoreService({ dbPath: path.join(directory, 'core.sqlite'), assetStorePath: path.join(directory, 'store') });
  t.after(() => { core.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const project = good(execute(core, 'CreateProject', { code: 'probe-admission', title: 'Kiểm tra media' }));
  const second = good(execute(core, 'CreateProject', { code: 'second', title: 'Dự án khác' }, {}, 'second'));
  // A real tiny PCM WAV import, not a certified ffprobe result.
  const bytes = Buffer.alloc(76); bytes.write('RIFF'); bytes.writeUInt32LE(68, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32, 40);
  const source = path.join(directory, 'source.wav'); fs.writeFileSync(source, bytes);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const imported = good(execute(core, 'ImportAsset', { project_id: project.id, source_path: source,
    asset_type: type, content_hash: hash }));
  const asset = imported.asset;
  const rightsId = core.db.prepare('SELECT rights_identity_id FROM assets WHERE id=?').get(asset.id).rights_identity_id;
  if (withRights) {
    good(execute(core, 'CreateRightsRecord', { rights_identity_id: rightsId, right_type: 'SOURCE_USE', status: 'ALLOWED', purpose: { allowed: ['MEDIA_INSPECTION'] } }));
    good(execute(core, 'RecordConsent', { rights_identity_id: rightsId, consent_type: 'SOURCE_USE', granted_by: 'fixture-owner' }));
  }
  const payload = { project_id: project.id, asset_revision_id: asset.latest_revision.id,
    content_hash: hash, byte_size: bytes.length, toolchain_manifest_hash: 'a'.repeat(64),
    probe_schema_version: 'MEDIA_PROBE_V1', parser_policy_version: 'MEDIA_PROBE_PARSER_V1' };
  const expected = { ASSET: asset.row_version };
  return { core, directory, project, second, asset, payload, expected, rightsId };
}
function count(core, table) { return core.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }

test('media probe admission is audited and blocked without executable authority; exact replay preserves one job', t => {
  const f = setup(t);
  const result = execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'admit');
  const job = good(result).job;
  assert.equal(job.state, 'BLOCKED_TOOLCHAIN'); assert.equal(job.outcome, 'UNKNOWN');
  assert.equal(job.toolchain_verified, false); assert.equal(job.execution_started, false);
  assert.equal(job.attempt_id, null); assert.equal(job.metadata, null); assert.deepEqual(job.streams, []);
  assert.equal(job.toolchain_id, null); assert.equal(job.toolchain_binary_hash, null);
  const replay = good(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'admit'));
  assert.deepEqual(replay.job, job); assert.equal(replay.command_id, result.result.command_id); assert.equal(replay.idempotent_replay, true);
  assert.equal(count(f.core, 'media_probe_jobs'), 1);
  for (const table of ['media_probe_attempts', 'media_probe_evidence', 'technical_metadata', 'technical_metadata_streams']) assert.equal(count(f.core, table), 0);
  assert.equal(f.core.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type='ProbeMediaAsset' AND status='SUCCEEDED'").get().n, 1);
  assert.equal(f.core.db.prepare("SELECT COUNT(*) AS n FROM audit_records WHERE action_type='media_probe.admit'").get().n, 1);
  assert.equal(execute(f.core, 'ProbeMediaAsset', { ...f.payload, byte_size: 77 }, f.expected, 'admit').error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');
  const read = good(query(f.core, 'query.media_probe.get', { project_id: f.project.id, job_id: job.id })).job;
  assert.equal(read.rights_generation, job.rights_generation);
  assert.equal(read.state, 'BLOCKED_TOOLCHAIN');
  assert.ok(!JSON.stringify(read).includes(f.directory));
});

test('probe admission validates exact source, asset version, scope, strict identities and redacted rejected commands', t => {
  const f = setup(t);
  for (const [ordinal, [payload, expected, code]] of [
    [{ ...f.payload, project_id: f.second.id }, f.expected, 'ENTITY_SCOPE_MISMATCH'],
    [{ ...f.payload, content_hash: 'b'.repeat(64) }, f.expected, 'STALE_REVISION'],
    [{ ...f.payload, byte_size: 77 }, f.expected, 'STALE_REVISION'],
    [f.payload, { ASSET: 2 }, 'STALE_REVISION'],
    [f.payload, {}, 'EXPECTED_VERSION_REQUIRED'],
    [f.payload, { ASSET: '1' }, 'INVALID_ARGUMENT'],
    [{ ...f.payload, content_hash: f.payload.content_hash + '\0secret' }, f.expected, 'INVALID_ARGUMENT'],
    [{ ...f.payload, parser_policy_version: 'latest' }, f.expected, 'INVALID_ARGUMENT'],
    [{ ...f.payload, path: 'C:\\private-token-secret.wav' }, f.expected, 'INVALID_ARGUMENT'],
    [f.payload, { ASSET: 1, secret: 'C:\\private-token-secret.wav' }, 'INVALID_ARGUMENT'],
  ].entries()) {
    const response = execute(f.core, 'ProbeMediaAsset', payload, expected, `invalid-${ordinal}`);
    assert.equal(response.ok, false); assert.equal(response.error.code, code);
  }
  assert.equal(count(f.core, 'media_probe_jobs'), 0);
  assert.equal(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, '').error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const journal = JSON.stringify(f.core.db.prepare("SELECT payload_json,expected_versions_json FROM commands WHERE command_type='ProbeMediaAsset'").all());
  assert.ok(!journal.includes('private-token-secret'));
  const cross = f.core.db.prepare("SELECT project_id FROM commands WHERE idempotency_key='invalid-0'").get();
  assert.equal(cross.project_id, f.project.id);
});

test('missing rights and non-media remain blocked and cannot create attempts', t => {
  const noRights = setup(t, false);
  assert.equal(good(execute(noRights.core, 'ProbeMediaAsset', noRights.payload, noRights.expected, 'no-rights')).job.state, 'BLOCKED_RIGHTS');
  const document = setup(t, true, 'DOCUMENT');
  assert.equal(good(execute(document.core, 'ProbeMediaAsset', document.payload, document.expected, 'not-media')).job.state, 'BLOCKED_MEDIA');
  assert.equal(count(noRights.core, 'media_probe_attempts'), 0); assert.equal(count(document.core, 'media_probe_attempts'), 0);
});

test('blocked cancellation is versioned and audited; retry cannot invent execution; list is bounded and project scoped', t => {
  const f = setup(t);
  const first = good(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'admit-first')).job;
  const second = good(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'admit-second')).job;
  const page = good(query(f.core, 'query.media_probe.list', { project_id: f.project.id, asset_revision_id: f.payload.asset_revision_id, limit: 1 }));
  assert.equal(page.jobs.length, 1); assert.equal(page.page.has_more, true); assert.equal(page.page.next_offset, 1);
  const next = good(query(f.core, 'query.media_probe.list', { project_id: f.project.id, asset_revision_id: f.payload.asset_revision_id, limit: '1', offset: '1' }));
  assert.notEqual(next.jobs[0].id, page.jobs[0].id);
  for (const limit of [0, 101, '1e2', 1.5, null]) assert.equal(query(f.core, 'query.media_probe.list', { project_id: f.project.id, asset_revision_id: f.payload.asset_revision_id, limit }).error.code, 'INVALID_ARGUMENT');
  for (const method of ['query.media_probe.get', 'query.media_probe.list', 'query.media_probe.metadata']) {
    const params = method.endsWith('get') ? { job_id: first.id } : { asset_revision_id: f.payload.asset_revision_id };
    assert.equal(query(f.core, method, { ...params, project_id: f.second.id }).error.code, 'ENTITY_SCOPE_MISMATCH');
  }
  const jobPayload = { project_id: f.project.id, job_id: first.id };
  assert.equal(execute(f.core, 'RetryMediaProbe', jobPayload, { JOB: 1 }, 'retry').error.code, 'PROBE_RETRY_NOT_AVAILABLE');
  assert.equal(execute(f.core, 'CancelMediaProbe', jobPayload, { JOB: 2 }, 'stale-cancel').error.code, 'STALE_REVISION');
  const cancelled = good(execute(f.core, 'CancelMediaProbe', jobPayload, { JOB: 1 }, 'cancel')).job;
  assert.equal(cancelled.state, 'CANCELLED'); assert.equal(cancelled.row_version, 2); assert.equal(cancelled.needs_user, false);
  assert.equal(execute(f.core, 'CancelMediaProbe', jobPayload, { JOB: 2 }, 'cancel-again').error.code, 'PROBE_CANCEL_NOT_AVAILABLE');
  assert.equal(good(query(f.core, 'query.media_probe.get', { project_id: f.project.id, job_id: second.id })).job.state, 'BLOCKED_TOOLCHAIN');
  assert.equal(count(f.core, 'media_probe_attempts'), 0);
});

test('projection rechecks revoked rights while idempotent command history remains immutable', t => {
  const f = setup(t);
  const admitted = execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'before-revoke'); const job = good(admitted).job;
  good(execute(f.core, 'RevokeRights', { rights_identity_id: f.rightsId, reason: 'fixture revocation' }, {}, 'revoke'));
  const projected = good(query(f.core, 'query.media_probe.get', { project_id: f.project.id, job_id: job.id })).job;
  assert.equal(projected.state, 'BLOCKED_RIGHTS'); assert.equal(projected.stored_state, 'BLOCKED_TOOLCHAIN');
  const replay = good(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'before-revoke'));
  assert.deepEqual(replay.job, admitted.result.job); assert.equal(replay.command_id, admitted.result.command_id);
  assert.equal(good(query(f.core, 'query.media_probe.metadata', { project_id: f.project.id, asset_revision_id: f.payload.asset_revision_id })).outcome, 'UNKNOWN');
});

test('changed rights generation and missing pinned materialization remain stale without rewriting historical jobs', t => {
  const f = setup(t);
  const job = good(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'old-generation')).job;
  good(execute(f.core, 'CreateRightsRecord', { rights_identity_id: f.rightsId, right_type: 'SOURCE_USE', status: 'ALLOWED', purpose: { allowed: ['MEDIA_INSPECTION'] } }, {}, 'new-generation'));
  const read = () => good(query(f.core, 'query.media_probe.get', { project_id: f.project.id, job_id: job.id })).job;
  assert.equal(read().state, 'STALE'); assert.equal(read().stored_state, 'BLOCKED_TOOLCHAIN');
  const fresh = good(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'fresh-generation')).job;
  assert.equal(fresh.state, 'BLOCKED_TOOLCHAIN'); assert.notEqual(fresh.rights_generation, job.rights_generation);
  // Privileged adversarial fixture models a location reconciliation event.
  f.core.db.prepare("UPDATE storage_object_locations SET state='MISSING' WHERE id=(SELECT storage_object_location_id FROM media_probe_jobs WHERE id=?)").run(job.id);
  assert.equal(read().state, 'STALE');
  assert.equal(execute(f.core, 'ProbeMediaAsset', f.payload, f.expected, 'missing-source').error.code, 'PROBE_MEDIA_NOT_MANAGED');
  assert.equal(count(f.core, 'media_probe_attempts'), 0); assert.equal(count(f.core, 'technical_metadata'), 0);
});

test('HTTP probe routes reject conflicting identities, paths, bad pagination and cross-project access; cancel is audited', async t => {
  const f = setup(t);
  const listener = await listenCoreHttp(f.core, { host: '127.0.0.1', port: 0, token: 'probe-fixture-token' });
  t.after(() => new Promise(resolve => listener.server.close(resolve)));
  const base = `http://127.0.0.1:${listener.address.port}`;
  const route = `/v1/projects/${f.project.id}/assets/${f.payload.asset_revision_id}/technical-metadata`;
  const request = async (url, body, key = 'http-admit') => {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer probe-fixture-token', 'content-type': 'application/json', 'Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const { project_id, asset_revision_id, ...body } = f.payload;
  const initial = await request(route);
  assert.equal(initial.body.result.state, 'UNKNOWN'); assert.equal(initial.body.result.metadata, null);
  assert.equal((await request(route + '/probes', { ...body, expected_version: 1, project_id: f.second.id })).status, 400);
  const injection = await request(route + '/probes', { ...body, expected_version: 1, path: 'C:\\secret-http-token.wav' });
  assert.equal(injection.status, 400); assert.ok(!JSON.stringify(injection.body).includes('secret-http-token'));
  const admitted = await request(route + '/probes', { ...body, expected_version: 1 });
  assert.equal(admitted.status, 200); const job = admitted.body.result.job; assert.equal(job.state, 'BLOCKED_TOOLCHAIN');
  assert.equal((await request(route + '/probes?limit=101')).status, 400);
  assert.equal((await request(route + '/probes?limit=1&limit=2')).status, 400);
  assert.equal((await request(route + '?path=C%3A%5Csecret')).status, 400);
  const jobRoute = `/v1/projects/${f.project.id}/technical-media-probes/${job.id}`;
  assert.equal((await request(`/v1/projects/${f.second.id}/technical-media-probes/${job.id}`)).status, 409);
  assert.equal((await request(jobRoute + '/retry', { expected_version: 1 }, 'http-retry')).body.error.code, 'PROBE_RETRY_NOT_AVAILABLE');
  const cancelled = await request(jobRoute + '/cancel', { expected_version: 1 }, 'http-cancel');
  assert.equal(cancelled.body.result.job.state, 'CANCELLED');
  assert.equal(count(f.core, 'media_probe_attempts'), 0); assert.equal(count(f.core, 'technical_metadata'), 0);
});
