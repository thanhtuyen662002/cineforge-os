import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';
import { listenCoreHttp } from './http.mjs';

function execute(core, commandType, payload, expectedVersions = {}, idempotencyKey) {
  return core.handle({ request_id: `${commandType}-${idempotencyKey}`, api_version: '1', method: 'command.execute', params: {
    command_type: commandType, payload, expected_versions: expectedVersions, idempotency_key: idempotencyKey,
  } });
}

async function createTimeline(core) {
  const project = execute(core, 'CreateProject', { title: 'HTTP timing', code: 'http-timing' }, {}, 'http-timing-project');
  const projectId = project.result.id;
  const profile = execute(core, 'CreateMediaProfileRevision', {
    project_id: projectId, timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 },
    width: 1920, height: 1080, pixel_aspect: { num: 1, den: 1 }, working_color_space: 'sRGB',
    transfer_function: 'SDR', hdr_policy: 'NONE', audio_sample_rate: 48000, audio_channel_layout: 'STEREO',
  }, {}, 'http-timing-profile');
  const candidate = profile.result.candidate_revisions[0];
  const approved = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId, revision_id: candidate.id, next_state: 'APPROVED',
  }, { REVISION: candidate.row_version }, 'http-timing-profile-approve');
  const timeline = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'MAIN', title: 'Main', media_profile_revision_id: approved.result.approved_revision.id,
  }, {}, 'http-timing-timeline');
  const checkpoint = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timeline.result.timeline.id,
    media_profile_revision_id: approved.result.approved_revision.id, duration: { num: 24, den: 1 },
    tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [] }], markers: [],
  }, { TIMELINE: timeline.result.timeline.row_version }, 'http-timing-base');
  return { projectId, timelineId: timeline.result.timeline.id, revision: checkpoint.result.revision };
}

test('HTTP audio/subtitle timing routes enforce exact pins, map redacted projections, and require idempotency', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-audio-subtitle-http-'));
  const core = new CoreService({ dbPath: path.join(directory, 'cineforge.sqlite') });
  const fixture = await createTimeline(core);
  const listener = await listenCoreHttp(core, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${listener.address.port}`;
  const jsonRequest = async (pathname, options = {}) => {
    const response = await fetch(`${base}${pathname}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
    return { response, payload: await response.json() };
  };
  const binding = {
    timeline_id: fixture.timelineId,
    timing_dependency_revision_id: fixture.revision.id,
    timing_dependency_content_hash: fixture.revision.content_hash,
  };
  try {
    const emptyAudio = await jsonRequest(`/v1/projects/${fixture.projectId}/timelines/${fixture.timelineId}/revisions/${fixture.revision.id}/audio-cues`);
    assert.equal(emptyAudio.response.status, 200);
    assert.deepEqual(emptyAudio.payload.result.cues, []);

    const missingIdempotency = await jsonRequest(`/v1/projects/${fixture.projectId}/audio-cues`, {
      method: 'POST',
      body: JSON.stringify({ ...binding, cue_type: 'SILENCE', start: { num: 0, den: 1 }, end: { num: 1, den: 1 } }),
    });
    assert.equal(missingIdempotency.response.status, 400);
    assert.equal(missingIdempotency.payload.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    const missingHash = await jsonRequest(`/v1/projects/${fixture.projectId}/audio-cues`, {
      method: 'POST', headers: { 'idempotency-key': 'http-audio-missing-hash' },
      body: JSON.stringify({ timeline_id: fixture.timelineId, timing_dependency_revision_id: fixture.revision.id, cue_type: 'SILENCE', start: { num: 0, den: 1 }, end: { num: 1, den: 1 } }),
    });
    assert.equal(missingHash.response.status, 409);
    assert.equal(missingHash.payload.error.code, 'TIMING_DEPENDENCY_HASH_REQUIRED');

    const audio = await jsonRequest(`/v1/projects/${fixture.projectId}/audio-cues`, {
      method: 'POST', headers: { 'idempotency-key': 'http-audio-create' },
      body: JSON.stringify({ ...binding, cue_type: 'SILENCE', title: 'Intro silence', start: { num: 0, den: 1 }, end: { num: 1, den: 1 } }),
    });
    assert.equal(audio.response.status, 200, JSON.stringify(audio.payload));
    const cue = audio.payload.result.audioCue;
    const cueRevision = audio.payload.result.revision;
    assert.equal(cueRevision.timingDependencyRevisionId, fixture.revision.id);
    assert.equal(Object.hasOwn(cueRevision, 'provider_path'), false);
    assert.equal(Object.hasOwn(cueRevision, 'storage_uri'), false);
    assert.equal(Object.hasOwn(cueRevision, 'asset_gate'), false);
    assert.equal(cueRevision.assetGate.state, 'NOT_APPLICABLE');

    const transition = await jsonRequest(`/v1/projects/${fixture.projectId}/audio-cues/${cue.id}/revisions/${cueRevision.id}/transition`, {
      method: 'POST', headers: { 'idempotency-key': 'http-audio-candidate' },
      body: JSON.stringify({ ...binding, next_state: 'CANDIDATE', expected_version: cueRevision.rowVersion }),
    });
    assert.equal(transition.response.status, 200, JSON.stringify(transition.payload));
    assert.equal(transition.payload.result.revision.state, 'CANDIDATE');

    const subtitle = await jsonRequest(`/v1/projects/${fixture.projectId}/subtitle-tracks`, {
      method: 'POST', headers: { 'idempotency-key': 'http-subtitle-create' },
      body: JSON.stringify({ ...binding, locale: 'vi-VN', title: 'Tiếng Việt', segments: [{ start: { num: 2, den: 1 }, end: { num: 4, den: 1 }, text: 'Xin chào' }] }),
    });
    assert.equal(subtitle.response.status, 200, JSON.stringify(subtitle.payload));
    const track = subtitle.payload.result.subtitleTrack;
    const trackRevision = subtitle.payload.result.revision;
    const subtitleTiming = await jsonRequest(`/v1/projects/${fixture.projectId}/timelines/${fixture.timelineId}/revisions/${fixture.revision.id}/subtitle-tracks?locale=vi-VN`);
    assert.equal(subtitleTiming.response.status, 200);
    assert.equal(subtitleTiming.payload.result.tracks.length, 1);
    assert.equal(subtitleTiming.payload.result.tracks[0].revision.segments[0].text, 'Xin chào');

    const impact = await jsonRequest(`/v1/projects/${fixture.projectId}/timelines/${fixture.timelineId}/revisions/${fixture.revision.id}/timing-impact`);
    assert.equal(impact.response.status, 200, JSON.stringify(impact.payload));
    assert.equal(impact.payload.result.counts.audioCues, 1);
    assert.equal(impact.payload.result.counts.subtitleTracks, 1);
    assert.equal(JSON.stringify(impact.payload).includes('provider'), false);

    const reviewBlocked = await jsonRequest(`/v1/projects/${fixture.projectId}/subtitle-tracks/${track.id}/revisions/${trackRevision.id}/transition`, {
      method: 'POST', headers: { 'idempotency-key': 'http-subtitle-approval' },
      body: JSON.stringify({ ...binding, next_state: 'APPROVED', expected_version: trackRevision.rowVersion }),
    });
    assert.equal(reviewBlocked.response.status, 409);
    assert.equal(reviewBlocked.payload.error.code, 'REVIEW_NOT_SUPPORTED');
  } finally {
    await new Promise((resolve) => listener.server.close(resolve));
    core.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

