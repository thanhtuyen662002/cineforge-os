import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

function request(method, params = {}, requestId = method) {
  return { request_id: requestId, api_version: '1', method, params };
}

function execute(core, commandType, payload, expectedVersions = {}, idempotencyKey) {
  return core.handle(request('command.execute', {
    command_type: commandType,
    payload,
    expected_versions: expectedVersions,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  }, `${commandType}-${idempotencyKey ?? Math.random()}`));
}

async function jsonRequest(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json();
  return { response, body };
}

function setupCore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-working-http-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite') });
  const project = execute(core, 'CreateProject', { title: 'Working HTTP', code: 'working-http' }, {}, 'http-working-project');
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
  }, {}, 'http-working-profile');
  const candidate = profile.result.candidate_revisions[0];
  const approved = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId, revision_id: candidate.id, next_state: 'APPROVED',
  }, { REVISION: candidate.row_version }, 'http-working-profile-approve');
  const profileId = approved.result.approved_revision.id;
  const timelineResult = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'MAIN', title: 'HTTP working timeline', media_profile_revision_id: profileId,
  }, {}, 'http-working-timeline');
  const timeline = timelineResult.result.timeline;
  const baseResult = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timeline.id, media_profile_revision_id: profileId,
    duration: { num: 24, den: 1 }, tracks: [{ track_type: 'VIDEO', order_index: 0, clips: [] }], markers: [],
  }, { TIMELINE: timeline.row_version }, 'http-working-base');
  return { directory, core, projectId, timeline: baseResult.result.timeline, base: baseResult.result.revision };
}

test('HTTP timeline working-session routes preserve exact hashes and version fencing', async (t) => {
  const value = setupCore();
  const listener = await listenCoreHttp(value.core, { host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${listener.address.port}`;
  const projectPath = encodeURIComponent(value.projectId);
  const timelinePath = encodeURIComponent(value.timeline.id);
  const sessionCollection = `/v1/projects/${projectPath}/timelines/${timelinePath}/working-sessions`;
  t.after(async () => {
    await new Promise((resolve) => listener.server.close(resolve));
    value.core.close();
    fs.rmSync(value.directory, { recursive: true, force: true });
  });

  const begin = await jsonRequest(baseUrl, sessionCollection, {
    method: 'POST',
    headers: { 'idempotency-key': 'http-working-begin' },
    body: JSON.stringify({
      base_revision_id: value.base.id,
      base_revision_row_version: value.base.row_version,
      base_content_hash: value.base.content_hash,
      client_instance_id: 'http-client-1',
      expected_version: value.timeline.row_version,
    }),
  });
  assert.equal(begin.response.status, 200, JSON.stringify(begin.body));
  const session = begin.body.result.session;
  assert.equal(session.state, 'OPEN');
  assert.equal(session.baseContentHash, value.base.content_hash);

  const sessionPath = `${sessionCollection}/${encodeURIComponent(session.id)}`;
  const operation = {
    op_type: 'ADD_MARKER', id: 'http-marker', time: { num: 6, den: 1 }, marker_type: 'NOTE', label: 'HTTP marker',
  };
  const applied = await jsonRequest(baseUrl, `${sessionPath}/ops`, {
    method: 'POST',
    headers: { 'idempotency-key': 'http-working-op' },
    body: JSON.stringify({ operation, expected_version: session.rowVersion }),
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.result.session.state, 'DIRTY');
  assert.equal(applied.body.result.session.draft.markers.length, 1);

  const stale = await jsonRequest(baseUrl, `${sessionPath}/ops`, {
    method: 'POST',
    headers: { 'idempotency-key': 'http-working-stale' },
    body: JSON.stringify({ operation: { ...operation, id: 'http-stale-marker' }, expected_version: session.rowVersion }),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');

  const autosave = await jsonRequest(baseUrl, `${sessionPath}/autosave`, {
    method: 'POST',
    headers: { 'idempotency-key': 'http-working-autosave' },
    body: JSON.stringify({ expected_version: applied.body.result.session.rowVersion }),
  });
  assert.equal(autosave.response.status, 200, JSON.stringify(autosave.body));
  assert.equal(autosave.body.result.session.state, 'CLEAN');
  assert.equal(autosave.body.result.session.draftHash, autosave.body.result.session.autosavedHash);

  const checkpoint = await jsonRequest(baseUrl, `${sessionPath}/checkpoint`, {
    method: 'POST',
    headers: { 'idempotency-key': 'http-working-checkpoint' },
    body: JSON.stringify({
      expected_version: autosave.body.result.session.rowVersion,
      expected_timeline_version: value.timeline.row_version,
    }),
  });
  assert.equal(checkpoint.response.status, 200, JSON.stringify(checkpoint.body));
  assert.equal(checkpoint.body.result.checkpointRevision.state, 'DRAFT_CHECKPOINT');
  assert.equal(checkpoint.body.result.checkpointRevision.editHash, checkpoint.body.result.session.draftHash);

  const detail = await jsonRequest(baseUrl, sessionPath);
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.result.session.id, session.id);
  assert.equal(detail.body.result.session.operations.length, 1);

  const close = await jsonRequest(baseUrl, `${sessionPath}/close`, {
    method: 'POST',
    headers: { 'idempotency-key': 'http-working-close' },
    body: JSON.stringify({ disposition: 'ABANDON', expected_version: checkpoint.body.result.session.rowVersion }),
  });
  assert.equal(close.response.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.result.session.state, 'ABANDONED');
});
