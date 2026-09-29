import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-working-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite') };
}

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, commandType, payload, expectedVersions = {}, idempotencyKey) {
  const workingCommand = new Set(['ApplyTimelineEditOp', 'UndoTimelineEditOp', 'RedoTimelineEditOp', 'AutosaveTimelineWorkingSession', 'CheckpointTimelineWorkingSession', 'CloseTimelineWorkingSession']);
  const commandPayload = workingCommand.has(commandType) && payload.client_instance_id === undefined && payload.clientInstanceId === undefined
    ? { ...payload, client_instance_id: 'test-client-1' }
    : payload;
  return core.handle(request('command.execute', {
    command_type: commandType,
    payload: commandPayload,
    expected_versions: expectedVersions,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  }, `${commandType}-${idempotencyKey ?? Math.random()}`));
}

function fixture() {
  const { directory, dbPath } = tempDb();
  const core = new CoreService({ dbPath });
  const projectResult = execute(core, 'CreateProject', { title: 'Working timeline', code: 'working-timeline' }, {}, 'working-project');
  assert.equal(projectResult.ok, true, JSON.stringify(projectResult));
  const projectId = projectResult.result.id;
  const profileResult = execute(core, 'CreateMediaProfileRevision', {
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
  }, {}, 'working-profile');
  assert.equal(profileResult.ok, true, JSON.stringify(profileResult));
  const profileCandidate = profileResult.result.candidate_revisions[0];
  const approvedProfile = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId,
    revision_id: profileCandidate.id,
    next_state: 'APPROVED',
  }, { REVISION: profileCandidate.row_version }, 'working-profile-approve');
  assert.equal(approvedProfile.ok, true, JSON.stringify(approvedProfile));
  const profileId = approvedProfile.result.approved_revision.id;
  const timelineResult = execute(core, 'CreateTimeline', {
    project_id: projectId,
    code: 'MAIN',
    title: 'Main working timeline',
    media_profile_revision_id: profileId,
  }, {}, 'working-timeline-create');
  assert.equal(timelineResult.ok, true, JSON.stringify(timelineResult));
  const timeline = timelineResult.result.timeline;
  const baseResult = execute(core, 'CreateTimelineRevision', {
    project_id: projectId,
    timeline_id: timeline.id,
    media_profile_revision_id: profileId,
    duration: { num: 24, den: 1 },
    tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [] }],
    markers: [],
  }, { TIMELINE: timeline.row_version }, 'working-base');
  assert.equal(baseResult.ok, true, JSON.stringify(baseResult));
  const base = baseResult.result.revision;
  // Creating the first immutable revision advances the timeline aggregate.
  // Keep the fixture's expected version aligned with the returned projection.
  timeline.row_version = baseResult.result.timeline.row_version;
  return {
    core,
    directory,
    projectId,
    profileId,
    timeline,
    base,
    cleanup() {
      core.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function begin(fixtureValue, key = 'working-begin', clientInstanceId = 'test-client-1') {
  const { core, projectId, timeline, base } = fixtureValue;
  const result = execute(core, 'BeginTimelineWorkingSession', {
    project_id: projectId,
    timeline_id: timeline.id,
    base_revision_id: base.id,
    base_revision_row_version: base.row_version,
    base_content_hash: base.content_hash,
    client_instance_id: clientInstanceId,
    mode: 'EXCLUSIVE',
  }, { TIMELINE: timeline.row_version }, key);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.session.state, 'OPEN');
  assert.equal(result.result.session.base_revision_id, base.id);
  assert.equal(result.result.session.base_revision_row_version, base.row_version);
  assert.equal(result.result.session.draft_hash, result.result.session.autosaved_hash);
  return result.result.session;
}

function markerOperation(time = 4, id = 'marker-1', clientOpId = null) {
  return {
    op_type: 'ADD_MARKER',
    id,
    time: { num: time, den: 1 },
    marker_type: 'NOTE',
    label: `Marker ${id}`,
    ...(clientOpId ? { client_op_id: clientOpId } : {}),
  };
}

function applyMarker(fixtureValue, session, operation = markerOperation(), key = 'working-apply') {
  const { core, projectId } = fixtureValue;
  const result = execute(core, 'ApplyTimelineEditOp', {
    project_id: projectId,
    working_session_id: session.id,
    operation,
  }, { WORKING_SESSION: session.row_version }, key);
  return result;
}

test('timeline working session begins from an exact base and rejects stale or duplicate ownership', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const missingIdempotencyKey = execute(value.core, 'BeginTimelineWorkingSession', {
    project_id: value.projectId,
    timeline_id: value.timeline.id,
    base_revision_id: value.base.id,
    base_revision_row_version: value.base.row_version,
    base_content_hash: value.base.content_hash,
    client_instance_id: 'test-client-1',
    mode: 'EXCLUSIVE',
  }, { TIMELINE: value.timeline.row_version });
  assert.equal(missingIdempotencyKey.ok, false);
  assert.equal(missingIdempotencyKey.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const session = begin(value);
  assert.equal(session.mode, 'EXCLUSIVE');
  assert.equal(session.last_acknowledged_op_seq, 0);
  assert.equal(session.history_cursor_seq, 0);
  assert.equal(session.next_op_seq, 1);

  const duplicate = execute(value.core, 'BeginTimelineWorkingSession', {
    project_id: value.projectId,
    timeline_id: value.timeline.id,
    base_revision_id: value.base.id,
    base_revision_row_version: value.base.row_version,
    base_content_hash: value.base.content_hash,
    client_instance_id: 'other-client',
  }, { TIMELINE: value.timeline.row_version }, 'working-begin-duplicate');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'TIMELINE_WORKING_SESSION_ALREADY_OPEN');

  const staleBase = execute(value.core, 'BeginTimelineWorkingSession', {
    project_id: value.projectId,
    timeline_id: value.timeline.id,
    base_revision_id: value.base.id,
    base_revision_row_version: value.base.row_version + 1,
    base_content_hash: value.base.content_hash,
    client_instance_id: 'stale-client',
  }, { TIMELINE: value.timeline.row_version }, 'working-begin-stale-base');
  assert.equal(staleBase.ok, false);
  assert.equal(staleBase.error.code, 'STALE_REVISION');
});

test('timeline working mutations remain bound to the session timeline', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const session = begin(value, 'working-begin-scope');
  const mismatchedOperation = execute(value.core, 'ApplyTimelineEditOp', {
    project_id: value.projectId,
    timeline_id: 'timeline-from-another-route',
    working_session_id: session.id,
    operation: markerOperation(2, 'scope-marker'),
  }, { WORKING_SESSION: session.row_version }, 'working-scope-mismatch-op');
  assert.equal(mismatchedOperation.ok, false);
  assert.equal(mismatchedOperation.error.code, 'ENTITY_SCOPE_MISMATCH');
  assert.equal(Number(value.core.db.prepare('SELECT COUNT(*) AS count FROM timeline_edit_ops WHERE working_session_id = ?').get(session.id).count), 0);

  const mismatchedClose = execute(value.core, 'CloseTimelineWorkingSession', {
    project_id: value.projectId,
    timeline_id: 'timeline-from-another-route',
    working_session_id: session.id,
    disposition: 'ABANDON',
  }, { WORKING_SESSION: session.row_version }, 'working-scope-mismatch-close');
  assert.equal(mismatchedClose.ok, false);
  assert.equal(mismatchedClose.error.code, 'ENTITY_SCOPE_MISMATCH');
  const stillOpen = value.core.db.prepare('SELECT state FROM timeline_working_sessions WHERE id = ?').get(session.id);
  assert.equal(stillOpen.state, 'OPEN');
});

test('timeline working operations are audited, idempotent, and stale-safe', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const session = begin(value, 'working-begin-ops');
  const operation = markerOperation(5, 'marker-idempotent', 'client-op-1');
  const applied = applyMarker(value, session, operation, 'working-apply-1');
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.result.session.state, 'DIRTY');
  assert.equal(applied.result.session.last_acknowledged_op_seq, 1);
  assert.equal(applied.result.session.history_cursor_seq, 1);
  assert.equal(applied.result.session.next_op_seq, 2);
  assert.equal(applied.result.session.draft.markers.length, 1);
  assert.equal(applied.result.accepted_operations[0].client_op_id, 'client-op-1');
  assert.deepEqual(applied.result.impact_summary.dependent_domains, ['SUBTITLES', 'AUDIO', 'LIP_SYNC', 'MUSIC', 'RELEASE_READINESS']);
  assert.equal(applied.result.impact_summary.dependency_state, 'NOT_RECOMPUTED_UNTIL_CHECKPOINT');

  // Idempotent retries must carry the original optimistic version tuple. The
  // command ledger replays before aggregate-version validation and therefore
  // returns the exact prior projection without creating another operation.
  const replay = applyMarker(value, session, operation, 'working-apply-1');
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(replay.result.session.row_version, applied.result.session.row_version);

  const changedKey = applyMarker(value, session, markerOperation(6, 'marker-changed', 'client-op-1'), 'working-apply-1');
  assert.equal(changedKey.ok, false);
  assert.equal(changedKey.error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');

  const stale = execute(value.core, 'ApplyTimelineEditOp', {
    project_id: value.projectId,
    working_session_id: session.id,
    operation: markerOperation(7, 'marker-stale'),
  }, { WORKING_SESSION: session.row_version }, 'working-apply-stale');
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_REVISION');
  const persisted = value.core.db.prepare('SELECT COUNT(*) AS count FROM timeline_edit_ops WHERE working_session_id = ?').get(session.id);
  assert.equal(Number(persisted.count), 1);

  const unsupported = execute(value.core, 'ApplyTimelineEditOp', {
    project_id: value.projectId,
    working_session_id: session.id,
    operation: { op_type: 'ADD_TRANSITION', transition_id: 'transition-1' },
  }, { WORKING_SESSION: applied.result.session.row_version }, 'working-unsupported');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'UNSUPPORTED_TIMELINE_EDIT_OPERATION');
  assert.throws(
    () => value.core.db.prepare('UPDATE timeline_edit_ops SET history_state = ? WHERE working_session_id = ? AND op_seq = 1').run('UNDONE', session.id),
    /timeline_edit_op content is immutable/,
  );
});

test('timeline working marker payloads are bounded and trim rejects fields for the opposite edge', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const session = begin(value, 'working-begin-marker-shape');
  const directMarker = applyMarker(value, session, {
    op_type: 'ADD_MARKER', id: 'direct-marker', time: { num: 2, den: 1 }, marker_type: 'NOTE', label: 'Direct',
    payload: { semantic: 'beat' },
  }, 'working-direct-marker');
  assert.equal(directMarker.ok, true, JSON.stringify(directMarker));
  assert.deepEqual(directMarker.result.session.draft.markers[0].payload, { semantic: 'beat' });
  const invalidTrim = execute(value.core, 'ApplyTimelineEditOp', {
    project_id: value.projectId, working_session_id: session.id,
    operation: { op_type: 'TRIM_CLIP', payload: { clip_id: 'missing', edge: 'IN', timeline_in: { num: 1, den: 1 }, timeline_out: { num: 2, den: 1 } } },
  }, { WORKING_SESSION: directMarker.result.session.row_version }, 'working-trim-opposite-edge');
  assert.equal(invalidTrim.ok, false);
  assert.equal(invalidTrim.error.code, 'INVALID_ARGUMENT');
});

test('timeline working undo and redo restore exact rational draft snapshots and invalidate redo after a branch', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const session = begin(value, 'working-begin-history');
  const first = applyMarker(value, session, markerOperation(4, 'marker-first'), 'working-history-1');
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = applyMarker(value, first.result.session, markerOperation(8, 'marker-second'), 'working-history-2');
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.result.session.draft.markers.length, 2);

  const undone = execute(value.core, 'UndoTimelineEditOp', {
    project_id: value.projectId,
    working_session_id: session.id,
  }, { WORKING_SESSION: second.result.session.row_version }, 'working-undo');
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.result.session.history_cursor_seq, 1);
  assert.equal(undone.result.session.draft.markers.length, 1);
  assert.equal(undone.result.undone_operation.op_seq, 2);
  assert.equal(undone.result.session.history_actions.at(-1).action_type, 'UNDO');

  const redone = execute(value.core, 'RedoTimelineEditOp', {
    project_id: value.projectId,
    working_session_id: session.id,
  }, { WORKING_SESSION: undone.result.session.row_version }, 'working-redo');
  assert.equal(redone.ok, true, JSON.stringify(redone));
  assert.equal(redone.result.session.history_cursor_seq, 2);
  assert.equal(redone.result.session.draft.markers.length, 2);
  assert.deepEqual(redone.result.session.draft.markers.map((marker) => marker.id), ['marker-first', 'marker-second']);
  assert.equal(redone.result.session.history_actions.at(-1).action_type, 'REDO');

  const undoneAgain = execute(value.core, 'UndoTimelineEditOp', {
    project_id: value.projectId,
    working_session_id: session.id,
  }, { WORKING_SESSION: redone.result.session.row_version }, 'working-undo-branch');
  assert.equal(undoneAgain.ok, true, JSON.stringify(undoneAgain));
  const branched = applyMarker(value, undoneAgain.result.session, markerOperation(12, 'marker-branch'), 'working-history-branch');
  assert.equal(branched.ok, true, JSON.stringify(branched));
  assert.equal(branched.result.session.draft.markers.length, 2);
  assert.ok(branched.result.session.history_actions.some((action) => action.action_type === 'DISCARD_REDO_BRANCH'));
  const noRedo = execute(value.core, 'RedoTimelineEditOp', {
    project_id: value.projectId,
    working_session_id: session.id,
  }, { WORKING_SESSION: branched.result.session.row_version }, 'working-redo-invalidated');
  assert.equal(noRedo.ok, false);
  assert.equal(noRedo.error.code, 'TIMELINE_NO_REDO');
});

test('timeline working autosave, checkpoint, close and reload preserve exact hashes', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const session = begin(value, 'working-begin-checkpoint');
  const applied = applyMarker(value, session, markerOperation(10, 'marker-checkpoint'), 'working-checkpoint-apply');
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const dirty = applied.result.session;
  assert.notEqual(dirty.draft_hash, dirty.autosaved_hash);

  const notSaved = execute(value.core, 'CheckpointTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: dirty.id,
    expected_timeline_version: value.timeline.row_version,
  }, { WORKING_SESSION: dirty.row_version, TIMELINE: value.timeline.row_version }, 'working-checkpoint-before-autosave');
  assert.equal(notSaved.ok, false);
  assert.equal(notSaved.error.code, 'TIMELINE_DRAFT_NOT_AUTOSAVED');

  const autosaved = execute(value.core, 'AutosaveTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: dirty.id,
  }, { WORKING_SESSION: dirty.row_version }, 'working-autosave');
  assert.equal(autosaved.ok, true, JSON.stringify(autosaved));
  assert.equal(autosaved.result.session.state, 'CLEAN');
  assert.equal(autosaved.result.session.draft_hash, autosaved.result.session.autosaved_hash);
  assert.equal(autosaved.result.session.last_autosave_at !== null, true);

  const checkpoint = execute(value.core, 'CheckpointTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: dirty.id,
    expected_timeline_version: value.timeline.row_version,
  }, { WORKING_SESSION: autosaved.result.session.row_version, TIMELINE: value.timeline.row_version }, 'working-checkpoint');
  assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint));
  assert.equal(checkpoint.result.session.state, 'CLEAN');
  assert.ok(checkpoint.result.checkpoint_revision_id);
  assert.equal(checkpoint.result.checkpoint_revision.lifecycle_state, 'DRAFT_CHECKPOINT');
  assert.equal(checkpoint.result.session.last_checkpoint_revision_id, checkpoint.result.checkpoint_revision_id);
  assert.equal(checkpoint.result.checkpoint_revision.content_hash, checkpoint.result.session.draft_hash);
  assert.equal(checkpoint.result.session.base_revision_id, checkpoint.result.checkpoint_revision_id);
  assert.equal(checkpoint.result.session.base_revision_row_version, checkpoint.result.checkpoint_revision.row_version);
  assert.equal(checkpoint.result.session.base_content_hash, checkpoint.result.checkpoint_revision.content_hash);
  assert.equal(checkpoint.result.timeline.row_version, value.timeline.row_version + 1);

  const postCheckpoint = applyMarker(value, checkpoint.result.session, markerOperation(18, 'marker-after-checkpoint'), 'working-checkpoint-follow-up');
  assert.equal(postCheckpoint.ok, true, JSON.stringify(postCheckpoint));
  const undoneToCheckpoint = execute(value.core, 'UndoTimelineEditOp', {
    project_id: value.projectId, working_session_id: dirty.id,
  }, { WORKING_SESSION: postCheckpoint.result.session.row_version }, 'working-checkpoint-undo-follow-up');
  assert.equal(undoneToCheckpoint.ok, true, JSON.stringify(undoneToCheckpoint));
  assert.equal(undoneToCheckpoint.result.session.state, 'CLEAN');
  assert.equal(undoneToCheckpoint.result.session.draft_hash, undoneToCheckpoint.result.session.autosaved_hash);
  assert.equal(undoneToCheckpoint.result.session.base_revision_id, checkpoint.result.checkpoint_revision_id);

  const closed = execute(value.core, 'CloseTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: dirty.id,
    disposition: 'SAVE',
  }, { WORKING_SESSION: undoneToCheckpoint.result.session.row_version }, 'working-close');
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.result.session.state, 'CLOSED');
  assert.equal(closed.result.session.closed_at !== null, true);

  const queried = value.core.handle(request('query.timeline.working_session', {
    project_id: value.projectId,
    working_session_id: dirty.id,
  }, 'working-query'));
  assert.equal(queried.ok, true, JSON.stringify(queried));
  assert.equal(queried.result.session.id, dirty.id);
  assert.equal(queried.result.session.state, 'CLOSED');
  assert.equal(queried.result.session.draft_hash, closed.result.session.draft_hash);
  assert.equal(queried.result.session.operations.length, 2);
});

test('timeline working close requires an explicit disposition and never silently saves dirty drafts', (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const session = begin(value, 'working-begin-close');
  const applied = applyMarker(value, session, markerOperation(3, 'marker-close'), 'working-close-apply');
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const missingDisposition = execute(value.core, 'CloseTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: session.id,
  }, { WORKING_SESSION: applied.result.session.row_version }, 'working-close-missing');
  assert.equal(missingDisposition.ok, false);
  assert.equal(missingDisposition.error.code, 'TIMELINE_CLOSE_DISPOSITION_REQUIRED');

  const unsavedSave = execute(value.core, 'CloseTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: session.id,
    disposition: 'SAVE',
  }, { WORKING_SESSION: applied.result.session.row_version }, 'working-close-unsaved-save');
  assert.equal(unsavedSave.ok, false);
  assert.equal(unsavedSave.error.code, 'TIMELINE_DRAFT_NOT_AUTOSAVED');

  const kept = execute(value.core, 'CloseTimelineWorkingSession', {
    project_id: value.projectId,
    working_session_id: session.id,
    disposition: 'ABANDON',
  }, { WORKING_SESSION: applied.result.session.row_version }, 'working-close-keep-draft');
  assert.equal(kept.ok, true, JSON.stringify(kept));
  assert.equal(kept.result.session.state, 'ABANDONED');
  assert.equal(kept.result.session.draft_hash, applied.result.session.draft_hash);
});
