import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreService } from './core.mjs';

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cineforge-audio-subtitle-'));
  return { directory, dbPath: path.join(directory, 'cineforge.sqlite') };
}

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

function fixture() {
  const { directory, dbPath } = tempDb();
  const core = new CoreService({ dbPath });
  let closed = false;
  const project = execute(core, 'CreateProject', { title: 'Timing metadata', code: 'timing-metadata' }, {}, 'timing-project');
  assert.equal(project.ok, true, JSON.stringify(project));
  const projectId = project.result.id;
  const profile = execute(core, 'CreateMediaProfileRevision', {
    project_id: projectId,
    timeline_rate: { num: 24, den: 1 },
    time_base: { num: 1, den: 24 },
    width: 1920, height: 1080,
    pixel_aspect: { num: 1, den: 1 },
    working_color_space: 'sRGB', transfer_function: 'SDR', hdr_policy: 'NONE',
    audio_sample_rate: 48000, audio_channel_layout: 'STEREO',
  }, {}, 'timing-profile');
  assert.equal(profile.ok, true, JSON.stringify(profile));
  const candidate = profile.result.candidate_revisions[0];
  const approvedProfile = execute(core, 'TransitionMediaProfileRevision', {
    project_id: projectId, revision_id: candidate.id, next_state: 'APPROVED',
  }, { REVISION: candidate.row_version }, 'timing-profile-approve');
  assert.equal(approvedProfile.ok, true, JSON.stringify(approvedProfile));
  const timeline = execute(core, 'CreateTimeline', {
    project_id: projectId, code: 'MAIN', title: 'Main', media_profile_revision_id: approvedProfile.result.approved_revision.id,
  }, {}, 'timing-timeline');
  assert.equal(timeline.ok, true, JSON.stringify(timeline));
  const base = execute(core, 'CreateTimelineRevision', {
    project_id: projectId, timeline_id: timeline.result.timeline.id,
    media_profile_revision_id: approvedProfile.result.approved_revision.id,
    duration: { num: 24, den: 1 },
    tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [] }], markers: [],
  }, { TIMELINE: timeline.result.timeline.row_version }, 'timing-base');
  assert.equal(base.ok, true, JSON.stringify(base));
  return {
    core, directory, dbPath, projectId,
    timeline: { ...timeline.result.timeline, ...base.result.timeline },
    profileId: approvedProfile.result.approved_revision.id,
    base: base.result.revision,
    close() { if (!closed) { core.close(); closed = true; } },
    cleanup() { if (!closed) { core.close(); closed = true; } fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test('audio cue and subtitle timing metadata pins exact timeline evidence, is audited/idempotent, and becomes stale safely', () => {
  const value = fixture();
  const { core, projectId, timeline, base } = value;
  try {
    const binding = {
      project_id: projectId,
      timeline_id: timeline.id,
      timing_dependency_revision_id: base.id,
      timing_dependency_content_hash: base.content_hash,
    };
    const audioPayload = {
      ...binding, cue_type: 'SILENCE', title: 'Khoảng lặng mở đầu',
      start: { num: 0, den: 1 }, end: { num: 3, den: 1 }, intent_text: 'Giữ nhịp thở của cảnh.',
    };
    const missingIdempotency = execute(core, 'CreateAudioCueRevision', audioPayload);
    assert.equal(missingIdempotency.ok, false);
    assert.equal(missingIdempotency.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const audio = execute(core, 'CreateAudioCueRevision', audioPayload, {}, 'audio-create');
    assert.equal(audio.ok, true, JSON.stringify(audio));
    assert.equal(audio.result.revision.lifecycle_state, 'DRAFT');
    assert.equal(audio.result.revision.timing_dependency_revision_id, base.id);
    assert.equal(audio.result.revision.timing_dependency_content_hash, base.content_hash);
    assert.equal(execute(core, 'CreateAudioCueRevision', audioPayload, {}, 'audio-create').result.idempotent_replay, true);

    const audioId = audio.result.audio_cue.id;
    const audioRevisionId = audio.result.revision.id;
    const candidate = execute(core, 'TransitionAudioCueRevision', {
      ...binding, audio_cue_id: audioId, audio_cue_revision_id: audioRevisionId, next_state: 'CANDIDATE',
    }, { AUDIO_CUE_REVISION: 1 }, 'audio-candidate');
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    const selected = execute(core, 'TransitionAudioCueRevision', {
      ...binding, audio_cue_id: audioId, audio_cue_revision_id: audioRevisionId, next_state: 'SELECTED',
    }, { AUDIO_CUE_REVISION: 2 }, 'audio-selected');
    assert.equal(selected.ok, true, JSON.stringify(selected));
    const approval = execute(core, 'TransitionAudioCueRevision', {
      ...binding, audio_cue_id: audioId, audio_cue_revision_id: audioRevisionId, next_state: 'APPROVED',
    }, { AUDIO_CUE_REVISION: 3 }, 'audio-approval');
    assert.equal(approval.ok, false);
    assert.equal(approval.error.code, 'REVIEW_NOT_SUPPORTED');
    assert.equal(core.db.prepare('SELECT lifecycle_state FROM audio_cue_revisions WHERE id = ?').get(audioRevisionId).lifecycle_state, 'SELECTED');

    const missingHash = execute(core, 'CreateAudioCueRevision', {
      project_id: projectId, timeline_id: timeline.id, timing_dependency_revision_id: base.id,
      cue_type: 'SILENCE', start: { num: 1, den: 1 }, end: { num: 2, den: 1 },
    }, {}, 'audio-missing-hash');
    assert.equal(missingHash.ok, false);
    assert.equal(missingHash.error.code, 'TIMING_DEPENDENCY_HASH_REQUIRED');
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM audio_cues').get().n, 1);

    const audioSource = path.join(value.directory, 'unknown-rights-audio.wav');
    fs.writeFileSync(audioSource, 'audio fixture', 'utf8');
    const referenceAsset = execute(core, 'ImportAsset', {
      project_id: projectId, source_path: audioSource, storage_mode: 'REFERENCE', asset_type: 'AUDIO',
    }, {}, 'audio-reference-asset');
    assert.equal(referenceAsset.ok, true, JSON.stringify(referenceAsset));
    const referenceRevisionId = referenceAsset.result.asset.latest_revision.id;
    const unknownRights = execute(core, 'CreateAudioCueRevision', {
      ...binding, cue_type: 'DIALOGUE', selected_asset_revision_id: referenceRevisionId,
      start: { num: 0, den: 1 }, end: { num: 1, den: 1 },
    }, {}, 'audio-unknown-rights');
    assert.equal(unknownRights.ok, false);
    assert.equal(unknownRights.error.code, 'RIGHTS_BLOCKED');

    const copiedAsset = execute(core, 'ImportAsset', {
      project_id: projectId, source_path: audioSource, storage_mode: 'COPY', asset_type: 'AUDIO',
    }, {}, 'audio-copy-asset');
    assert.equal(copiedAsset.ok, true, JSON.stringify(copiedAsset));
    const copiedRevisionId = copiedAsset.result.asset.latest_revision.id;
    const rightsIdentityId = copiedAsset.result.asset.rights.identity.id;
    assert.equal(execute(core, 'CreateRightsRecord', {
      rights_identity_id: rightsIdentityId, right_type: 'SOURCE_USE', status: 'ALLOWED',
      purpose: { allowed: ['TIMELINE_AUDIO'] },
    }, {}, 'audio-rights-record').ok, true);
    assert.equal(execute(core, 'RecordConsent', {
      rights_identity_id: rightsIdentityId, consent_type: 'SOURCE_USE', granted_by: 'fixture',
      evidence_asset_revision_id: copiedRevisionId,
    }, {}, 'audio-rights-consent').ok, true);
    const unreviewedMaterialization = execute(core, 'CreateAudioCueRevision', {
      ...binding, cue_type: 'FOLEY', selected_asset_revision_id: copiedRevisionId,
      start: { num: 0, den: 1 }, end: { num: 1, den: 1 },
    }, {}, 'audio-unreviewed-materialization');
    assert.equal(unreviewedMaterialization.ok, false);
    assert.equal(unreviewedMaterialization.error.code, 'TIMELINE_ASSET_NOT_READY');

    const overlap = execute(core, 'CreateSubtitleTrackRevision', {
      ...binding, locale: 'vi-VN', title: 'Phụ đề Việt', segments: [
        { start: { num: 1, den: 1 }, end: { num: 4, den: 1 }, text: 'Một' },
        { start: { num: 3, den: 1 }, end: { num: 5, den: 1 }, text: 'Hai' },
      ],
    }, {}, 'subtitle-overlap');
    assert.equal(overlap.ok, false);
    assert.equal(overlap.error.code, 'SUBTITLE_SEGMENT_OVERLAP');
    assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM subtitle_tracks').get().n, 0);

    const subtitle = execute(core, 'CreateSubtitleTrackRevision', {
      ...binding, locale: 'vi-VN', title: 'Phụ đề Việt', segments: [
        { start: { num: 1, den: 1 }, end: { num: 4, den: 1 }, text: 'Một' },
        { start: { num: 4, den: 1 }, end: { num: 6, den: 1 }, text: 'Hai' },
        { locale: 'en-US', start: { num: 1, den: 1 }, end: { num: 5, den: 1 }, text: 'One' },
      ],
    }, {}, 'subtitle-create');
    assert.equal(subtitle.ok, true, JSON.stringify(subtitle));
    assert.equal(subtitle.result.revision.segments.length, 3);
    const subtitleId = subtitle.result.subtitle_track.id;
    const subtitleRevisionId = subtitle.result.revision.id;
    const timed = execute(core, 'TransitionSubtitleTrackRevision', {
      ...binding, subtitle_track_id: subtitleId, subtitle_track_revision_id: subtitleRevisionId, next_state: 'TIMED',
    }, { SUBTITLE_TRACK_REVISION: 1 }, 'subtitle-timed');
    assert.equal(timed.ok, true, JSON.stringify(timed));
    const reviewed = execute(core, 'TransitionSubtitleTrackRevision', {
      ...binding, subtitle_track_id: subtitleId, subtitle_track_revision_id: subtitleRevisionId, next_state: 'REVIEWED',
    }, { SUBTITLE_TRACK_REVISION: 2 }, 'subtitle-reviewed');
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    const subtitleApproval = execute(core, 'TransitionSubtitleTrackRevision', {
      ...binding, subtitle_track_id: subtitleId, subtitle_track_revision_id: subtitleRevisionId, next_state: 'APPROVED',
    }, { SUBTITLE_TRACK_REVISION: 3 }, 'subtitle-approval');
    assert.equal(subtitleApproval.ok, false);
    assert.equal(subtitleApproval.error.code, 'REVIEW_NOT_SUPPORTED');

    const audioQuery = core.handle(request('query.timeline.audio_cue_timing', {
      project_id: projectId, timeline_id: timeline.id, timing_dependency_revision_id: base.id,
    }, 'audio-query'));
    assert.equal(audioQuery.ok, true, JSON.stringify(audioQuery));
    assert.equal(audioQuery.result.cues.length, 1);
    const subtitleQuery = core.handle(request('query.timeline.subtitle_timing', {
      project_id: projectId, timeline_id: timeline.id, timeline_revision_id: base.id, locale: 'vi-VN',
    }, 'subtitle-query'));
    assert.equal(subtitleQuery.ok, true, JSON.stringify(subtitleQuery));
    assert.equal(subtitleQuery.result.tracks.length, 1);
    assert.equal(subtitleQuery.result.tracks[0].revision.segments.length, 3);

    const nextCheckpoint = execute(core, 'CreateTimelineRevision', {
      project_id: projectId, timeline_id: timeline.id, media_profile_revision_id: value.profileId,
      duration: { num: 24, den: 1 }, tracks: [{ track_type: 'VIDEO', order_index: 0, name: 'Picture', clips: [] }], markers: [],
    }, { TIMELINE: timeline.row_version }, 'timing-next-checkpoint');
    assert.equal(nextCheckpoint.ok, true, JSON.stringify(nextCheckpoint));
    const staleAudio = core.handle(request('query.timeline.audio_cue_timing', {
      project_id: projectId, timeline_id: timeline.id, timeline_revision_id: base.id,
    }, 'audio-stale-query'));
    assert.equal(staleAudio.result.cues[0].revision.lifecycle_state, 'STALE');
    assert.equal(staleAudio.result.cues[0].revision.stale_reason, 'TIMELINE_REVISION_CHANGED');
    const impact = core.handle(request('query.timeline.timing_impact', { project_id: projectId, timeline_id: timeline.id, timeline_revision_id: base.id }, 'timing-impact'));
    assert.equal(impact.ok, true, JSON.stringify(impact));
    assert.equal(impact.result.counts.stale_total, 2);
    const staleTransition = execute(core, 'TransitionAudioCueRevision', {
      ...binding, audio_cue_id: audioId, audio_cue_revision_id: audioRevisionId, next_state: 'REJECTED',
    }, { AUDIO_CUE_REVISION: 3 }, 'audio-stale-transition');
    assert.equal(staleTransition.ok, false);
    assert.equal(staleTransition.error.code, 'AUDIO_CUE_STALE');

    assert.throws(
      () => core.db.prepare('UPDATE audio_cue_revisions SET intent_text = ? WHERE id = ?').run('tampered', audioRevisionId),
      /audio_cue_revision content is immutable/,
    );
    assert.throws(
      () => core.db.prepare('DELETE FROM subtitle_track_segments WHERE subtitle_track_revision_id = ?').run(subtitleRevisionId),
      /subtitle_track_segments are append-only/,
    );

    value.close();
    const reopened = new CoreService({ dbPath: value.dbPath });
    const persisted = reopened.handle(request('query.timeline.timing_impact', {
      project_id: projectId, timeline_id: timeline.id, timeline_revision_id: base.id,
    }, 'timing-impact-restart'));
    assert.equal(persisted.ok, true, JSON.stringify(persisted));
    assert.equal(persisted.result.counts.audio_cues, 1);
    assert.equal(persisted.result.counts.subtitle_tracks, 1);
    reopened.close();
  } finally {
    value.cleanup();
  }
});

