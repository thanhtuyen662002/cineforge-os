import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-release-candidate-'));
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
  const project = execute(core, 'CreateProject', { title: 'Candidate film', code: 'candidate-film' }, {}, 'project');
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

test('release candidate drafts bind exact readiness, stay idempotent, and cancel with a row fence', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const fixture = createApprovedTimeline(core);
    const malformed = execute(core, 'CreateReleaseCandidateDraft', {
      project_id: { local_path: 'C:\\secret\\candidate.json' }, generated: 'https://provider.invalid/raw',
    }, {}, 'candidate-malformed');
    assert.equal(malformed.ok, false, JSON.stringify(malformed));
    assert.equal(malformed.error.code, 'INVALID_ARGUMENT');
    const malformedCommand = core.db.prepare('SELECT status, payload_json FROM commands WHERE idempotency_key = ?').get('candidate-malformed');
    assert.equal(malformedCommand.status, 'FAILED');
    assert.equal(malformedCommand.payload_json.includes('secret'), false);
    const created = execute(core, 'CreateReleaseCandidateDraft', { project_id: fixture.projectId }, {}, 'candidate-create');
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.result.state, 'DRAFT');
    assert.equal(created.result.project_id, fixture.projectId);
    assert.equal(created.result.timeline_revision_id, fixture.revisionId);
    assert.equal(created.result.row_version, 1);
    assert.match(created.result.readiness_digest, /^[0-9a-f]{64}$/);
    assert.match(created.result.rights_snapshot_hash, /^[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(created.result, 'readiness_snapshot_json'), false);
    assert.equal(Object.hasOwn(created.result, 'subtitle_manifest_json'), false);
    const stored = core.db.prepare('SELECT * FROM release_candidates WHERE id = ?').get(created.result.id);
    assert.equal(stored.state, 'DRAFT');
    assert.equal(stored.readiness_snapshot_schema_version, 1);
    assert.equal(JSON.parse(stored.readiness_snapshot_json).gates.length, 8);
    assert.equal(JSON.stringify(stored).includes('local_path'), false);
    assert.equal(JSON.stringify(stored).includes('provider'), false);

    const replay = execute(core, 'CreateReleaseCandidateDraft', { project_id: fixture.projectId }, {}, 'candidate-create');
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.result.id, created.result.id);
    assert.equal(replay.result.idempotent_replay, true);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM release_candidates').get().count, 1);
    const duplicate = execute(core, 'CreateReleaseCandidateDraft', { project_id: fixture.projectId }, {}, 'candidate-create-second');
    assert.equal(duplicate.ok, false, JSON.stringify(duplicate));
    assert.equal(duplicate.error.code, 'RELEASE_CANDIDATE_ALREADY_EXISTS');

    const listed = core.handle(request('query.release.candidate.list', { project_id: fixture.projectId }, 'candidate-list'));
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(listed.result.items.length, 1);
    assert.equal(listed.result.items[0].id, created.result.id);
    const found = core.handle(request('query.release.candidate.get', { project_id: fixture.projectId, release_candidate_id: created.result.id }, 'candidate-get'));
    assert.equal(found.ok, true, JSON.stringify(found));
    assert.equal(found.result.candidate.id, created.result.id);
    assert.equal(Object.hasOwn(found.result.candidate, 'readiness_snapshot_json'), false);
    const unscopedGet = core.handle(request('query.release.candidate.get', { release_candidate_id: created.result.id }, 'candidate-unscoped-get'));
    assert.equal(unscopedGet.ok, false, JSON.stringify(unscopedGet));
    assert.equal(unscopedGet.error.code, 'INVALID_ARGUMENT');

    const cancelled = execute(core, 'CancelReleaseCandidateDraft', {
      project_id: fixture.projectId, release_candidate_id: created.result.id,
    }, { RELEASE_CANDIDATE: 1 }, 'candidate-cancel');
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    assert.equal(cancelled.result.state, 'CANCELLED');
    assert.equal(cancelled.result.row_version, 2);
    const stale = execute(core, 'CancelReleaseCandidateDraft', {
      project_id: fixture.projectId, release_candidate_id: created.result.id,
    }, { RELEASE_CANDIDATE: 1 }, 'candidate-cancel-stale');
    assert.equal(stale.ok, false, JSON.stringify(stale));
    assert.equal(stale.error.code, 'STALE_REVISION');
    const unscopedCancel = execute(core, 'CancelReleaseCandidateDraft', {
      release_candidate_id: created.result.id,
    }, { RELEASE_CANDIDATE: 1 }, 'candidate-cancel-unscoped');
    assert.equal(unscopedCancel.ok, false, JSON.stringify(unscopedCancel));
    assert.equal(unscopedCancel.error.code, 'INVALID_ARGUMENT');
    const terminal = execute(core, 'CancelReleaseCandidateDraft', {
      project_id: fixture.projectId, release_candidate_id: created.result.id,
    }, { RELEASE_CANDIDATE: 2 }, 'candidate-cancel-terminal');
    assert.equal(terminal.ok, false, JSON.stringify(terminal));
    assert.equal(terminal.error.code, 'RELEASE_CANDIDATE_NOT_CANCELLABLE');
    const cancelReplay = execute(core, 'CancelReleaseCandidateDraft', {
      project_id: fixture.projectId, release_candidate_id: created.result.id,
    }, { RELEASE_CANDIDATE: 1 }, 'candidate-cancel');
    assert.equal(cancelReplay.ok, true, JSON.stringify(cancelReplay));
    assert.equal(cancelReplay.result.idempotent_replay, true);
    const activity = core.handle(request('query.project.activity', { project_id: fixture.projectId }, 'candidate-activity'));
    assert.equal(activity.ok, true, JSON.stringify(activity));
    assert.ok(activity.result.events.some((event) => event.aggregate_type === 'RELEASE_CANDIDATE' && event.event_type === 'RELEASE_CANDIDATE_DRAFT_CREATED'));
    const summary = core.handle(request('query.project.summary', { project_id: fixture.projectId }, 'candidate-summary'));
    assert.equal(summary.ok, true, JSON.stringify(summary));
    assert.ok(summary.result.activity.some((event) => event.aggregate_type === 'RELEASE_CANDIDATE'));
    assert.throws(
      () => core.db.prepare('UPDATE release_candidates SET timeline_revision_id = ? WHERE id = ?').run('tampered', created.result.id),
      /release_candidate identity is immutable/,
    );
    assert.throws(
      () => core.db.prepare('DELETE FROM release_candidates WHERE id = ?').run(created.result.id),
      /release_candidates are retained for audit/,
    );
    assert.throws(
      () => core.db.prepare("UPDATE release_candidates SET state = 'DRAFT' WHERE id = ?").run(created.result.id),
      /cancelled release_candidates are terminal/,
    );

    const other = execute(core, 'CreateProject', { title: 'Candidate other', code: 'candidate-other' }, {}, 'candidate-other');
    const crossProjectCancel = execute(core, 'CancelReleaseCandidateDraft', {
      project_id: other.result.id, release_candidate_id: created.result.id,
    }, { RELEASE_CANDIDATE: 1 }, 'candidate-cancel-cross-project');
    assert.equal(crossProjectCancel.ok, false, JSON.stringify(crossProjectCancel));
    assert.equal(crossProjectCancel.error.code, 'ENTITY_SCOPE_MISMATCH');
    const isolated = core.handle(request('query.release.candidate.get', { project_id: other.result.id, release_candidate_id: created.result.id }, 'candidate-scope'));
    assert.equal(isolated.ok, false);
    assert.equal(isolated.error.code, 'ENTITY_SCOPE_MISMATCH');
    const blocked = execute(core, 'CreateReleaseCandidateDraft', { project_id: other.result.id }, {}, 'candidate-blocked');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, 'RELEASE_READINESS_BLOCKED');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('release build plan freezes exact candidate evidence without creating master bytes', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const fixture = createApprovedTimeline(core);
    const candidate = execute(core, 'CreateReleaseCandidateDraft', { project_id: fixture.projectId }, {}, 'build-plan-candidate');
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    const plan = execute(core, 'CreateReleaseBuildPlan', {
      project_id: fixture.projectId,
      release_candidate_id: candidate.result.id,
      local_path: 'C:\\secret\\master.mov',
      provider_uri: 'https://provider.invalid/output',
      generated_payload: { secret: true },
    }, { RELEASE_CANDIDATE: candidate.result.row_version }, 'build-plan-create');
    assert.equal(plan.ok, true, JSON.stringify(plan));
    assert.equal(plan.result.state, 'PLANNED');
    assert.equal(plan.result.project_id, fixture.projectId);
    assert.equal(plan.result.release_candidate_id, candidate.result.id);
    assert.equal(plan.result.timeline_revision_id, fixture.revisionId);
    assert.match(plan.result.plan_hash, /^[0-9a-f]{64}$/);
    assert.match(plan.result.readiness_digest, /^[0-9a-f]{64}$/);
    assert.match(plan.result.rights_snapshot_hash, /^[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(plan.result, 'plan_snapshot_json'), false);
    assert.equal(Object.hasOwn(plan.result, 'master_asset_revision_id'), false);
    const storedCommand = core.db.prepare('SELECT payload_json FROM commands WHERE idempotency_key = ?').get('build-plan-create');
    assert.equal(storedCommand.payload_json.includes('secret'), false);
    assert.equal(storedCommand.payload_json.includes('provider'), false);
    const stored = core.db.prepare('SELECT * FROM release_build_plans WHERE id = ?').get(plan.result.id);
    assert.equal(stored.state, 'PLANNED');
    assert.equal(stored.plan_snapshot_schema_version, 1);
    assert.equal(JSON.stringify(stored).includes('master.mov'), false);
    assert.equal(JSON.stringify(stored).includes('provider.invalid'), false);
    assert.equal(JSON.parse(stored.plan_snapshot_json).output.master_asset_revision_id, null);

    const replay = execute(core, 'CreateReleaseBuildPlan', {
      project_id: fixture.projectId, release_candidate_id: candidate.result.id,
      local_path: 'C:\\secret\\master.mov', provider_uri: 'https://provider.invalid/output', generated_payload: { secret: true },
    }, { RELEASE_CANDIDATE: 1 }, 'build-plan-create');
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.result.id, plan.result.id);
    assert.equal(replay.result.idempotent_replay, true);
    const duplicate = execute(core, 'CreateReleaseBuildPlan', {
      project_id: fixture.projectId, release_candidate_id: candidate.result.id,
    }, { RELEASE_CANDIDATE: 1 }, 'build-plan-create-second');
    assert.equal(duplicate.ok, false, JSON.stringify(duplicate));
    assert.equal(duplicate.error.code, 'RELEASE_BUILD_PLAN_ALREADY_EXISTS');
    assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM release_build_plans').get().count, 1);

    const listed = core.handle(request('query.release.build_plan.list', { project_id: fixture.projectId }, 'build-plan-list'));
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(listed.result.items.length, 1);
    assert.equal(listed.result.items[0].id, plan.result.id);
    const found = core.handle(request('query.release.build_plan.get', { project_id: fixture.projectId, release_build_plan_id: plan.result.id }, 'build-plan-get'));
    assert.equal(found.ok, true, JSON.stringify(found));
    assert.equal(found.result.build_plan.plan_hash, plan.result.plan_hash);
    assert.equal(Object.hasOwn(found.result.build_plan, 'plan_snapshot_json'), false);
    const other = execute(core, 'CreateProject', { title: 'Build plan other', code: 'build-plan-other' }, {}, 'build-plan-other-project');
    const isolated = core.handle(request('query.release.build_plan.get', { project_id: other.result.id, release_build_plan_id: plan.result.id }, 'build-plan-scope'));
    assert.equal(isolated.ok, false, JSON.stringify(isolated));
    assert.equal(isolated.error.code, 'ENTITY_SCOPE_MISMATCH');
    assert.ok(core.handle(request('query.project.activity', { project_id: fixture.projectId }, 'build-plan-activity')).result.events
      .some((event) => event.aggregate_type === 'RELEASE_BUILD_PLAN' && event.event_type === 'RELEASE_BUILD_PLAN_CREATED'));
    assert.ok(core.handle(request('query.project.summary', { project_id: fixture.projectId }, 'build-plan-summary')).result.activity
      .some((event) => event.aggregate_type === 'RELEASE_BUILD_PLAN'));
    assert.throws(
      () => core.db.prepare('UPDATE release_build_plans SET plan_hash = ? WHERE id = ?').run('f'.repeat(64), plan.result.id),
      /release_build_plan identity is immutable/,
    );
    assert.throws(
      () => core.db.prepare('UPDATE release_build_plans SET next_step = ? WHERE id = ?').run('tampered', plan.result.id),
      /release_build_plan identity is immutable/,
    );
    assert.throws(
      () => core.db.prepare('UPDATE release_build_plans SET row_version = 2 WHERE id = ?').run(plan.result.id),
      /release_build_plan identity is immutable/,
    );
    assert.throws(
      () => core.db.prepare('DELETE FROM release_build_plans WHERE id = ?').run(plan.result.id),
      /release_build_plans are retained for audit/,
    );
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP release candidate routes preserve scope, idempotency and redact stored evidence', async () => {
  const candidate = {
    id: 'candidate-1', project_id: 'project-1', timeline_revision_id: 'revision-1',
    media_profile_revision_id: 'profile-1', review_session_id: 'review-1',
    readiness_digest: 'a'.repeat(64), rights_snapshot_hash: 'b'.repeat(64),
    state: 'DRAFT', row_version: 1, readiness_snapshot_schema_version: 1,
    next_step: 'metadata only', created_at: '2026-09-29T00:00:00.000Z',
    readiness_snapshot_json: '{"local_path":"C:\\secret"}', provider_uri: 'https://provider.invalid',
  };
  const buildPlan = {
    id: 'build-plan-1', project_id: 'project-1', release_candidate_id: 'candidate-1',
    timeline_revision_id: 'revision-1', media_profile_revision_id: 'profile-1', review_session_id: 'review-1',
    readiness_digest: 'c'.repeat(64), rights_snapshot_hash: 'd'.repeat(64), plan_hash: 'e'.repeat(64),
    state: 'PLANNED', row_version: 1, plan_snapshot_schema_version: 1,
    next_step: 'certified renderer required', plan_snapshot_json: '{"local_path":"C:\\secret"}', provider_uri: 'https://provider.invalid',
  };
  const calls = [];
  const fakeCore = {
    handle: (requestValue) => {
      calls.push(requestValue);
      if (requestValue.method === 'query.release.candidate.list') return { ok: true, result: { items: [candidate], projection_seq: 4 } };
      if (requestValue.method === 'query.release.candidate.get') return { ok: true, result: { candidate } };
      if (requestValue.method === 'query.release.build_plan.list') return { ok: true, result: { items: [buildPlan], projection_seq: 5 } };
      if (requestValue.method === 'query.release.build_plan.get') return { ok: true, result: { build_plan: buildPlan } };
      if (requestValue.method === 'command.execute' && requestValue.params.command_type === 'CreateReleaseCandidateDraft') return { ok: true, result: candidate };
      if (requestValue.method === 'command.execute' && requestValue.params.command_type === 'CancelReleaseCandidateDraft') return { ok: true, result: { ...candidate, state: 'CANCELLED', row_version: 2 } };
      if (requestValue.method === 'command.execute' && requestValue.params.command_type === 'CreateReleaseBuildPlan') return { ok: true, result: buildPlan };
      return { ok: false, error: { code: 'NOT_FOUND', category: 'VALIDATION', user_message_key: 'errors.not_found', needs_user: true } };
    },
  };
  const listener = await listenCoreHttp(fakeCore, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  try {
    const listed = await fetch(`${base}/v1/projects/project-1/release/candidates`);
    assert.equal(listed.status, 200);
    const listBody = await listed.json();
    assert.equal(listBody.result.items[0].id, 'candidate-1');
    assert.equal(listBody.result.items[0].state, 'DRAFT');
    assert.equal(Object.hasOwn(listBody.result.items[0], 'readinessSnapshotJson'), false);
    assert.equal(JSON.stringify(listBody).includes('secret'), false);
    assert.equal(JSON.stringify(listBody).includes('provider'), false);
    const found = await fetch(`${base}/v1/projects/project-1/release/candidates/candidate-1`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).result.candidate.id, 'candidate-1');
    const create = await fetch(`${base}/v1/projects/project-1/release/candidates`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'candidate-http-create' }, body: '{}',
    });
    assert.equal(create.status, 200);
    assert.equal((await create.json()).result.id, 'candidate-1');
    const cancel = await fetch(`${base}/v1/projects/project-1/release/candidates/candidate-1/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'candidate-http-cancel' }, body: JSON.stringify({ expected_version: 1 }),
    });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).result.state, 'CANCELLED');
    const command = calls.find((item) => item.method === 'command.execute' && item.params.command_type === 'CancelReleaseCandidateDraft');
    assert.equal(command.params.expected_versions.RELEASE_CANDIDATE, 1);
    assert.equal(command.params.idempotency_key, 'candidate-http-cancel');
    const plans = await fetch(`${base}/v1/projects/project-1/release/build-plans`);
    assert.equal(plans.status, 200);
    const plansBody = await plans.json();
    assert.equal(plansBody.result.items[0].id, 'build-plan-1');
    assert.equal(plansBody.result.items[0].state, 'PLANNED');
    assert.equal(Object.hasOwn(plansBody.result.items[0], 'planSnapshotJson'), false);
    assert.equal(JSON.stringify(plansBody).includes('secret'), false);
    assert.equal(JSON.stringify(plansBody).includes('provider'), false);
    const plan = await fetch(`${base}/v1/projects/project-1/release/build-plans/build-plan-1`);
    assert.equal(plan.status, 200);
    assert.equal((await plan.json()).result.buildPlan.planHash, 'e'.repeat(64));
    const planCreate = await fetch(`${base}/v1/projects/project-1/release/build-plans`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'build-plan-http-create' },
      body: JSON.stringify({ release_candidate_id: 'candidate-1', expected_version: 1 }),
    });
    assert.equal(planCreate.status, 200);
    assert.equal((await planCreate.json()).result.id, 'build-plan-1');
    const planCommand = calls.find((item) => item.method === 'command.execute' && item.params.command_type === 'CreateReleaseBuildPlan');
    assert.equal(planCommand.params.expected_versions.RELEASE_CANDIDATE, 1);
    assert.equal(planCommand.params.idempotency_key, 'build-plan-http-create');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
  }
});
