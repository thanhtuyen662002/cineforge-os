import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-release-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite') };
}

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, command_type, payload, expected_versions = {}, idempotency_key = command_type) {
  return core.handle(request('command.execute', {
    command_type, payload, expected_versions, idempotency_key,
  }, `${command_type}-${idempotency_key}`));
}

function createApprovedTimeline(core) {
  const project = execute(core, 'CreateProject', { title: 'Readiness film', code: 'readiness-film' }, {}, 'project');
  assert.equal(project.ok, true, JSON.stringify(project));
  const projectId = project.result.id;
  const profile = execute(core, 'CreateMediaProfileRevision', {
    project_id: projectId, timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 },
    width: 1920, height: 1080, pixel_aspect: { num: 1, den: 1 }, working_color_space: 'sRGB',
    transfer_function: 'SDR', hdr_policy: 'NONE', audio_sample_rate: 48000, audio_channel_layout: 'STEREO',
  }, {}, 'profile');
  assert.equal(profile.ok, true, JSON.stringify(profile));
  const profileCandidate = profile.result.candidate_revisions[0];
  const approvedProfile = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId, revision_id: profileCandidate.id, next_state: 'APPROVED',
  }, { REVISION: profileCandidate.row_version }, 'profile-approve');
  assert.equal(approvedProfile.ok, true, JSON.stringify(approvedProfile));
  const profileId = approvedProfile.result.approved_revision.id;
  const timeline = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'MAIN', title: 'Main timeline', media_profile_revision_id: profileId,
  }, {}, 'timeline');
  assert.equal(timeline.ok, true, JSON.stringify(timeline));
  const timelineId = timeline.result.timeline.id;
  const checkpoint = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timelineId, media_profile_revision_id: profileId,
    duration: { num: 24, den: 1 }, tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [
      { timeline_in: { num: 0, den: 1 }, timeline_out: { num: 12, den: 1 } },
      { timeline_in: { num: 12, den: 1 }, timeline_out: { num: 24, den: 1 } },
    ] }], markers: [],
  }, { TIMELINE: 1 }, 'checkpoint');
  assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint));
  const revisionId = checkpoint.result.revision.id;
  assert.equal(execute(core, 'TransitionTimelineRevision', { project_id: projectId, timeline_revision_id: revisionId, next_state: 'CANDIDATE' }, { REVISION: 1 }, 'candidate').ok, true);
  const review = execute(core, 'OpenReview', { project_id: projectId, subject_type: 'TIMELINE_REVISION', subject_revision_id: revisionId }, { REVISION: 2 }, 'review-open');
  assert.equal(review.ok, true, JSON.stringify(review));
  const submitted = execute(core, 'SubmitReview', { project_id: projectId, review_session_id: review.result.review.id, decision: 'APPROVE' }, { REVIEW_SESSION: 1 }, 'review-submit');
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  const approved = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId, timeline_revision_id: revisionId, next_state: 'APPROVED', review_session_id: review.result.review.id,
    dependency_snapshot_hash: review.result.review.dependency_snapshot_hash,
  }, { REVISION: 2 }, 'timeline-approve');
  assert.equal(approved.ok, true, JSON.stringify(approved));
  return { projectId, timelineId, revisionId };
}

test('release readiness is deterministic, exact-revision scoped, and fail-closed', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const { projectId } = createApprovedTimeline(core);
    const first = core.handle(request('query.release.readiness', { project_id: projectId }, 'readiness-1'));
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.result.overall_state, 'READY', JSON.stringify(first));
    assert.equal(first.result.gates.length, 8);
    assert.deepEqual(first.result.gates.map((gate) => gate.key), ['PICTURE', 'AUDIO', 'LOCALIZATION', 'TECHNICAL_MEDIA', 'QC', 'RIGHTS', 'MISSING_MEDIA', 'UNRESOLVED_DECISIONS']);
    assert.deepEqual(first.result.gates.map((gate) => gate.state), ['PASS', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'PASS', 'PASS', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'PASS']);
    assert.equal(first.result.blocking_count, 0);
    assert.equal(first.result.unknown_count, 0);
    assert.match(first.result.gate_manifest_hash, /^[0-9a-f]{64}$/);
    assert.equal(first.result.exact_source.timeline_revision_id, first.result.gates[0].evidence.timeline_revision_id);
    const second = core.handle(request('query.release.readiness', { project_id: projectId }, 'readiness-2'));
    assert.equal(second.result.gate_manifest_hash, first.result.gate_manifest_hash);

    const empty = execute(core, 'CreateProject', { title: 'Empty readiness', code: 'empty-readiness' }, {}, 'empty-project');
    const emptyReadiness = core.handle(request('query.release.readiness', { project_id: empty.result.id }, 'readiness-empty'));
    assert.equal(emptyReadiness.ok, true);
    assert.equal(emptyReadiness.result.overall_state, 'NOT_CHECKED');
    assert.equal(emptyReadiness.result.gates.every((gate) => gate.state === 'UNKNOWN' || gate.state === 'PASS'), true);
    assert.equal(emptyReadiness.result.policy.unknown_blocks, true);

    const missing = core.handle(request('query.release.readiness', { project_id: 'missing-project' }, 'readiness-missing'));
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'NOT_FOUND');
    assert.equal(missing.error.user_message_key, 'errors.project_not_found');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('release readiness exposes mixed gate states, blocks open decisions, and isolates project scope', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const fixture = createApprovedTimeline(core);
    const revision = core._timelineRevision(fixture.revisionId);
    const subtitle = execute(core, 'CreateSubtitleTrackRevision', {
      project_id: fixture.projectId,
      timeline_id: fixture.timelineId,
      timing_dependency_revision_id: fixture.revisionId,
      timing_dependency_content_hash: revision.content_hash,
      locale: 'vi-VN',
      title: 'Draft subtitle keeps localization UNKNOWN.',
      segments: [{ start: { num: 0, den: 1 }, end: { num: 1, den: 1 }, text: 'Bản nháp' }],
    }, {}, 'mixed-subtitle');
    assert.equal(subtitle.ok, true, JSON.stringify(subtitle));
    const task = execute(core, 'CreateTask', { project_id: fixture.projectId, title: 'Resolve release blocker' }, {}, 'mixed-task');
    assert.equal(task.ok, true, JSON.stringify(task));
    const decision = execute(core, 'CreateDecisionRequest', {
      project_id: fixture.projectId,
      decision_type: 'RIGHTS_REVIEW',
      title_key: 'decisions.rights.title',
      reason_key: 'decisions.rights.reason',
      reason_args: { asset_count: 1 },
      blocking_scope_type: 'TASK',
      blocking_scope_id: task.result.id,
      severity: 'HIGH',
      affected_entities: [{ entity_type: 'TASK', entity_id: task.result.id }],
      evidence: [{ kind: 'RIGHTS_SUMMARY', status: 'UNKNOWN' }],
      default_behavior: { action: 'DO_NOTHING', label_key: 'decisions.default_do_nothing' },
      choices: [{ id: 'hold', label_key: 'decisions.choice.hold' }],
    }, {}, 'mixed-decision');
    assert.equal(decision.ok, true, JSON.stringify(decision));

    const mixed = core.handle(request('query.release.readiness', { project_id: fixture.projectId }, 'readiness-mixed'));
    assert.equal(mixed.ok, true, JSON.stringify(mixed));
    assert.equal(mixed.result.overall_state, 'BLOCKED');
    const mixedStates = new Map(mixed.result.gates.map((gate) => [gate.key, gate.state]));
    assert.equal(mixedStates.get('PICTURE'), 'PASS');
    assert.equal(mixedStates.get('LOCALIZATION'), 'UNKNOWN');
    assert.equal(mixedStates.get('UNRESOLVED_DECISIONS'), 'FAIL');
    assert.equal(mixed.result.exact_source.timeline_revision_id, fixture.revisionId);
    assert.equal(mixed.result.exact_source.media_profile_revision_id, revision.media_profile_revision_id);
    assert.equal(typeof mixed.result.exact_source.review_session_id, 'string');
    assert.equal(mixed.result.gates.find((gate) => gate.key === 'UNRESOLVED_DECISIONS').evidence.items[0].id, decision.result.id);

    const other = execute(core, 'CreateProject', { title: 'Other film', code: 'other-film' }, {}, 'other-project');
    assert.equal(other.ok, true, JSON.stringify(other));
    const isolated = core.handle(request('query.release.readiness', { project_id: other.result.id }, 'readiness-isolated'));
    assert.equal(isolated.ok, true, JSON.stringify(isolated));
    assert.equal(isolated.result.exact_source.timeline_revision_id, null);
    assert.equal(isolated.result.exact_source.media_profile_revision_id, null);
    assert.equal(isolated.result.gates.find((gate) => gate.key === 'UNRESOLVED_DECISIONS').state, 'PASS');
    assert.equal(isolated.result.gates.find((gate) => gate.key === 'UNRESOLVED_DECISIONS').evidence.count, 0);
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP readiness mapping strips path/provider fields and preserves gate states', async () => {
  const fakeCore = {
    handle: () => ({ ok: true, result: {
      project_id: 'project-1', project_title: 'Film', overall_state: 'NOT_CHECKED', policy: { purpose: 'RELEASE', unknown_blocks: true },
      exact_source: { timeline_id: 'timeline-1', local_path: 'C:\\secret\\cut.mov', provider_uri: 'https://provider.invalid/file' },
      gates: [
        { key: 'PICTURE', state: 'PASS', blocking: false, evidence: { clip_count: 2, provider_path: 'C:\\secret\\provider' } },
        { key: 'QC', state: 'UNKNOWN', blocking: true, reason: 'QC_NOT_SUBMITTED', evidence: { review_count: 0 } },
        { key: 'INTERNAL_SECRET', state: 'PASS', blocking: false, evidence: { local_path: 'C:\\secret' } },
      ], blocking_gate_keys: ['QC'], blocking_count: 1, unknown_count: 1, gate_manifest_hash: 'a'.repeat(64), projection_seq: 7,
    } }),
  };
  const listener = await listenCoreHttp(fakeCore, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const response = await fetch(`${base}/v1/projects/project-1/release/readiness`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.overallState, 'NOT_CHECKED');
    assert.deepEqual(body.result.gates.map((gate) => gate.key), ['PICTURE', 'QC']);
    assert.deepEqual(body.result.gates[0].evidence, { clip_count: 2 });
    assert.deepEqual(body.result.exactSource, { timeline_id: 'timeline-1' });
    assert.equal(JSON.stringify(body).includes('secret'), false);
    assert.equal(JSON.stringify(body).includes('provider'), false);
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
  }
});
