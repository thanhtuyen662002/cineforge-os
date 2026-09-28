import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-core-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite') };
}

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, command_type, payload, expected_versions = {}, idempotency_key = undefined) {
  return core.handle(request('command.execute', {
    command_type, payload, expected_versions,
    ...(idempotency_key ? { idempotency_key } : {}),
  }, `${command_type}-${idempotency_key ?? Math.random()}`));
}

test('smoke: create project, close, and reload it from SQLite WAL', () => {
  const { dbPath, directory } = tempDb();
  const first = new CoreService({ dbPath });
  const health = first.handle(request('query.system.health', {}, 'health')).result;
  assert.equal(health.status, 'READY');
  assert.equal(health.journal_mode, 'WAL');
  const created = execute(first, 'CreateProject', { code: 'smoke-film', title: 'Phim smoke' }, {}, 'smoke-create');
  assert.equal(created.ok, true);
  const projectId = created.result.id;
  const rowVersion = created.result.row_version;
  first.close();

  const second = new CoreService({ dbPath });
  const loaded = second.handle(request('query.project.get', { project_id: projectId }, 'reload'));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.result.id, projectId);
  assert.equal(loaded.result.title, 'Phim smoke');
  assert.equal(loaded.result.row_version, rowVersion);
  assert.equal(second.handle(request('query.system.health')).result.wal_enabled, true);
  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('project metadata uses optimistic row versions and appends event plus audit', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const created = execute(core, 'CreateProject', { title: 'Đổi metadata', code: 'metadata' }, {}, 'create');
  const projectId = created.result.id;
  const updated = execute(core, 'UpdateProjectMetadata', { project_id: projectId, title: 'Tên mới' }, { PROJECT: 1 }, 'update-1');
  assert.equal(updated.ok, true);
  assert.equal(updated.result.title, 'Tên mới');
  assert.equal(updated.result.row_version, 2);

  const stale = execute(core, 'UpdateProjectMetadata', { project_id: projectId, title: 'Không được ghi đè' }, { PROJECT: 1 }, 'update-stale');
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_REVISION');
  const activity = core.handle(request('query.project.activity', { project_id: projectId }));
  assert.equal(activity.ok, true);
  assert.equal(activity.result.events.length, 2);
  const audit = core.handle(request('query.audit.list', { project_id: projectId }));
  assert.equal(audit.ok, true);
  assert.equal(audit.result.records.length, 3); // create, update, and failed stale attempt
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('tasks, shots, and notes are first-class project workspace records', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'Workspace', code: 'workspace' }, {}, 'project');
  const projectId = project.result.id;
  const task = execute(core, 'CreateTask', { project_id: projectId, title: 'Viết shot list', priority: 5 }, {}, 'task');
  assert.equal(task.ok, true);
  const shot = execute(core, 'CreateShot', { project_id: projectId, code: 'SH010', title: 'Cửa mở' }, {}, 'shot');
  assert.equal(shot.ok, true);
  const taskNote = execute(core, 'AddTaskNote', { task_id: task.result.id, body: 'Cần kiểm tra continuity.' }, {}, 'task-note');
  assert.equal(taskNote.ok, true);
  const shotNote = execute(core, 'AddShotNote', { shot_id: shot.result.id, body: 'Ánh sáng ấm, giữ đạo cụ.' }, {}, 'shot-note');
  assert.equal(shotNote.ok, true);

  const workspace = core.handle(request('query.project.workspace', { project_id: projectId }));
  assert.equal(workspace.ok, true);
  assert.equal(workspace.result.tasks.length, 1);
  assert.equal(workspace.result.shots.length, 1);
  assert.equal(workspace.result.notes.length, 2);
  assert.equal(workspace.result.notes[0].body, 'Ánh sáng ấm, giữ đạo cụ.');
  assert.throws(
    () => core.db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('tampered', shotNote.result.id),
    /notes are append-only/,
  );
  assert.throws(
    () => core.db.prepare('DELETE FROM notes WHERE id = ?').run(taskNote.result.id),
    /notes are append-only/,
  );
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('task and shot state transitions reject terminal resurrection and unsafe archive restore', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'State machine', code: 'state-machine' }, {}, 'state-project');
  const projectId = project.result.id;
  const task = execute(core, 'CreateTask', { project_id: projectId, title: 'Render' }, {}, 'state-task');
  const taskId = task.result.id;
  const active = execute(core, 'UpdateTask', { task_id: taskId, status: 'IN_PROGRESS' }, { TASK: 1 }, 'state-task-active');
  assert.equal(active.ok, true);
  const done = execute(core, 'UpdateTask', { task_id: taskId, status: 'DONE' }, { TASK: 2 }, 'state-task-done');
  assert.equal(done.ok, true);
  const resurrect = execute(core, 'UpdateTask', { task_id: taskId, status: 'IN_PROGRESS' }, { TASK: 3 }, 'state-task-resurrect');
  assert.equal(resurrect.ok, false);
  assert.equal(resurrect.error.code, 'INVALID_STATE_TRANSITION');

  const shot = execute(core, 'CreateShot', { project_id: projectId, code: 'SH010', title: 'Door' }, {}, 'state-shot');
  const shotId = shot.result.id;
  const archived = execute(core, 'UpdateShot', { shot_id: shotId, lifecycle_state: 'ARCHIVED' }, { SHOT: 1 }, 'state-shot-archive');
  assert.equal(archived.ok, true);
  const unsafeRestore = execute(core, 'UpdateShot', { shot_id: shotId, lifecycle_state: 'ACTIVE' }, { SHOT: 2 }, 'state-shot-restore');
  assert.equal(unsafeRestore.ok, false);
  assert.equal(unsafeRestore.error.code, 'INVALID_STATE_TRANSITION');
  assert.equal(core.handle(request('query.shot.list', { project_id: projectId })).result[0].lifecycle_state, 'ARCHIVED');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('dashboard health reflects blocked canonical tasks and project lifecycle', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'Health projection', code: 'health-projection' }, {}, 'health-project');
  const projectId = project.result.id;
  const task = execute(core, 'CreateTask', { project_id: projectId, title: 'Waiting on rights' }, {}, 'health-task');
  const blocked = execute(core, 'UpdateTask', { task_id: task.result.id, status: 'BLOCKED' }, { TASK: 1 }, 'health-block');
  assert.equal(blocked.ok, true);
  const dashboard = core.handle(request('query.home', {}, 'health-dashboard'));
  const summary = dashboard.result.projects.find((candidate) => candidate.id === projectId);
  assert.equal(summary.health_state, 'AT_RISK');
  assert.equal(summary.completion.done, 0);
  assert.equal(summary.completion.total, 1);
  const health = core.handle(request('query.project.health', { project_id: projectId }, 'health-detail'));
  assert.equal(health.result.health_state, 'AT_RISK');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('project commands reject conflicting entity claims before mutation', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const first = execute(core, 'CreateProject', { title: 'First', code: 'first-claim' }, {}, 'claim-first');
  const second = execute(core, 'CreateProject', { title: 'Second', code: 'second-claim' }, {}, 'claim-second');
  const conflict = execute(core, 'UpdateProjectMetadata', {
    project_id: first.result.id,
    entity_type: 'PROJECT',
    entity_id: second.result.id,
    title: 'Must fail',
  }, { PROJECT: 1 }, 'claim-conflict');
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'ENTITY_SCOPE_MISMATCH');
  assert.equal(core.handle(request('query.project.get', { project_id: first.result.id }, 'claim-first-read')).result.title, 'First');
  assert.equal(core.handle(request('query.project.get', { project_id: second.result.id }, 'claim-second-read')).result.title, 'Second');
  const command = core.db.prepare(`SELECT project_id, status FROM commands
    WHERE command_type = 'UpdateProjectMetadata' ORDER BY created_at_utc_us DESC LIMIT 1`).get();
  assert.equal(command.project_id, second.result.id);
  assert.equal(command.status, 'FAILED');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('entity-scoped commands reject conflicting project claims and bind failed metadata to the target project', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const first = execute(core, 'CreateProject', { title: 'Target', code: 'target-project' }, {}, 'scope-target-project');
  const second = execute(core, 'CreateProject', { title: 'Claim', code: 'claim-project' }, {}, 'scope-claim-project');
  const targetProjectId = first.result.id;
  const conflictingProjectId = second.result.id;
  const task = execute(core, 'CreateTask', { project_id: targetProjectId, title: 'Scoped task' }, {}, 'scope-task');
  const shot = execute(core, 'CreateShot', { project_id: targetProjectId, code: 'SH010', title: 'Scoped shot' }, {}, 'scope-shot');

  const taskUpdate = execute(core, 'UpdateTask', {
    task_id: task.result.id, project_id: conflictingProjectId, title: 'Should fail',
  }, { TASK: 1 }, 'scope-task-update');
  assert.equal(taskUpdate.ok, false);
  assert.equal(taskUpdate.error.code, 'ENTITY_SCOPE_MISMATCH');

  const shotUpdate = execute(core, 'UpdateShot', {
    shot_id: shot.result.id, project_id: conflictingProjectId, title: 'Should fail',
  }, { SHOT: 1 }, 'scope-shot-update');
  assert.equal(shotUpdate.ok, false);
  assert.equal(shotUpdate.error.code, 'ENTITY_SCOPE_MISMATCH');

  const taskNote = execute(core, 'AddTaskNote', {
    task_id: task.result.id, project_id: conflictingProjectId, body: 'Should fail',
  }, {}, 'scope-task-note');
  assert.equal(taskNote.ok, false);
  assert.equal(taskNote.error.code, 'ENTITY_SCOPE_MISMATCH');

  const mixedTaskNote = execute(core, 'AddTaskNote', {
    task_id: task.result.id, entity_id: shot.result.id, body: 'Target IDs must agree',
  }, {}, 'scope-mixed-note');
  assert.equal(mixedTaskNote.ok, false);
  assert.equal(mixedTaskNote.error.code, 'ENTITY_SCOPE_MISMATCH');

  const shotNote = execute(core, 'AddShotNote', {
    shot_id: shot.result.id, project_id: conflictingProjectId, body: 'Should fail',
  }, {}, 'scope-shot-note');
  assert.equal(shotNote.ok, false);
  assert.equal(shotNote.error.code, 'ENTITY_SCOPE_MISMATCH');

  const failed = core.db.prepare(`SELECT command_type, project_id, status FROM commands
    WHERE command_type IN ('UpdateTask', 'UpdateShot', 'AddTaskNote', 'AddShotNote')
    ORDER BY created_at_utc_us ASC`).all();
  assert.equal(failed.length, 5);
  assert.deepEqual([...new Set(failed.map((row) => row.project_id))], [targetProjectId]);
  assert.ok(failed.every((row) => row.status === 'FAILED'));
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('idempotency, plans, event cursor, and append-only ledgers are fail-closed', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const first = execute(core, 'CreateProject', { title: 'Idempotent', code: 'idem' }, {}, 'same-key');
  const replay = execute(core, 'CreateProject', { title: 'Idempotent', code: 'idem' }, {}, 'same-key');
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(replay.result.id, first.result.id);
  assert.equal(replay.result.command_id, first.result.command_id);
  assert.equal(core.handle(request('query.project.list')).result.projects.length, 1);

  const planned = core.handle(request('command.plan', {
    command_type: 'UpdateProjectMetadata',
    payload: { project_id: first.result.id, title: 'Planned' },
    expected_versions: { PROJECT: 1 },
  }));
  assert.equal(planned.ok, true);
  assert.equal(planned.result.precondition.ok, true);
  assert.equal(core.handle(request('query.project.get', { project_id: first.result.id })).result.title, 'Idempotent');

  const events = core.handle(request('events.subscribe', { after_seq: 0 }));
  assert.equal(events.ok, true);
  assert.equal(events.result.events.length, 1);
  assert.throws(() => core.db.prepare('DELETE FROM domain_events').run(), /append-only/);
  assert.throws(() => core.db.prepare('DELETE FROM audit_records').run(), /append-only/);
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('idempotency keys bind canonical payload and expected versions across restart', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const first = execute(core, 'CreateProject', { title: 'Canonical request', code: 'canonical-request' }, {}, 'bound-key');
  assert.equal(first.ok, true);
  const stored = core.db.prepare(`SELECT idempotency_fingerprint FROM commands
    WHERE id = ?`).get(first.result.command_id);
  assert.match(stored.idempotency_fingerprint, /^[a-f0-9]{64}$/);

  // Object insertion order is irrelevant to the canonical request hash, so a
  // semantically identical retry remains a replay.
  const reordered = execute(core, 'CreateProject', { code: 'canonical-request', title: 'Canonical request' }, {}, 'bound-key');
  assert.equal(reordered.ok, true);
  assert.equal(reordered.result.idempotent_replay, true);
  assert.equal(reordered.result.id, first.result.id);

  const changedPayload = execute(core, 'CreateProject', { title: 'Different request', code: 'canonical-request' }, {}, 'bound-key');
  assert.equal(changedPayload.ok, false);
  assert.equal(changedPayload.error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');
  assert.equal(changedPayload.error.category, 'CONFLICT');
  assert.equal(changedPayload.error.needs_user, true);
  assert.equal(changedPayload.error.user_message_key, 'errors.idempotency_key_reuse_conflict');

  const changedPrecondition = execute(core, 'CreateProject', { code: 'canonical-request', title: 'Canonical request' }, { PROJECT: 1 }, 'bound-key');
  assert.equal(changedPrecondition.ok, false);
  assert.equal(changedPrecondition.error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');
  assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM commands').get().count, 1);
  core.close();

  // Simulate a v2 row that had the new nullable column introduced after the
  // original command was written.  Reopening must backfill it before replay.
  const legacy = new CoreService({ dbPath });
  legacy.db.prepare('UPDATE commands SET idempotency_fingerprint = NULL WHERE id = ?').run(first.result.command_id);
  legacy.close();
  const reopened = new CoreService({ dbPath });
  const backfilled = reopened.db.prepare(`SELECT idempotency_fingerprint FROM commands
    WHERE id = ?`).get(first.result.command_id);
  assert.match(backfilled.idempotency_fingerprint, /^[a-f0-9]{64}$/);
  const replayAfterRestart = execute(reopened, 'CreateProject', { title: 'Canonical request', code: 'canonical-request' }, {}, 'bound-key');
  assert.equal(replayAfterRestart.ok, true);
  assert.equal(replayAfterRestart.result.idempotent_replay, true);
  const conflictAfterRestart = execute(reopened, 'CreateProject', { title: 'Different after restart', code: 'canonical-request' }, {}, 'bound-key');
  assert.equal(conflictAfterRestart.ok, false);
  assert.equal(conflictAfterRestart.error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('invalid project is recorded as a failed command rather than corrupting state', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const response = execute(core, 'CreateTask', { project_id: 'missing-project', title: 'Không tạo được' }, {}, 'bad-task');
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'NOT_FOUND');
  const failed = core.handle(request('query.audit.list'));
  assert.equal(failed.result.records.length, 1);
  assert.equal(failed.result.records[0].outcome, 'FAILED');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('asset intake hashes bytes, stages a durable object and preserves redacted provenance', () => {
  const { dbPath, directory } = tempDb();
  const assetStorePath = path.join(directory, 'asset-store');
  const sourcePath = path.join(directory, 'shot-010.txt');
  const content = 'CineForge asset bytes\n';
  fs.writeFileSync(sourcePath, content, 'utf8');
  const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
  const core = new CoreService({ dbPath, assetStorePath });
  const project = execute(core, 'CreateProject', { title: 'Asset intake', code: 'asset-intake' }, {}, 'asset-project');
  const projectId = project.result.id;
  const imported = execute(core, 'ImportAsset', {
    project_id: projectId,
    source_path: sourcePath,
    asset_type: 'DOCUMENT',
    semantic_role: 'SOURCE_REFERENCE',
    content_hash: expectedHash,
  }, {}, 'asset-import');
  assert.equal(imported.ok, true);
  const asset = imported.result.asset;
  assert.equal(asset.project_id, projectId);
  assert.equal(asset.latest_revision.availability_state, 'AVAILABLE');
  assert.equal(asset.latest_revision.review_state, 'UNREVIEWED');
  assert.equal(asset.latest_revision.readiness_state, 'UNKNOWN');
  assert.equal(asset.latest_revision.storage_object.content_hash, expectedHash);
  assert.deepEqual(imported.result.warnings, ['SECURITY_SCAN_PENDING', 'MEDIA_DECODE_PENDING']);
  assert.equal(asset.latest_revision.provenance.source_name, 'shot-010.txt');
  assert.equal(Object.hasOwn(asset.latest_revision.provenance, 'source_path_or_uri'), false);
  assert.match(asset.latest_revision.locations[0].path_or_uri, /^object:\/\/sha-256\//);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), content);

  const objectRelative = path.join('objects', 'sha-256', expectedHash.slice(0, 2), expectedHash);
  const objectPath = path.join(assetStorePath, objectRelative);
  assert.equal(fs.readFileSync(objectPath, 'utf8'), content);
  const workspace = core.handle(request('query.project.workspace', { project_id: projectId }));
  assert.equal(workspace.ok, true);
  assert.equal(workspace.result.assets.length, 1);
  assert.equal(workspace.result.counts.assets, 1);
  const replay = execute(core, 'ImportAsset', {
    project_id: projectId,
    source_path: sourcePath,
    asset_type: 'DOCUMENT',
    semantic_role: 'SOURCE_REFERENCE',
    content_hash: expectedHash,
  }, {}, 'asset-import');
  assert.equal(replay.ok, true);
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(core.handle(request('query.project.assets', { project_id: projectId })).result.assets.length, 1);

  const reopened = new CoreService({ dbPath, assetStorePath });
  const loaded = reopened.handle(request('query.library.assets'));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.result.assets[0].latest_revision.storage_object.content_hash, expectedHash);
  assert.throws(() => reopened.db.prepare('DELETE FROM asset_revisions').run(), /asset_revisions is append-only/);
  assert.throws(() => reopened.db.prepare('DELETE FROM storage_objects').run(), /storage_objects is append-only/);
  assert.throws(() => reopened.db.prepare('DELETE FROM provenance_records').run(), /provenance_records is append-only/);
  reopened.close();
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('asset intake rejects a supplied hash mismatch and records a failed command', () => {
  const { dbPath, directory } = tempDb();
  const sourcePath = path.join(directory, 'wrong.txt');
  fs.writeFileSync(sourcePath, 'actual', 'utf8');
  const core = new CoreService({ dbPath, assetStorePath: path.join(directory, 'asset-store') });
  const project = execute(core, 'CreateProject', { title: 'Hash guard', code: 'hash-guard' }, {}, 'hash-project');
  const response = execute(core, 'ImportAsset', {
    project_id: project.result.id, source_path: sourcePath, content_hash: '0'.repeat(64),
  }, {}, 'hash-mismatch');
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'HASH_MISMATCH');
  assert.equal(core.handle(request('query.library.assets')).result.assets.length, 0);
  assert.equal(core.handle(request('query.audit.list')).result.records.at(0).outcome, 'FAILED');
  assert.equal(fs.existsSync(path.join(directory, 'asset-store')), false);
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('reference intake keeps an external location explicit without copying or exposing its path', () => {
  const { dbPath, directory } = tempDb();
  const sourcePath = path.join(directory, 'external.png');
  fs.writeFileSync(sourcePath, 'reference bytes', 'utf8');
  const store = path.join(directory, 'asset-store');
  const core = new CoreService({ dbPath, assetStorePath: store });
  const response = execute(core, 'ImportAsset', {
    source_path: sourcePath, storage_mode: 'REFERENCE', asset_type: 'IMAGE',
  }, {}, 'external-reference');
  assert.equal(response.ok, true);
  const asset = response.result.asset;
  assert.equal(asset.latest_revision.locations[0].location_type, 'EXTERNAL_PATH');
  assert.equal(asset.latest_revision.locations[0].path_or_uri, 'file://[redacted]');
  assert.equal(asset.latest_revision.storage_object.storage_class, 'EXTERNAL_REFERENCE');
  assert.equal(fs.existsSync(store), false);
  const details = core.handle(request('query.import.session', { import_session_id: response.result.import_session.id }));
  assert.equal(details.ok, true);
  assert.equal(details.result.session.source_root, 'file://[redacted]');
  assert.equal(details.result.items[0].source_path_or_uri, 'file://[redacted]');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
