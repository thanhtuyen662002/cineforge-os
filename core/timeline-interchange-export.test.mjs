import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { canonicalJson } from './canonical.mjs';
import { listenCoreHttp } from './http.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-interchange-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite') };
}

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, commandType, payload, expectedVersions = {}, idempotencyKey = commandType) {
  return core.handle(request('command.execute', {
    command_type: commandType,
    payload,
    expected_versions: expectedVersions,
    idempotency_key: idempotencyKey,
  }, `${commandType}-${idempotencyKey}`));
}

function createApprovedHandoff(core, code = 'interchange-film') {
  const project = execute(core, 'CreateProject', { title: 'Interchange film', code }, {}, `${code}-project`);
  assert.equal(project.ok, true, JSON.stringify(project));
  const projectId = project.result.id;
  const profile = execute(core, 'CreateMediaProfileRevision', {
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
  }, {}, `${code}-profile`);
  assert.equal(profile.ok, true, JSON.stringify(profile));
  const profileCandidate = profile.result.candidate_revisions[0];
  const approvedProfile = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId,
    revision_id: profileCandidate.id,
    next_state: 'APPROVED',
  }, { REVISION: profileCandidate.row_version }, `${code}-profile-approve`);
  assert.equal(approvedProfile.ok, true, JSON.stringify(approvedProfile));
  const profileId = approvedProfile.result.approved_revision.id;
  const timeline = execute(core, 'CreateTimeline', {
    project_id: projectId,
    code: 'MAIN',
    title: 'Main timeline',
    media_profile_revision_id: profileId,
  }, {}, `${code}-timeline`);
  assert.equal(timeline.ok, true, JSON.stringify(timeline));
  const checkpoint = execute(core, 'CreateTimelineRevision', {
    project_id: projectId,
    timeline_id: timeline.result.timeline.id,
    media_profile_revision_id: profileId,
    duration: { num: 24, den: 1 },
    tracks: [{
      track_type: 'VIDEO',
      order_index: 0,
      name: 'Picture',
      clips: [
        { timeline_in: { num: 0, den: 1 }, timeline_out: { num: 12, den: 1 } },
        { timeline_in: { num: 12, den: 1 }, timeline_out: { num: 24, den: 1 } },
      ],
    }],
    markers: [{ time: { num: 12, den: 1 }, marker_type: 'NOTE', label: 'Middle' }],
  }, { TIMELINE: 1 }, `${code}-checkpoint`);
  assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint));
  const revisionId = checkpoint.result.revision.id;
  const candidate = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId,
    timeline_revision_id: revisionId,
    next_state: 'CANDIDATE',
  }, { REVISION: 1 }, `${code}-candidate`);
  assert.equal(candidate.ok, true, JSON.stringify(candidate));
  const review = execute(core, 'OpenReview', {
    project_id: projectId,
    subject_type: 'TIMELINE_REVISION',
    subject_revision_id: revisionId,
  }, { REVISION: 2 }, `${code}-review-open`);
  assert.equal(review.ok, true, JSON.stringify(review));
  const submitted = execute(core, 'SubmitReview', {
    project_id: projectId,
    review_session_id: review.result.review.id,
    decision: 'APPROVE',
  }, { REVIEW_SESSION: 1 }, `${code}-review-submit`);
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  const approved = execute(core, 'TransitionTimelineRevision', {
    project_id: projectId,
    timeline_revision_id: revisionId,
    next_state: 'APPROVED',
    review_session_id: review.result.review.id,
    dependency_snapshot_hash: review.result.review.dependency_snapshot_hash,
  }, { REVISION: 2 }, `${code}-timeline-approve`);
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const handoff = execute(core, 'CreateHandoffManifest', {
    project_id: projectId,
    timeline_revision_id: revisionId,
    review_session_id: review.result.review.id,
    dependency_snapshot_hash: review.result.review.dependency_snapshot_hash,
    target_editor: 'GENERIC',
    target_version: '1',
    target_profile: 'GENERIC_INTERCHANGE',
  }, { REVISION: 3 }, `${code}-handoff`);
  assert.equal(handoff.ok, true, JSON.stringify(handoff));
  return { projectId, revisionId, reviewId: review.result.review.id, session: handoff.result.export_session };
}

test('builds a verified, deterministic, idempotent timeline interchange artifact and serves scoped ranges', async () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const fixture = createApprovedHandoff(core);
    const buildPayload = {
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      dependency_snapshot_hash: fixture.session.dependency_snapshot_hash,
    };
    const expected = { EXPORT_SESSION: fixture.session.row_version };
    const built = execute(core, 'BuildTimelineInterchangeExport', buildPayload, expected, 'interchange-build');
    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.result.export_session.state, 'COMPLETED');
    assert.match(built.result.output_content_hash, /^[a-f0-9]{64}$/);
    assert.equal(built.result.output_byte_size, built.result.asset.latest_revision.storage_object.byte_size);
    assert.equal(built.result.asset.latest_revision.semantic_role, 'TIMELINE_INTERCHANGE');
    assert.equal(built.result.asset.latest_revision.storage_object.storage_class, 'LOCAL_MANAGED');
    assert.equal(built.result.export_session.validation_snapshot.document_hash, built.result.output_content_hash);
    const storedStaging = core.db.prepare('SELECT * FROM staging_objects WHERE command_id = ?').get(built.result.command_id);
    assert.equal(storedStaging.state, 'REGISTERED');
    const location = core.db.prepare(`SELECT l.* FROM storage_object_locations l
      JOIN storage_objects o ON o.id = l.storage_object_id WHERE o.content_hash = ? AND l.location_role = 'PRIMARY'`).get(built.result.output_content_hash);
    assert.ok(location);
    const outputPath = path.join(core.assetStorePath, location.relative_path);
    const bytes = fs.readFileSync(outputPath, 'utf8');
    const document = JSON.parse(bytes);
    assert.equal(bytes, canonicalJson(document));
    assert.equal(document.manifest_type, 'CINEFORGE_TIMELINE_INTERCHANGE');
    assert.equal(document.source.timeline_revision_id, fixture.revisionId);
    assert.equal(document.source.tracks[0].clips.length, 2);
    assert.equal(document.source.markers[0].label, 'Middle');
    assert.equal(crypto.createHash('sha256').update(bytes, 'utf8').digest('hex'), built.result.output_content_hash);

    const replay = execute(core, 'BuildTimelineInterchangeExport', buildPayload, expected, 'interchange-build');
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.result.idempotent_replay, true);
    assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM asset_revisions WHERE semantic_role = ?').get('TIMELINE_INTERCHANGE').count, 1);

    const duplicate = execute(core, 'BuildTimelineInterchangeExport', buildPayload, { EXPORT_SESSION: built.result.export_session.row_version }, 'interchange-build-second');
    assert.equal(duplicate.ok, false, JSON.stringify(duplicate));
    assert.equal(duplicate.error.code, 'EXPORT_ALREADY_COMPLETED');
    const reused = execute(core, 'BuildTimelineInterchangeExport', { ...buildPayload, dependency_snapshot_hash: 'f'.repeat(64) }, expected, 'interchange-build');
    assert.equal(reused.ok, false, JSON.stringify(reused));
    assert.equal(reused.error.code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');

    const listed = core.handle(request('query.export.list', { project_id: fixture.projectId }, 'exports-list'));
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(listed.result.items.length, 1);
    assert.equal(listed.result.items[0].state, 'COMPLETED');
    const found = core.handle(request('query.export.get', { project_id: fixture.projectId, export_session_id: fixture.session.id }, 'exports-get'));
    assert.equal(found.ok, true, JSON.stringify(found));
    assert.equal(found.result.export_session.output_asset_revision_id, built.result.asset_revision_id);

    const capability = core.handle(request('query.export.download', {
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      session_id: 'ui-session-1',
    }, 'exports-download'));
    assert.equal(capability.ok, true, JSON.stringify(capability));
    assert.match(capability.result.token, /^[A-Za-z0-9_-]{40,}$/);
    const opened = core.openTimelineInterchangeDownload({
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      session_id: 'ui-session-1',
      token: capability.result.token,
      range: 'bytes=0-31',
    });
    assert.equal(opened.status, 206);
    assert.equal(opened.length, 32);
    assert.equal(opened.contentRange, `bytes 0-31/${bytes.length}`);
    assert.equal(fs.readFileSync(opened.filePath).subarray(0, opened.length).toString('utf8').length > 0, true);
    const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
    try {
      const base = `http://127.0.0.1:${listener.address.port}`;
      const capabilityResponse = await fetch(`${base}/v1/projects/${fixture.projectId}/exports/${fixture.session.id}/download`, {
        headers: { 'x-cineforge-session': 'http-ui-1' },
      });
      assert.equal(capabilityResponse.status, 200);
      const capabilityBody = await capabilityResponse.json();
      assert.equal(Object.hasOwn(capabilityBody.result, 'token'), false);
      assert.match(capabilityBody.result.download_url, /[?&]token=[A-Za-z0-9_-]{40,}/);
      const streamed = await fetch(`${base}${capabilityBody.result.download_url}`, {
        headers: { 'x-cineforge-session': 'http-ui-1', range: 'bytes=0-15' },
      });
      assert.equal(streamed.status, 206);
      assert.equal(streamed.headers.get('content-range'), `bytes 0-15/${bytes.length}`);
      assert.equal((await streamed.text()).length, 16);
      const head = await fetch(`${base}${capabilityBody.result.download_url}`, {
        method: 'HEAD',
        headers: { 'x-cineforge-session': 'http-ui-1' },
      });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get('content-length')), bytes.length);
    } finally {
      await new Promise((resolve) => listener.server.close(resolve));
    }
    assert.throws(() => core.openTimelineInterchangeDownload({
      project_id: fixture.projectId, export_session_id: fixture.session.id, session_id: 'other-session', token: capability.result.token,
    }), (error) => error.code === 'EXPORT_DOWNLOAD_TOKEN_SCOPE');
    assert.throws(() => core.openTimelineInterchangeDownload({
      project_id: fixture.projectId, export_session_id: fixture.session.id, session_id: 'ui-session-1', token: capability.result.token, range: 'bytes=999999999-1000000000',
    }), (error) => error.code === 'EXPORT_DOWNLOAD_RANGE_NOT_SATISFIABLE');
    const missingSession = core.handle(request('query.export.download', { project_id: fixture.projectId, export_session_id: fixture.session.id }, 'missing-session'));
    assert.equal(missingSession.ok, false, JSON.stringify(missingSession));
    assert.equal(missingSession.error.code, 'EXPORT_DOWNLOAD_SESSION_REQUIRED');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fails closed on cross-project export claims and tampered or missing output bytes', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const first = createApprovedHandoff(core, 'interchange-isolation-a');
    const second = createApprovedHandoff(core, 'interchange-isolation-b');
    const crossProject = execute(core, 'BuildTimelineInterchangeExport', {
      project_id: second.projectId,
      export_session_id: first.session.id,
      dependency_snapshot_hash: first.session.dependency_snapshot_hash,
    }, { EXPORT_SESSION: first.session.row_version }, 'interchange-cross-project');
    assert.equal(crossProject.ok, false, JSON.stringify(crossProject));
    assert.equal(crossProject.error.code, 'ENTITY_SCOPE_MISMATCH');
    assert.equal(core.db.prepare('SELECT state FROM export_sessions WHERE id = ?').get(first.session.id).state, 'PREFLIGHT');

    const built = execute(core, 'BuildTimelineInterchangeExport', {
      project_id: first.projectId,
      export_session_id: first.session.id,
      dependency_snapshot_hash: first.session.dependency_snapshot_hash,
    }, { EXPORT_SESSION: first.session.row_version }, 'interchange-isolation-build');
    assert.equal(built.ok, true, JSON.stringify(built));
    const capability = core.resolveTimelineInterchangeDownload({ project_id: first.projectId, export_session_id: first.session.id, session_id: 'tamper-test' });
    const location = core.db.prepare(`SELECT l.relative_path FROM storage_object_locations l
      JOIN storage_objects o ON o.id = l.storage_object_id WHERE o.content_hash = ? AND l.location_role = 'PRIMARY'`).get(built.result.output_content_hash);
    const outputPath = path.join(core.assetStorePath, location.relative_path);
    const original = fs.readFileSync(outputPath);
    fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('tampered\n'), original.subarray(9)]));
    assert.throws(() => core.openTimelineInterchangeDownload({
      project_id: first.projectId, export_session_id: first.session.id, session_id: 'tamper-test', token: capability.token,
    }), (error) => error.code === 'EXPORT_OBJECT_TAMPERED');
    fs.writeFileSync(outputPath, original);
    fs.rmSync(outputPath);
    assert.throws(() => core.openTimelineInterchangeDownload({
      project_id: first.projectId, export_session_id: first.session.id, session_id: 'tamper-test', token: capability.token,
    }), (error) => error.code === 'EXPORT_NOT_READY' || error.code === 'EXPORT_OBJECT_TAMPERED');
    assert.equal(core.db.prepare('SELECT state FROM export_sessions WHERE id = ?').get(first.session.id).state, 'COMPLETED');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('records a conservative retryable export failure state with bounded evidence', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  try {
    const fixture = createApprovedHandoff(core, 'interchange-failure-film');
    const failed = execute(core, 'BuildTimelineInterchangeExport', {
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      dependency_snapshot_hash: '0'.repeat(64),
    }, { EXPORT_SESSION: fixture.session.row_version }, 'interchange-failure');
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.equal(failed.error.code, 'STALE_REVIEW');
    const blocked = core.db.prepare('SELECT * FROM export_sessions WHERE id = ?').get(fixture.session.id);
    assert.equal(blocked.state, 'BLOCKED_MEDIA');
    assert.equal(blocked.row_version, fixture.session.row_version + 1);
    const snapshot = JSON.parse(blocked.validation_snapshot_json);
    assert.equal(snapshot.error_code, 'STALE_REVIEW');
    assert.equal(Object.hasOwn(snapshot, 'technical_details'), false);
    assert.match(blocked.next_step, /Sửa nguồn timeline/);
    const event = core.db.prepare(`SELECT event_type, aggregate_version FROM domain_events
      WHERE aggregate_type = 'EXPORT_SESSION' AND aggregate_id = ? ORDER BY seq DESC LIMIT 1`).get(fixture.session.id);
    assert.equal(event.event_type, 'TIMELINE_INTERCHANGE_EXPORT_BLOCKED');
    assert.equal(event.aggregate_version, blocked.row_version);

    const retry = execute(core, 'BuildTimelineInterchangeExport', {
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      dependency_snapshot_hash: fixture.session.dependency_snapshot_hash,
    }, { EXPORT_SESSION: blocked.row_version }, 'interchange-failure-retry');
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.result.export_session.state, 'COMPLETED');
  } finally {
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('leaves auditable orphaned staging on persistence failure and retries from the fenced state', () => {
  const { dbPath, directory } = tempDb();
  const core = new CoreService({ dbPath });
  const originalMaterialize = core._materializeStagedObject;
  try {
    const fixture = createApprovedHandoff(core, 'interchange-recovery-film');
    core._materializeStagedObject = () => { throw new Error('simulated CAS failure'); };
    const failed = execute(core, 'BuildTimelineInterchangeExport', {
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      dependency_snapshot_hash: fixture.session.dependency_snapshot_hash,
    }, { EXPORT_SESSION: fixture.session.row_version }, 'interchange-recovery-failure');
    assert.equal(failed.ok, false, JSON.stringify(failed));
    assert.equal(failed.error.code, 'INTERNAL_ERROR');
    const blocked = core.db.prepare('SELECT * FROM export_sessions WHERE id = ?').get(fixture.session.id);
    assert.equal(blocked.state, 'FAILED');
    assert.match(blocked.next_step, /retry/i);
    const failedCommand = core.db.prepare('SELECT id FROM commands WHERE idempotency_key = ?').get('interchange-recovery-failure');
    assert.ok(failedCommand);
    const staging = core.db.prepare('SELECT * FROM staging_objects WHERE command_id = ?').get(failedCommand.id);
    assert.equal(staging.state, 'ORPHANED');

    core._materializeStagedObject = originalMaterialize;
    const retried = execute(core, 'BuildTimelineInterchangeExport', {
      project_id: fixture.projectId,
      export_session_id: fixture.session.id,
      dependency_snapshot_hash: fixture.session.dependency_snapshot_hash,
    }, { EXPORT_SESSION: blocked.row_version }, 'interchange-recovery-retry');
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.result.export_session.state, 'COMPLETED');
  } finally {
    core._materializeStagedObject = originalMaterialize;
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
