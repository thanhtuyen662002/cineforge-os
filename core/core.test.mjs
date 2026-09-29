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

test('DecisionRequest is a canonical, stale-safe Needs You aggregate', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'Decision film', code: 'decision-film' }, {}, 'decision-project');
  const projectId = project.result.id;
  const task = execute(core, 'CreateTask', { project_id: projectId, title: 'Rights check' }, {}, 'decision-task');
  const created = execute(core, 'CreateDecisionRequest', {
    project_id: projectId,
    decision_type: 'RIGHTS_REVIEW',
    title_key: 'decisions.rights.title',
    reason_key: 'decisions.rights.reason',
    reason_args: { asset_count: 2 },
    blocking_scope_type: 'TASK',
    blocking_scope_id: task.result.id,
    severity: 'HIGH',
    affected_entities: [{ entity_type: 'TASK', entity_id: task.result.id }],
    evidence: [{ kind: 'RIGHTS_SUMMARY', status: 'UNKNOWN' }],
    default_behavior: { action: 'DO_NOTHING', label_key: 'decisions.default_do_nothing' },
    choices: [
      { id: 'approve-internal', label_key: 'decisions.choice.internal', recommended: true, consequence_summary: { scope: 'INTERNAL' } },
      { id: 'dismiss-rights', label_key: 'decisions.choice.dismiss', command_template: { kind: 'NOOP' } },
    ],
  }, {}, 'decision-create');
  assert.equal(created.ok, true);
  const decision = created.result;
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.decision_version, 1);
  assert.equal(decision.created_by_event_seq, created.result.event_seq);
  assert.equal(decision.project_id, projectId);
  assert.equal(decision.choices.length, 2);
  assert.equal(decision.choices[0].recommended, true);
  assert.deepEqual(decision.evidence, [{ kind: 'RIGHTS_SUMMARY', status: 'UNKNOWN' }]);

  const home = core.handle(request('query.home', {}, 'decision-home'));
  assert.equal(home.ok, true);
  assert.equal(home.result.needs_you.length, 1);
  assert.equal(home.result.needs_you[0].id, decision.id);
  const scopedList = core.handle(request('query.needs_you.list', { project_id: projectId }, 'decision-list'));
  assert.equal(scopedList.result.items.length, 1);
  assert.equal(core.handle(request('query.needs_you.get', { decision_request_id: decision.id })).result.id, decision.id);

  const invalidChoice = execute(core, 'ResolveDecisionRequest', {
    decision_request_id: decision.id, choice_id: 'missing', expected_decision_version: 1,
  }, { DECISION_REQUEST: 1 }, 'decision-invalid-choice');
  assert.equal(invalidChoice.ok, false);
  assert.equal(invalidChoice.error.code, 'INVALID_DECISION_CHOICE');
  const stale = execute(core, 'ResolveDecisionRequest', {
    decision_request_id: decision.id, choice_id: 'approve-internal', expected_decision_version: 2,
  }, { DECISION_REQUEST: 2 }, 'decision-stale');
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_DECISION');

  const resolved = execute(core, 'ResolveDecisionRequest', {
    decision_request_id: decision.id, choice_id: 'approve-internal', expected_decision_version: 1,
  }, { DECISION_REQUEST: 1 }, 'decision-resolve');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.result.state, 'RESOLVED');
  assert.equal(resolved.result.resolved_choice_id, 'approve-internal');
  const replay = execute(core, 'ResolveDecisionRequest', {
    decision_request_id: decision.id, choice_id: 'approve-internal', expected_decision_version: 1,
  }, { DECISION_REQUEST: 1 }, 'decision-resolve');
  assert.equal(replay.ok, true);
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(core.handle(request('query.needs_you.list')).result.items.length, 0);

  const second = execute(core, 'CreateDecisionRequest', {
    project_id: projectId,
    decision_type: 'EDITORIAL_REVIEW',
    title_key: 'decisions.editorial.title',
    reason_key: 'decisions.editorial.reason',
    blocking_scope_type: 'PROJECT',
    blocking_scope_id: projectId,
    choices: [{ id: 'dismiss', label_key: 'decisions.choice.dismiss' }],
  }, {}, 'decision-second');
  const dismissed = execute(core, 'DismissDecisionRequest', {
    decision_request_id: second.result.id, expected_decision_version: 1,
  }, { DECISION_REQUEST: 1 }, 'decision-dismiss');
  assert.equal(dismissed.ok, true);
  assert.equal(dismissed.result.state, 'DISMISSED');

  const systemDecision = execute(core, 'CreateDecisionRequest', {
    decision_type: 'SYSTEM_MAINTENANCE', title_key: 'decisions.system.title', reason_key: 'decisions.system.reason',
    blocking_scope_type: 'SYSTEM', choices: [{ id: 'continue-system', label_key: 'decisions.choice.continue' }],
  }, {}, 'decision-system');
  const systemScopeConflict = execute(core, 'DismissDecisionRequest', {
    decision_request_id: systemDecision.result.id, project_id: projectId, expected_decision_version: 1,
  }, { DECISION_REQUEST: 1 }, 'decision-system-conflict');
  assert.equal(systemScopeConflict.ok, false);
  assert.equal(systemScopeConflict.error.code, 'ENTITY_SCOPE_MISMATCH');
  const systemCommand = core.db.prepare(`SELECT project_id FROM commands WHERE command_type = 'DismissDecisionRequest' ORDER BY created_at_utc_us DESC LIMIT 1`).get();
  assert.equal(systemCommand.project_id, null);

  const third = execute(core, 'CreateDecisionRequest', {
    project_id: projectId,
    decision_type: 'STALE_TEST', title_key: 'decisions.stale.title', reason_key: 'decisions.stale.reason',
    blocking_scope_type: 'PROJECT', blocking_scope_id: projectId,
    choices: [{ id: 'continue', label_key: 'decisions.choice.continue' }],
  }, {}, 'decision-third');
  const obsolete = execute(core, 'ObsoleteDecisionRequest', {
    decision_request_id: third.result.id, expected_decision_version: 1,
  }, { DECISION_REQUEST: 1 }, 'decision-obsolete');
  assert.equal(obsolete.ok, true);
  assert.equal(obsolete.result.state, 'OBSOLETE');
  const obsoleteResolve = execute(core, 'ResolveDecisionRequest', {
    decision_request_id: third.result.id, choice_id: 'continue', expected_decision_version: 2,
  }, { DECISION_REQUEST: 2 }, 'decision-obsolete-resolve');
  assert.equal(obsoleteResolve.ok, false);
  assert.equal(obsoleteResolve.error.code, 'STALE_DECISION');

  assert.throws(
    () => core.db.prepare('UPDATE decision_choices SET label_key = ? WHERE id = ?').run('tampered', 'approve-internal'),
    /decision_choices are append-only/,
  );
  assert.throws(
    () => core.db.prepare('DELETE FROM decision_choices WHERE id = ?').run('approve-internal'),
    /decision_choices are append-only/,
  );
  const activity = core.handle(request('query.project.activity', { project_id: projectId }, 'decision-activity'));
  assert.ok(activity.result.events.some((event) => event.event_type === 'DECISION_REQUEST_RESOLVED'));
  core.close();
  const reopened = new CoreService({ dbPath });
  const persisted = reopened.handle(request('query.decisions.get', { decision_request_id: decision.id }, 'decision-reopen'));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.result.state, 'RESOLVED');
  assert.equal(reopened.handle(request('query.system.health')).result.schema_version, 14);
  reopened.close();
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

test('staging lifecycle is durable, race-safe and startup-reconciled without adopting unknown bytes', () => {
  const { dbPath, directory } = tempDb();
  const store = path.join(directory, 'asset-store');
  const sourcePath = path.join(directory, 'staged.txt');
  fs.writeFileSync(sourcePath, 'durable staged bytes', 'utf8');
  const core = new CoreService({ dbPath, assetStorePath: store });
  const first = execute(core, 'ImportAsset', { source_path: sourcePath, asset_type: 'DOCUMENT' }, {}, 'stage-first');
  assert.equal(first.ok, true);
  const firstStage = core.db.prepare('SELECT * FROM staging_objects WHERE command_id = ?').get(first.result.command_id);
  assert.equal(firstStage.state, 'REGISTERED');
  assert.equal(firstStage.sha256, first.result.asset.latest_revision.storage_object.content_hash);
  assert.equal(fs.existsSync(firstStage.temp_path), false);
  const visible = core.handle(request('query.storage.staging_orphans', { state: 'REGISTERED' }, 'stage-list'));
  assert.equal(visible.ok, true);
  assert.equal(visible.result.items[0].state, 'REGISTERED');
  assert.equal(Object.hasOwn(visible.result.items[0], 'temp_path'), false);

  const second = execute(core, 'ImportAsset', { source_path: sourcePath, asset_type: 'DOCUMENT' }, {}, 'stage-second');
  assert.equal(second.ok, true);
  assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM storage_objects').get().count, 1);
  assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM storage_object_locations').get().count, 1);

  const pending = core._reserveImportStaging({ source_path: sourcePath }, 'manual-reconcile-stage');
  const pendingRow = core.db.prepare('SELECT * FROM staging_objects WHERE id = ?').get(pending.id);
  assert.equal(pendingRow.state, 'COMPLETE');
  fs.rmSync(pendingRow.temp_path, { force: true });
  core.close();

  const reopened = new CoreService({ dbPath, assetStorePath: store });
  const reconciled = reopened.db.prepare('SELECT state FROM staging_objects WHERE id = ?').get(pending.id);
  assert.equal(reconciled.state, 'ORPHANED');
  const reconciliationAudit = reopened.handle(request('query.audit.list', {}, 'stage-audit'));
  assert.ok(reconciliationAudit.result.records.some((record) => record.action_type === 'storage.staging_reconcile'));
  assert.equal(reopened.handle(request('query.system.health')).result.schema_version, 14);
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('intake rejects hardlink aliases and cannot rebind a staged handle to another path', () => {
  const { dbPath, directory } = tempDb();
  const store = path.join(directory, 'asset-store');
  const sourcePath = path.join(directory, 'source.txt');
  const aliasPath = path.join(directory, 'alias.txt');
  const otherPath = path.join(directory, 'other.txt');
  fs.writeFileSync(sourcePath, 'identity protected', 'utf8');
  fs.writeFileSync(otherPath, 'different source', 'utf8');
  let hardlinkCreated = true;
  try { fs.linkSync(sourcePath, aliasPath); } catch { hardlinkCreated = false; }
  const core = new CoreService({ dbPath, assetStorePath: store });
  if (hardlinkCreated) {
    const rejected = execute(core, 'ImportAsset', { source_path: sourcePath }, {}, 'hardlink-reject');
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'SOURCE_HARDLINK_REJECTED');
    fs.rmSync(aliasPath, { force: true });
  }
  const staged = core._reserveImportStaging({ source_path: sourcePath }, 'source-binding-check');
  assert.throws(
    () => core._importAsset({ __staging_id: staged.id, source_path: otherPath, storage_mode: 'COPY' }),
    (error) => error?.code === 'STAGING_SOURCE_MISMATCH',
  );
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('rights identity, consent and effective-time revocation fail closed and remain append-only', () => {
  const { dbPath, directory } = tempDb();
  const sourcePath = path.join(directory, 'rights.txt');
  fs.writeFileSync(sourcePath, 'rights evidence', 'utf8');
  const core = new CoreService({ dbPath, assetStorePath: path.join(directory, 'asset-store') });
  const imported = execute(core, 'ImportAsset', { source_path: sourcePath, storage_mode: 'REFERENCE', asset_type: 'DOCUMENT' }, {}, 'rights-import');
  assert.equal(imported.ok, true);
  const asset = imported.result.asset;
  assert.equal(asset.rights.status, 'UNKNOWN');
  assert.ok(asset.rights.identity.id);
  const identityId = asset.rights.identity.id;

  const record = execute(core, 'CreateRightsRecord', {
    rights_identity_id: identityId, right_type: 'SOURCE_USE', status: 'ALLOWED', territory: ['VN'],
    purpose: { allowed: ['PRODUCTION'] }, evidence_summary: { source: 'test' },
  }, {}, 'rights-record');
  assert.equal(record.ok, true);
  const withoutConsent = core.handle(request('query.asset.rights', { asset_id: asset.id, territory: 'VN' }, 'rights-unknown'));
  assert.equal(withoutConsent.result.status, 'UNKNOWN');
  assert.equal(withoutConsent.result.blockers.some((blocker) => blocker.code === 'CONSENT_MISSING'), true);

  const consent = execute(core, 'RecordConsent', {
    rights_identity_id: identityId, consent_type: 'SOURCE_USE', granted_by: 'rights-holder',
    evidence_asset_revision_id: asset.latest_revision.id,
  }, {}, 'rights-consent');
  assert.equal(consent.ok, true);
  const allowed = core.handle(request('query.asset.rights', { asset_id: asset.id, territory: 'VN' }, 'rights-allowed'));
  assert.equal(allowed.result.status, 'ALLOWED');
  assert.equal(allowed.result.eligible, true);
  const restricted = core.handle(request('query.asset.rights', { asset_id: asset.id, territory: 'US' }, 'rights-restricted'));
  assert.equal(restricted.result.status, 'RESTRICTED');
  assert.equal(restricted.result.eligible, false);
  assert.equal(restricted.result.blockers.some((blocker) => blocker.code === 'RIGHTS_TERRITORY_RESTRICTED'), true);
  const details = core.handle(request('query.rights.identity', { rights_identity_id: identityId }, 'rights-details'));
  assert.equal(details.result.records[0].evidence_summary_present, true);
  assert.equal(JSON.stringify(details.result).includes('test'), false);

  const now = Number(core.db.prepare('SELECT created_at_utc_us FROM rights_records WHERE id = ?').get(record.result.record.id).created_at_utc_us);
  const revokeAt = now + 1_000_000;
  const revoked = execute(core, 'RevokeRights', { rights_identity_id: identityId, right_type: 'SOURCE_USE', reason: 'Consent withdrawn', effective_at_utc_us: revokeAt }, {}, 'rights-revoke');
  assert.equal(revoked.ok, true);
  const before = core.handle(request('query.rights.evaluate', { rights_identity_id: identityId, territory: 'VN', at_utc_us: revokeAt - 1 }, 'rights-before'));
  assert.equal(before.result.status, 'ALLOWED');
  const after = core.handle(request('query.rights.evaluate', { rights_identity_id: identityId, territory: 'VN', at_utc_us: revokeAt }, 'rights-after'));
  assert.equal(after.result.status, 'REVOKED');
  const replay = execute(core, 'RevokeRights', { rights_identity_id: identityId, right_type: 'SOURCE_USE', reason: 'Consent withdrawn', effective_at_utc_us: revokeAt }, {}, 'rights-revoke');
  assert.equal(replay.result.idempotent_replay, true);

  const expiredIdentity = execute(core, 'CreateRightsIdentity', { subject_type: 'PERSON', subject_id: 'person-expired' }, {}, 'rights-expired-identity');
  const expiredId = expiredIdentity.result.id;
  const expiredAt = now - 2_000_000;
  const expiredRecord = execute(core, 'CreateRightsRecord', {
    rights_identity_id: expiredId, right_type: 'SOURCE_USE', status: 'ALLOWED', valid_from_utc_us: expiredAt - 1_000_000, valid_to_utc_us: expiredAt,
  }, {}, 'rights-expired-record');
  assert.equal(expiredRecord.ok, true);
  const expiredConsent = execute(core, 'RecordConsent', {
    rights_identity_id: expiredId, consent_type: 'SOURCE_USE', granted_by: 'rights-holder', valid_from_utc_us: expiredAt - 1_000_000, valid_to_utc_us: expiredAt,
  }, {}, 'rights-expired-consent');
  assert.equal(expiredConsent.ok, true);
  const expired = core.handle(request('query.rights.evaluate', { rights_identity_id: expiredId }, 'rights-expired-eval'));
  assert.equal(expired.result.status, 'EXPIRED');
  assert.equal(expired.result.eligible, false);

  const closureIdentity = execute(core, 'CreateRightsIdentity', { subject_type: 'PERSON', subject_id: 'person-closure' }, {}, 'rights-closure-identity');
  const closureId = closureIdentity.result.id;
  assert.equal(execute(core, 'CreateRightsRecord', { rights_identity_id: closureId, right_type: 'SOURCE_USE', status: 'ALLOWED' }, {}, 'rights-closure-allowed').ok, true);
  assert.equal(execute(core, 'CreateRightsRecord', { rights_identity_id: closureId, right_type: 'SOURCE_USE', status: 'RESTRICTED' }, {}, 'rights-closure-restricted').ok, true);
  assert.equal(execute(core, 'RecordConsent', { rights_identity_id: closureId, consent_type: 'SOURCE_USE', granted_by: 'rights-holder' }, {}, 'rights-closure-consent').ok, true);
  const closure = core.handle(request('query.rights.evaluate', { rights_identity_id: closureId }, 'rights-closure-eval'));
  assert.equal(closure.result.status, 'RESTRICTED');
  assert.equal(closure.result.blockers.some((blocker) => blocker.code === 'RIGHTS_RECORD_RESTRICTED'), true);

  const projectA = execute(core, 'CreateProject', { title: 'Rights scope A' }, {}, 'rights-scope-a');
  const projectB = execute(core, 'CreateProject', { title: 'Rights scope B' }, {}, 'rights-scope-b');
  const scopedIdentity = execute(core, 'CreateRightsIdentity', { project_id: projectA.result.id, subject_type: 'PERSON', subject_id: 'person-scoped' }, {}, 'rights-scoped-identity');
  const scopeMismatch = execute(core, 'CreateRightsRecord', { project_id: projectB.result.id, rights_identity_id: scopedIdentity.result.id, right_type: 'SOURCE_USE', status: 'ALLOWED' }, {}, 'rights-scope-mismatch');
  assert.equal(scopeMismatch.ok, false);
  assert.equal(scopeMismatch.error.code, 'ENTITY_SCOPE_MISMATCH');
  assert.throws(() => core.db.prepare('UPDATE rights_records SET status = ? WHERE id = ?').run('ALLOWED', record.result.record.id), /rights_records are append-only/);
  assert.throws(() => core.db.prepare('DELETE FROM consents WHERE id = ?').run(consent.result.consent.id), /consents are append-only/);
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('local backup admission, artifact verification, tamper detection and replay are durable', () => {
  const { dbPath, directory } = tempDb();
  const assetStorePath = path.join(directory, 'asset-store');
  const sourcePath = path.join(directory, 'backup-source.txt');
  const backupRoot = path.join(directory, 'backup-output');
  const rejectedRoot = path.join(directory, 'backup-rejected');
  fs.writeFileSync(sourcePath, 'backup bytes\n', 'utf8');
  const core = new CoreService({ dbPath, assetStorePath });
  const project = execute(core, 'CreateProject', { title: 'Backup film', code: 'backup-film' }, {}, 'backup-project');
  const imported = execute(core, 'ImportAsset', {
    project_id: project.result.id,
    source_path: sourcePath,
    asset_type: 'DOCUMENT',
    storage_mode: 'COPY',
  }, {}, 'backup-import');
  assert.equal(imported.ok, true, JSON.stringify(imported));

  const created = execute(core, 'CreateBackup', {
    destination_path: backupRoot,
    durability_class: 'LOCAL_WRITABLE',
    reserve_bytes: 0,
  }, {}, 'backup-create');
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.result.backup.state, 'VERIFIED');
  assert.equal(created.result.backup.object_count, 1);
  assert.equal(created.result.verification.outcome, 'VERIFIED');
  assert.equal(created.result.verification.integrity_state, 'PASS');
  assert.equal(JSON.stringify(created.result).includes(backupRoot), false);

  const persisted = core.db.prepare('SELECT * FROM backups WHERE id = ?').get(created.result.backup.id);
  assert.ok(persisted);
  assert.equal(persisted.state, 'VERIFIED');
  assert.equal(fs.existsSync(persisted.manifest_path), true);
  assert.equal(fs.existsSync(persisted.snapshot_path), true);
  const manifest = JSON.parse(fs.readFileSync(persisted.manifest_path, 'utf8'));
  assert.equal(manifest.format_version, 1);
  assert.equal(manifest.schema_version, 14);
  assert.equal(manifest.objects.length, 1);
  assert.equal(manifest.objects[0].materialization, 'COPIED');
  assert.equal(fs.existsSync(path.join(persisted.destination_path, manifest.objects[0].relative_path)), true);

  const replay = execute(core, 'CreateBackup', {
    destination_path: backupRoot,
    durability_class: 'LOCAL_WRITABLE',
    reserve_bytes: 0,
  }, {}, 'backup-create');
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(replay.result.backup.id, created.result.backup.id);
  assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM backups').get().count, 1);
  assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM backup_verifications').get().count, 1);

  const list = core.handle(request('query.backup.list', { limit: 10 }, 'backup-list'));
  assert.equal(list.ok, true, JSON.stringify(list));
  const listed = list.result.backups ?? list.result.items;
  assert.equal(Array.isArray(listed), true);
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(list.result).includes(backupRoot), false);
  const detail = core.handle(request('query.backup.get', { backup_id: created.result.backup.id }, 'backup-detail'));
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.result.backup.id, created.result.backup.id);
  assert.equal(detail.result.verifications.length, 1);
  assert.equal(JSON.stringify(detail.result).includes(backupRoot), false);

  // A changed manifest must never be accepted as a valid backup. VerifyBackup
  // records a failed verification and keeps the append-only audit trail.
  fs.appendFileSync(persisted.manifest_path, '\n', 'utf8');
  const tampered = execute(core, 'VerifyBackup', { backup_id: created.result.backup.id }, {}, 'backup-verify-tamper');
  assert.equal(tampered.ok, true, JSON.stringify(tampered));
  assert.equal(tampered.result.verification.outcome, 'FAILED');
  assert.equal(tampered.result.verification.integrity_state, 'FAIL');
  assert.equal(tampered.result.backup.state, 'FAILED');
  assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM backup_verifications').get().count, 2);
  assert.throws(
    () => core.db.prepare('UPDATE backup_verifications SET outcome = ? WHERE id = ?').run('VERIFIED', tampered.result.verification.id),
    /backup_verifications are append-only/,
  );
  assert.throws(
    () => core.db.prepare('DELETE FROM backups WHERE id = ?').run(created.result.backup.id),
    /backups are append-only/,
  );

  const admission = core.handle(request('query.storage.admission', {
    destination_path: rejectedRoot,
    durability_class: 'LOCAL_WRITABLE',
    reserve_bytes: 0,
    max_backup_bytes: 1,
  }, 'backup-admission'));
  assert.equal(admission.ok, false);
  assert.equal(admission.error.code, 'STORAGE_PRESSURE');
  const rejected = execute(core, 'CreateBackup', {
    destination_path: rejectedRoot,
    durability_class: 'LOCAL_WRITABLE',
    reserve_bytes: 0,
    max_backup_bytes: 1,
  }, {}, 'backup-pressure');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'STORAGE_PRESSURE');
  assert.equal(fs.existsSync(rejectedRoot), false);

  const invalidReserveRoot = path.join(directory, 'backup-invalid-reserve');
  const invalidReserve = execute(core, 'CreateBackup', {
    destination_path: invalidReserveRoot,
    durability_class: 'LOCAL_WRITABLE',
    reserve_bytes: -1,
  }, {}, 'backup-invalid-reserve');
  assert.equal(invalidReserve.ok, false);
  assert.equal(invalidReserve.error.code, 'INVALID_ARGUMENT');
  assert.equal(fs.existsSync(invalidReserveRoot), false);

  const invalidDestination = execute(core, 'CreateBackup', {
    destination_path: 42,
    durability_class: 'LOCAL_WRITABLE',
    reserve_bytes: 0,
  }, {}, 'backup-invalid-destination');
  assert.equal(invalidDestination.ok, false);
  assert.equal(invalidDestination.error.code, 'INVALID_BACKUP_DESTINATION');

  const unsupportedDurability = execute(core, 'CreateBackup', {
    destination_path: path.join(directory, 'backup-offline'),
    durability_class: 'OFFLINE',
    reserve_bytes: 0,
  }, {}, 'backup-offline');
  assert.equal(unsupportedDurability.ok, false);
  assert.equal(unsupportedDurability.error.code, 'DURABILITY_PROFILE_UNAVAILABLE');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('character canon keeps identity, visual, voice and performance revisions separate and fail closed', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'Character film', code: 'character-film' }, {}, 'character-project');
  assert.equal(project.ok, true);
  const character = execute(core, 'CreateCharacter', {
    project_id: project.result.id,
    stable_code: 'otto',
    display_name: 'Otto',
  }, {}, 'character-create');
  assert.equal(character.ok, true, JSON.stringify(character));
  assert.equal(character.result.character.display_name, 'Otto');
  assert.equal(character.result.character.stable_code, 'OTTO');
  assert.equal(character.result.visual_identity, null);
  assert.equal(character.result.voice_identity, null);
  assert.equal(character.result.performance_bible, null);
  assert.equal(core.db.prepare('PRAGMA table_info(characters)').all().some((column) => column.name === 'voice_id'), false);

  const duplicate = execute(core, 'CreateCharacter', {
    project_id: project.result.id,
    stable_code: 'OTTO',
    display_name: 'Duplicate Otto',
  }, {}, 'character-duplicate');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'DUPLICATE_CHARACTER_CODE');

  const visual = execute(core, 'CreateVisualIdentityRevision', {
    character_id: character.result.character.id,
    semantic_description: 'Canonical neutral face and silhouette',
    anatomy: { species: 'human', face: 'angular' },
    forbidden_drift: { age_impression: 'stable' },
  }, {}, 'character-visual');
  assert.equal(visual.ok, true, JSON.stringify(visual));
  assert.equal(visual.result.revision.lifecycle_state, 'DRAFT');
  assert.equal(visual.result.revision.readiness_state, 'READY');
  const invalidVisualShape = execute(core, 'CreateVisualIdentityRevision', {
    character_id: character.result.character.id, anatomy: [],
  }, {}, 'character-visual-invalid-shape');
  assert.equal(invalidVisualShape.ok, false);
  assert.equal(invalidVisualShape.error.code, 'INVALID_ARGUMENT');
  const visualRevisionId = visual.result.revision.id;
  const candidate = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VISUAL', revision_id: visualRevisionId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'character-visual-candidate');
  assert.equal(candidate.ok, true, JSON.stringify(candidate));
  const stale = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VISUAL', revision_id: visualRevisionId, next_state: 'APPROVED',
  }, { REVISION: 1 }, 'character-visual-stale');
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_REVISION');
  const approvedVisual = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VISUAL', revision_id: visualRevisionId, next_state: 'APPROVED',
  }, { REVISION: 2 }, 'character-visual-approve');
  assert.equal(approvedVisual.ok, true, JSON.stringify(approvedVisual));
  assert.equal(approvedVisual.result.revision.lifecycle_state, 'APPROVED');
  assert.throws(
    () => core.db.prepare('UPDATE visual_identity_revisions SET anatomy_json = ? WHERE id = ?').run('{"tampered":true}', visualRevisionId),
    /visual_identity_revision content is immutable/,
  );
  const visualNext = execute(core, 'CreateVisualIdentityRevision', {
    character_id: character.result.character.id,
    semantic_description: 'Second canonical visual revision',
  }, {}, 'character-visual-next');
  assert.equal(visualNext.ok, true, JSON.stringify(visualNext));
  const visualNextId = visualNext.result.revision.id;
  assert.equal(execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VISUAL', revision_id: visualNextId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'character-visual-next-candidate').ok, true);
  const secondApprovedVisual = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VISUAL', revision_id: visualNextId, next_state: 'APPROVED',
  }, { REVISION: 2 }, 'character-visual-next-approve');
  assert.equal(secondApprovedVisual.ok, true, JSON.stringify(secondApprovedVisual));
  assert.equal(core.db.prepare('SELECT lifecycle_state FROM visual_identity_revisions WHERE id = ?').get(visualRevisionId).lifecycle_state, 'SUPERSEDED');
  const supersedeEvent = core.db.prepare('SELECT payload_json FROM domain_events WHERE command_id = ?').get(secondApprovedVisual.result.command_id);
  assert.equal(JSON.parse(supersedeEvent.payload_json).superseded_revision_id, visualRevisionId);

  const voice = execute(core, 'CreateVoiceIdentityRevision', {
    character_id: character.result.character.id,
    canonical_language: 'vi-VN',
    accent_profile: { region: 'north' },
    timbre: { register: 'warm' },
  }, {}, 'character-voice');
  assert.equal(voice.ok, true, JSON.stringify(voice));
  const voiceRevisionId = voice.result.revision.id;
  const voiceCandidate = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VOICE', revision_id: voiceRevisionId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'character-voice-candidate');
  assert.equal(voiceCandidate.ok, true, JSON.stringify(voiceCandidate));
  const blockedVoice = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VOICE', revision_id: voiceRevisionId, next_state: 'APPROVED',
  }, { REVISION: 2 }, 'character-voice-blocked');
  assert.equal(blockedVoice.ok, false);
  assert.equal(blockedVoice.error.code, 'RIGHTS_BLOCKED');
  assert.equal(blockedVoice.error.needs_user, true);

  const rightsIdentity = execute(core, 'CreateRightsIdentity', {
    project_id: project.result.id,
    subject_type: 'PERFORMER',
    subject_id: 'otto-performer',
  }, {}, 'character-rights-identity');
  assert.equal(rightsIdentity.ok, true, JSON.stringify(rightsIdentity));
  const rightsId = rightsIdentity.result.id;
  assert.equal(execute(core, 'CreateRightsRecord', {
    rights_identity_id: rightsId, right_type: 'SOURCE_USE', status: 'ALLOWED', purpose: { allowed: ['VOICE_IDENTITY'] },
  }, {}, 'character-rights-record').ok, true);
  assert.equal(execute(core, 'RecordConsent', {
    rights_identity_id: rightsId, consent_type: 'SOURCE_USE', granted_by: 'otto-performer',
  }, {}, 'character-rights-consent').ok, true);
  const voiceWithRights = execute(core, 'CreateVoiceIdentityRevision', {
    character_id: character.result.character.id, canonical_language: 'en-US', rights_identity_id: rightsId,
  }, {}, 'character-voice-rights');
  assert.equal(voiceWithRights.ok, true, JSON.stringify(voiceWithRights));
  const voiceRightsId = voiceWithRights.result.revision.id;
  assert.equal(execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VOICE', revision_id: voiceRightsId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'character-voice-rights-candidate').ok, true);
  const approvedVoice = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VOICE', revision_id: voiceRightsId, next_state: 'APPROVED',
  }, { REVISION: 2 }, 'character-voice-rights-approve');
  assert.equal(approvedVoice.ok, true, JSON.stringify(approvedVoice));
  assert.equal(approvedVoice.result.revision.rights.status, 'ALLOWED');

  const performance = execute(core, 'CreatePerformanceBibleRevision', {
    character_id: character.result.character.id,
    posture: { baseline: 'upright' }, gestures: { signature: ['touches ring'] },
    forbidden_drift: { energy: 'not frantic' },
  }, {}, 'character-performance');
  assert.equal(performance.ok, true, JSON.stringify(performance));
  assert.equal(performance.result.revision.readiness_state, 'READY');

  const workspace = core.handle(request('query.character.workspace', { character_id: character.result.character.id }, 'character-workspace'));
  assert.equal(workspace.ok, true, JSON.stringify(workspace));
  assert.equal(workspace.result.character.id, character.result.character.id);
  assert.equal(workspace.result.voice_identity.rights.status, 'ALLOWED');
  assert.equal(JSON.stringify(workspace.result).includes(dbPath), false);
  const list = core.handle(request('query.character.list', { project_id: project.result.id }, 'character-list'));
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.equal(list.result.characters.length, 1);
  assert.equal(list.result.characters[0].stable_code, 'OTTO');
  const crossProject = execute(core, 'CreateCharacter', {
    project_id: project.result.id,
    entity_type: 'PROJECT', entity_id: 'different-project', stable_code: 'BAD', display_name: 'Bad',
  }, {}, 'character-cross-scope');
  assert.equal(crossProject.ok, false);
  assert.equal(crossProject.error.code, 'ENTITY_SCOPE_MISMATCH');
  const lockedProject = execute(core, 'CreateProject', { title: 'Locked character film', code: 'locked-character-film' }, {}, 'character-locked-project');
  const lockedCharacter = execute(core, 'CreateCharacter', {
    project_id: lockedProject.result.id, stable_code: 'LOCKED', display_name: 'Locked',
  }, {}, 'character-locked-create');
  const lockedRevision = execute(core, 'CreateVisualIdentityRevision', {
    character_id: lockedCharacter.result.character.id, semantic_description: 'Before archive',
  }, {}, 'character-locked-revision');
  assert.equal(lockedRevision.ok, true, JSON.stringify(lockedRevision));
  const archived = execute(core, 'ArchiveProject', { project_id: lockedProject.result.id }, { PROJECT: 1 }, 'character-locked-archive');
  assert.equal(archived.ok, true, JSON.stringify(archived));
  const blockedCreate = execute(core, 'CreatePerformanceBibleRevision', {
    character_id: lockedCharacter.result.character.id, posture: { baseline: 'still' },
  }, {}, 'character-locked-performance');
  assert.equal(blockedCreate.ok, false);
  assert.equal(blockedCreate.error.code, 'PROJECT_NOT_WRITABLE');
  const blockedTransition = execute(core, 'TransitionCharacterRevision', {
    revision_type: 'VISUAL', revision_id: lockedRevision.result.revision.id, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'character-locked-transition');
  assert.equal(blockedTransition.ok, false);
  assert.equal(blockedTransition.error.code, 'PROJECT_NOT_WRITABLE');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('canonical timeline pins an approved media profile and stores immutable rational checkpoints', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'Timeline film', code: 'timeline-film' }, {}, 'timeline-project');
  const projectId = project.result.id;
  const profilePayload = {
    project_id: projectId,
    timeline_rate: { num: 24, den: 1 },
    time_base: { num: 1, den: 24 },
    width: 1920,
    height: 1080,
    pixel_aspect: { num: 1, den: 1 },
    working_color_space: 'sRGB',
    transfer_function: 'SDR',
    hdr_policy: 'NONE',
    audio_sample_rate: 48000,
    audio_channel_layout: 'STEREO',
  };
  const profile = execute(core, 'CreateMediaProfileRevision', profilePayload, {}, 'timeline-profile');
  assert.equal(profile.ok, true, JSON.stringify(profile));
  assert.equal(execute(core, 'CreateMediaProfileRevision', profilePayload, {}, 'timeline-profile').result.id, profile.result.id);
  const candidate = profile.result.candidate_revisions[0];
  const nestedProfile = execute(core, 'CreateMediaProfileRevision', {
    project_id: projectId,
    profile: {
      timeline_rate_num: 24000, timeline_rate_den: 1001,
      timeline_time_base_num: 1001, timeline_time_base_den: 24000,
      width: 1920, height: 1080, pixel_aspect_num: 1, pixel_aspect_den: 1,
      working_color_space: 'sRGB', transfer_function: 'SDR', hdr_policy: 'NONE',
      audio_sample_rate: 48000, audio_channel_layout: 'STEREO',
    },
  }, {}, 'timeline-profile-nested');
  assert.equal(nestedProfile.ok, true, JSON.stringify(nestedProfile));
  const reducedProfile = execute(core, 'CreateMediaProfileRevision', {
    project_id: projectId,
    timeline_rate: { num: 48, den: 2 },
    time_base: { num: 2, den: 48 },
    width: 1920, height: 1080, pixel_aspect: { num: 2, den: 2 },
    working_color_space: 'sRGB', transfer_function: 'SDR', hdr_policy: 'NONE',
    audio_sample_rate: 48000, audio_channel_layout: 'STEREO',
  }, {}, 'timeline-profile-reduced');
  assert.equal(reducedProfile.ok, true, JSON.stringify(reducedProfile));
  const reducedRevision = reducedProfile.result.candidate_revisions[0];
  assert.deepEqual(reducedRevision.timeline_rate, { num: 24, den: 1 });
  assert.deepEqual(reducedRevision.time_base, { num: 1, den: 24 });
  assert.deepEqual(reducedRevision.pixel_aspect, { num: 1, den: 1 });
  const approvedProfile = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId, revision_id: candidate.id, next_state: 'APPROVED',
  }, { REVISION: candidate.row_version }, 'timeline-profile-approve');
  assert.equal(approvedProfile.ok, true, JSON.stringify(approvedProfile));
  const mediaProfileRevisionId = approvedProfile.result.approved_revision.id;

  const timeline = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'MAIN', title: 'Main timeline', media_profile_revision_id: mediaProfileRevisionId,
  }, {}, 'timeline-create');
  assert.equal(timeline.ok, true, JSON.stringify(timeline));
  const timelineId = timeline.result.timeline.id;
  const checkpointPayload = {
    project_id: projectId,
    timeline_id: timelineId,
    media_profile_revision_id: mediaProfileRevisionId,
    duration: { num: 24000, den: 1000 },
    tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [
      { timeline_in: { num: 0, den: 1 }, timeline_out: { num: 12, den: 1 } },
      { timeline_in: { num: 12, den: 1 }, timeline_out: { num: 24, den: 1 } },
    ] }],
    markers: [{ time: { num: 6, den: 1 }, marker_type: 'NOTE', label: 'First beat', payload: { source: 'test' } }],
  };
  const checkpoint = execute(core, 'CreateTimelineRevision', checkpointPayload, { TIMELINE: 1 }, 'timeline-checkpoint');
  assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint));
  assert.equal(checkpoint.result.revision.duration.num, 24);
  assert.equal(checkpoint.result.revision.duration.den, 1);
  assert.equal(checkpoint.result.revision.tracks[0].clips.length, 2);
  assert.equal(checkpoint.result.revision.markers[0].label, 'First beat');
  const markerId = checkpoint.result.revision.markers[0].id;
  assert.throws(
    () => core.db.prepare('UPDATE timeline_markers SET label = ? WHERE id = ?').run('tampered', markerId),
    /timeline_markers are append-only/,
  );
  assert.throws(
    () => core.db.prepare('DELETE FROM timeline_markers WHERE id = ?').run(markerId),
    /timeline_markers are append-only/,
  );
  assert.equal(execute(core, 'CreateTimelineRevision', checkpointPayload, { TIMELINE: 1 }, 'timeline-checkpoint').result.idempotent_replay, true);
  const revisionId = checkpoint.result.revision.id;
  assert.equal(execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'timeline-candidate').ok, true);
  const reviewRequired = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'APPROVED',
  }, { REVISION: 2 }, 'timeline-approve-without-review');
  assert.equal(reviewRequired.ok, false);
  assert.equal(reviewRequired.error.code, 'REVIEW_REQUIRED_FOR_APPROVAL');
  const review = execute(core, 'OpenReview', {
    project_id: projectId, subject_type: 'TIMELINE_REVISION', subject_revision_id: revisionId,
  }, { REVISION: 2 }, 'timeline-review-open');
  assert.equal(review.ok, true, JSON.stringify(review));
  assert.equal(review.result.review.review_state, 'OPEN');
  assert.equal(execute(core, 'OpenReview', {
    project_id: projectId, subject_type: 'TIMELINE_REVISION', subject_revision_id: revisionId,
  }, { REVISION: 2 }, 'timeline-review-open-duplicate').error.code, 'REVIEW_ALREADY_OPEN');
  const staleReviewSubmit = execute(core, 'SubmitReview', {
    project_id: projectId, review_session_id: review.result.review.id, decision: 'APPROVE',
  }, { REVIEW_SESSION: 2 }, 'timeline-review-submit-stale');
  assert.equal(staleReviewSubmit.ok, false);
  assert.equal(staleReviewSubmit.error.code, 'STALE_REVIEW');
  const submittedReview = execute(core, 'SubmitReview', {
    project_id: projectId, review_session_id: review.result.review.id, decision: 'APPROVE',
  }, { REVIEW_SESSION: 1 }, 'timeline-review-submit');
  assert.equal(submittedReview.ok, true, JSON.stringify(submittedReview));
  assert.equal(submittedReview.result.review.human_review.decision, 'APPROVE');
  const missingSnapshot = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'APPROVED',
    review_session_id: review.result.review.id,
  }, { REVISION: 2 }, 'timeline-approve-missing-snapshot');
  assert.equal(missingSnapshot.ok, false);
  assert.equal(missingSnapshot.error.code, 'REVIEW_SNAPSHOT_REQUIRED');
  const approved = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'APPROVED',
    review_session_id: review.result.review.id,
    dependency_snapshot_hash: review.result.review.dependency_snapshot_hash,
  }, { REVISION: 2 }, 'timeline-approve');
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(approved.result.revision.lifecycle_state, 'APPROVED');
  const immutableReview = execute(core, 'SubmitReview', {
    project_id: projectId, review_session_id: review.result.review.id, decision: 'REJECT',
  }, { REVIEW_SESSION: 2 }, 'timeline-review-submit-after-approval');
  assert.equal(immutableReview.ok, false);
  assert.equal(immutableReview.error.code, 'REVIEW_DECISION_IMMUTABLE');
  const reviewList = core.handle(request('query.review.list', { project_id: projectId }, 'timeline-review-list'));
  assert.equal(reviewList.ok, true);
  assert.equal(reviewList.result.items.length, 1);
  assert.equal(reviewList.result.items[0].human_review.decision, 'APPROVE');
  const reviewDetails = core.handle(request('query.review.get', { project_id: projectId, review_session_id: review.result.review.id }, 'timeline-review-get'));
  assert.equal(reviewDetails.ok, true);
  assert.equal(reviewDetails.result.review.id, review.result.review.id);
  assert.throws(
    () => core.db.prepare('UPDATE timeline_revisions SET duration_num = ? WHERE id = ?').run(99, revisionId),
    /timeline_revision content is immutable/,
  );
  assert.throws(
    () => core.db.prepare('UPDATE human_reviews SET notes = ? WHERE id = ?').run('tampered', submittedReview.result.review.human_review.id),
    /human_reviews are append-only/,
  );
  const workspace = core.handle(request('query.timeline.workspace', { project_id: projectId, timeline_id: timelineId }));
  assert.equal(workspace.ok, true, JSON.stringify(workspace));
  assert.equal(workspace.result.approved_revision.id, revisionId);
  assert.equal(workspace.result.approved_revision.readiness_state, 'READY');

  const overlap = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timelineId, media_profile_revision_id: mediaProfileRevisionId,
    duration: { num: 24, den: 1 }, tracks: [{ track_type: 'VIDEO', clips: [
      { timeline_in: { num: 0, den: 1 }, timeline_out: { num: 2, den: 1 } },
      { timeline_in: { num: 3, den: 2 }, timeline_out: { num: 3, den: 1 } },
    ] }],
  }, { TIMELINE: 4 }, 'timeline-overlap');
  assert.equal(overlap.ok, false);
  assert.equal(overlap.error.code, 'TIMELINE_CLIP_OVERLAP');
  const unsupported = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timelineId, media_profile_revision_id: mediaProfileRevisionId,
    duration: { num: 24, den: 1 }, tracks: [{ track_type: 'AUDIO', clips: [] }],
  }, { TIMELINE: 4 }, 'timeline-audio');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'UNSUPPORTED_TIMELINE_TRACK');
  const secondCheckpoint = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timelineId, media_profile_revision_id: mediaProfileRevisionId,
    duration: { num: 12, den: 1 }, tracks: [{ track_type: 'VIDEO', clips: [] }], markers: [],
  }, { TIMELINE: 4 }, 'timeline-checkpoint-second');
  assert.equal(secondCheckpoint.ok, true, JSON.stringify(secondCheckpoint));
  const secondRevisionId = secondCheckpoint.result.revision.id;
  assert.equal(execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: secondRevisionId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'timeline-candidate-second').ok, true);
  const secondReview = execute(core, 'OpenReview', {
    project_id: projectId, subject_type: 'TIMELINE_REVISION', subject_revision_id: secondRevisionId,
  }, { REVISION: 2 }, 'timeline-review-open-second');
  assert.equal(secondReview.ok, true, JSON.stringify(secondReview));
  const secondSubmittedReview = execute(core, 'SubmitReview', {
    project_id: projectId, review_session_id: secondReview.result.review.id, decision: 'APPROVE',
  }, { REVIEW_SESSION: 1 }, 'timeline-review-submit-second');
  assert.equal(secondSubmittedReview.ok, true, JSON.stringify(secondSubmittedReview));
  const secondApproved = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: secondRevisionId, next_state: 'APPROVED',
    review_session_id: secondReview.result.review.id,
    dependency_snapshot_hash: secondReview.result.review.dependency_snapshot_hash,
  }, { REVISION: 2 }, 'timeline-approve-second');
  assert.equal(secondApproved.ok, true, JSON.stringify(secondApproved));
  assert.equal(core.db.prepare('SELECT lifecycle_state FROM timeline_revisions WHERE id = ?').get(revisionId).lifecycle_state, 'SUPERSEDED');
  const timelineSupersedeEvent = core.db.prepare('SELECT payload_json FROM domain_events WHERE command_id = ?').get(secondApproved.result.command_id);
  assert.equal(JSON.parse(timelineSupersedeEvent.payload_json).superseded_revision_id, revisionId);
  const secondProfile = execute(core, 'CreateMediaProfileRevision', { ...profilePayload, width: 1280 }, {}, 'timeline-profile-second');
  assert.equal(secondProfile.ok, true, JSON.stringify(secondProfile));
  const invalidProfile = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'SECOND', title: 'Second', media_profile_revision_id: secondProfile.result.candidate_revisions[0].id,
  }, {}, 'timeline-unapproved-profile');
  assert.equal(invalidProfile.ok, false);
  assert.equal(invalidProfile.error.code, 'MEDIA_PROFILE_NOT_APPROVED');
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('handoff manifest binds exact approval, sanitizes metadata, and stays conservative for unknown targets', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const project = execute(core, 'CreateProject', { title: 'Handoff film', code: 'handoff-film' }, {}, 'handoff-project');
  const projectId = project.result.id;
  const profile = execute(core, 'CreateMediaProfileRevision', {
    project_id: projectId, timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 },
    width: 1920, height: 1080, pixel_aspect: { num: 1, den: 1 }, working_color_space: 'sRGB',
    transfer_function: 'SDR', hdr_policy: 'NONE', audio_sample_rate: 48000, audio_channel_layout: 'STEREO',
  }, {}, 'handoff-profile');
  const profileCandidate = profile.result.candidate_revisions[0];
  const approvedProfile = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId, revision_id: profileCandidate.id, next_state: 'APPROVED',
  }, { REVISION: 1 }, 'handoff-profile-approve');
  const profileId = approvedProfile.result.approved_revision.id;
  const timeline = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'MAIN', title: 'Handoff timeline', media_profile_revision_id: profileId,
  }, {}, 'handoff-timeline');
  const timelineId = timeline.result.timeline.id;
  const checkpoint = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timelineId, media_profile_revision_id: profileId,
    duration: { num: 24, den: 1 }, tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [] }],
    markers: [{ time: { num: 6, den: 1 }, marker_type: 'NOTE', label: 'Export marker', payload: { prompt: 'must not leak' } }],
  }, { TIMELINE: 1 }, 'handoff-checkpoint');
  const revisionId = checkpoint.result.revision.id;
  assert.equal(execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'CANDIDATE',
  }, { REVISION: 1 }, 'handoff-candidate').ok, true);
  const opened = execute(core, 'OpenReview', {
    project_id: projectId, subject_revision_id: revisionId, subject_type: 'TIMELINE_REVISION',
  }, { REVISION: 2 }, 'handoff-review-open');
  const submitted = execute(core, 'SubmitReview', {
    project_id: projectId, review_session_id: opened.result.review.id, decision: 'APPROVE',
  }, { REVIEW_SESSION: 1 }, 'handoff-review-submit');
  const snapshotHash = submitted.result.review.dependency_snapshot_hash;
  assert.equal(execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'APPROVED',
    review_session_id: opened.result.review.id, dependency_snapshot_hash: snapshotHash,
  }, { REVISION: 2 }, 'handoff-approve').ok, true);

  const missingSnapshot = execute(core, 'CreateHandoffManifest', {
    project_id: projectId, timeline_revision_id: revisionId, review_session_id: opened.result.review.id,
    target_editor: 'UNKNOWN_EDITOR', target_version: '9', target_profile: 'GENERIC_INTERCHANGE',
  }, { REVISION: 3 }, 'handoff-missing-snapshot');
  assert.equal(missingSnapshot.ok, false);
  assert.equal(missingSnapshot.error.code, 'HANDOFF_SNAPSHOT_REQUIRED');

  const created = execute(core, 'CreateHandoffManifest', {
    project_id: projectId, timeline_revision_id: revisionId, review_session_id: opened.result.review.id,
    dependency_snapshot_hash: snapshotHash, target_editor: 'UNKNOWN_EDITOR', target_version: '9',
    target_profile: 'GENERIC_INTERCHANGE',
  }, { REVISION: 3 }, 'handoff-create');
  assert.equal(created.ok, true, JSON.stringify(created));
  const session = created.result.export_session;
  const manifest = created.result.handoff_manifest;
  assert.equal(session.state, 'PREFLIGHT');
  assert.equal(manifest.compatibility.editable_claim, false);
  assert.ok(manifest.compatibility.entries.every((entry) => ['UNKNOWN', 'UNSUPPORTED'].includes(entry.status)));
  assert.equal(manifest.sanitizationReport.recorded, true);
  assert.ok(manifest.sanitizationReport.removedFields.includes('absolute_local_paths'));
  assert.equal(Object.hasOwn(manifest.manifest, 'manifest_id'), false);
  assert.equal(Object.hasOwn(manifest.manifest, 'export_session_id'), false);
  assert.equal(JSON.stringify(manifest.manifest), JSON.stringify(JSON.parse(JSON.stringify(manifest.manifest))));
  assert.equal(created.result.manifest_hash, crypto.createHash('sha256').update(JSON.stringify(manifest.manifest), 'utf8').digest('hex'));
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('storage_uri'), false);
  assert.equal(serialized.includes('file://'), false);
  assert.equal(serialized.includes('must not leak'), false);

  const replay = execute(core, 'CreateHandoffManifest', {
    project_id: projectId, timeline_revision_id: revisionId, review_session_id: opened.result.review.id,
    dependency_snapshot_hash: snapshotHash, target_editor: 'UNKNOWN_EDITOR', target_version: '9',
    target_profile: 'GENERIC_INTERCHANGE',
  }, { REVISION: 3 }, 'handoff-create');
  assert.equal(replay.ok, true);
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(replay.result.handoff_manifest.manifest_hash, manifest.manifest_hash);
  const listed = core.handle(request('query.handoff.list', { project_id: projectId }, 'handoff-list'));
  assert.equal(listed.ok, true);
  assert.equal(listed.result.items.length, 1);
  const details = core.handle(request('query.handoff.get', { project_id: projectId, handoff_id: session.id }, 'handoff-get'));
  assert.equal(details.ok, true);
  assert.equal(details.result.handoff_manifest.manifest_hash, manifest.manifest_hash);
  assert.throws(
    () => core.db.prepare('UPDATE handoff_manifests SET manifest_json = ? WHERE id = ?').run('{}', manifest.id),
    /handoff_manifests are append-only/,
  );
  assert.throws(
    () => core.db.prepare('DELETE FROM export_sessions WHERE id = ?').run(session.id),
    /export_sessions are append-only/,
  );
  core.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
