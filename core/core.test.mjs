import assert from 'node:assert/strict';
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
