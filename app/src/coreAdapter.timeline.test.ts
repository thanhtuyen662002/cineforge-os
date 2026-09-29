import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpCoreClient } from './coreAdapter'

afterEach(() => vi.restoreAllMocks())

describe('HttpCoreClient timeline boundary', () => {
  it('pins the approved Media Profile when creating a timeline and sends explicit checkpoint fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/timelines') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, result: { timeline: { id: 'timeline-1', project_id: 'project-1', title: 'Main', code: 'MAIN', row_version: 1 } } }), { status: 200 })
      }
      if (url.endsWith('/revisions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, result: {
          timeline: { id: 'timeline-1', project_id: 'project-1', title: 'Main', code: 'MAIN', row_version: 2 },
          revision: { id: 'revision-1', timeline_id: 'timeline-1', media_profile_revision_id: 'profile-revision-1', lifecycle_state: 'DRAFT_CHECKPOINT', row_version: 1, duration: { num: 24000, den: 1001 }, content_hash: 'a'.repeat(64), tracks: [], markers: [] },
          media_profile_revision: { id: 'profile-revision-1', profile_id: 'profile-1', project_id: 'project-1', lifecycle_state: 'APPROVED', row_version: 2, timeline_rate: { num: 24000, den: 1001 }, time_base: { num: 1001, den: 24000 }, pixel_aspect: { num: 1, den: 1 } },
        } }), { status: 200 })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new HttpCoreClient('http://core')
    const timeline = await client.createTimeline('project-1', { title: 'Main', code: 'main', mediaProfileRevisionId: 'profile-revision-1' }, 'timeline-create-1')
    expect(timeline).toMatchObject({ id: 'timeline-1', title: 'Main' })
    const workspace = await client.createTimelineRevision('project-1', 'timeline-1', {
      mediaProfileRevisionId: 'profile-revision-1', duration: { num: 24000, den: 1001 }, tracks: [], markers: [],
    }, 1, 'timeline-revision-1')
    expect(workspace.currentRevision).toMatchObject({ id: 'revision-1', editHash: 'a'.repeat(64), duration: { num: 24000, den: 1001 } })
    expect(workspace.mediaProfile?.approvedRevision?.id).toBe('profile-revision-1')

    const createBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(createBody.media_profile_revision_id).toBe('profile-revision-1')
    const revisionBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(revisionBody).toMatchObject({ media_profile_revision_id: 'profile-revision-1', duration: { num: 24000, den: 1001 }, tracks: [], markers: [] })
    expect(revisionBody.snapshot).toBeUndefined()
  })

  it('maps the compact Core projection without exposing provider fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {
      timeline: { id: 'timeline-1', project_id: 'project-1', title: 'Main', provider_path: 'C:/secret' },
      revision: { id: 'revision-1', timeline_id: 'timeline-1', lifecycle_state: 'CANDIDATE', row_version: 2, duration: { num: 1, den: 24 }, content_hash: 'b'.repeat(64), provider_id: 'secret', tracks: [] },
      media_profile_revision: { id: 'profile-revision-1', project_id: 'project-1', lifecycle_state: 'APPROVED', row_version: 1, timeline_rate: { num: 24, den: 1 }, time_base: { num: 1, den: 24 }, pixel_aspect: { num: 1, den: 1 }, provider_path: 'C:/secret' },
    } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const workspace = await new HttpCoreClient('http://core').getTimelineWorkspace('project-1', 'timeline-1')
    expect(workspace.currentRevision?.id).toBe('revision-1')
    expect(workspace.mediaProfile?.approvedRevision?.id).toBe('profile-revision-1')
    expect(workspace.currentRevision?.editHash).toBe('b'.repeat(64))
    expect(JSON.stringify(workspace)).not.toContain('provider')
  })

  it('uses the exact working-session routes and maps draft/history evidence', async () => {
    const sessionProjection = {
      timeline: { id: 'timeline-1', project_id: 'project-1', title: 'Main', row_version: 2 },
      session: {
        id: 'session-1', timeline_id: 'timeline-1', base_revision_id: 'revision-1', base_revision_row_version: 1,
        base_content_hash: 'a'.repeat(64), actor_id: 'actor-1', client_instance_id: 'client-1', mode: 'EXCLUSIVE', state: 'DIRTY',
        draft_hash: 'b'.repeat(64), autosaved_hash: 'a'.repeat(64), row_version: 2, last_acknowledged_op_seq: 1,
        history_cursor_seq: 1, next_op_seq: 2, draft: { schema_version: 1, media_profile_revision_id: 'profile-1', duration: { num: 24, den: 1 }, tracks: [], markers: [{ id: 'marker-1', time: { num: 4, den: 1 }, marker_type: 'NOTE', label: 'Beat', payload: {} }] },
        operations: [{ id: 'op-1', op_seq: 1, op_type: 'ADD_MARKER', history_state: 'ACTIVE', result_hash: 'b'.repeat(64) }],
        history_actions: [{ id: 'action-1', action_seq: 1, action_type: 'UNDO', target_op_seq: 1, before_hash: 'a'.repeat(64), after_hash: 'b'.repeat(64) }],
      },
      checkpoint_revision: { id: 'revision-2', timeline_id: 'timeline-1', lifecycle_state: 'DRAFT_CHECKPOINT', row_version: 1, duration: { num: 24, den: 1 }, content_hash: 'b'.repeat(64), tracks: [], markers: [] },
      checkpoint_revision_id: 'revision-2',
    }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true, result: sessionProjection }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = new HttpCoreClient('http://core')
    const workspace = await client.getTimelineWorkingSession('project-1', 'timeline-1', 'session-1')
    expect(workspace.session).toMatchObject({ id: 'session-1', baseContentHash: 'a'.repeat(64), draftHash: 'b'.repeat(64), historyCursorSeq: 1 })
    expect(workspace.session?.draft.markers[0]).toMatchObject({ id: 'marker-1', markerType: 'NOTE' })
    expect(workspace.session?.historyActions[0]).toMatchObject({ actionType: 'UNDO', targetOpSeq: 1 })

    await client.beginTimelineWorkingSession('project-1', 'timeline-1', {
      baseRevisionId: 'revision-1', baseRevisionRowVersion: 1, baseContentHash: 'a'.repeat(64), clientInstanceId: 'client-1', expectedTimelineVersion: 2,
    }, 'working-begin')
    await client.applyTimelineEditOps('project-1', 'timeline-1', 'session-1', [{ op_type: 'ADD_MARKER', id: 'marker-2' }], 2, 'working-op')
    await client.undoTimelineEditOp('project-1', 'timeline-1', 'session-1', 2, 'working-undo')
    await client.redoTimelineEditOp('project-1', 'timeline-1', 'session-1', 2, 'working-redo')
    await client.autosaveTimelineWorkingSession('project-1', 'timeline-1', 'session-1', 2, 'working-autosave')
    await client.checkpointTimelineWorkingSession('project-1', 'timeline-1', 'session-1', 2, 2, 'working-checkpoint')
    await client.closeTimelineWorkingSession('project-1', 'timeline-1', 'session-1', 'ABANDON', 2, 'working-close')

    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${new URL(call.url).pathname}`)).toEqual([
      'GET /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1/ops',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1/undo',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1/redo',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1/autosave',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1/checkpoint',
      'POST /v1/projects/project-1/timelines/timeline-1/working-sessions/session-1/close',
    ])
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ base_revision_id: 'revision-1', base_content_hash: 'a'.repeat(64), expected_timeline_version: 2 })
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({ operations: [{ op_type: 'ADD_MARKER', id: 'marker-2' }], expected_version: 2 })
    expect(JSON.parse(String(calls[6].init?.body))).toMatchObject({ expected_version: 2, expected_timeline_version: 2 })
    expect(calls.slice(1).every((call) => call.init?.headers && new Headers(call.init.headers).get('Idempotency-Key'))).toBe(true)
  })

  it('reads and writes metadata timing with exact dependency fencing and redacts unknown fields', async () => {
    const hash = 'c'.repeat(64)
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init })
      const url = String(input)
      if (url.includes('/audio-cues') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, result: { audio_cue: { id: 'cue-1', cue_type: 'SILENCE', title: 'Room tone', row_version: 1 }, revision: { id: 'cue-revision-1', audio_cue_id: 'cue-1', lifecycle_state: 'DRAFT', row_version: 1, timeline_revision_id: 'revision-1', timeline_content_hash: hash, start: { num: 0, den: 1 }, end: { num: 1, den: 1 }, intent_text: '' } } }), { status: 200 })
      if (url.includes('/subtitle-tracks') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, result: { subtitle_track: { id: 'track-1', locale: 'vi-VN', title: 'Tiếng Việt', row_version: 1 }, revision: { id: 'track-revision-1', subtitle_track_id: 'track-1', lifecycle_state: 'DRAFT', row_version: 1, timing_dependency_revision_id: 'revision-1', timing_dependency_content_hash: hash, format_profile: 'TEXT', segments: [] } } }), { status: 200 })
      if (url.endsWith('/audio-cues')) return new Response(JSON.stringify({ ok: true, result: {
        timeline: { id: 'timeline-1', project_id: 'project-1', provider_id: 'secret' },
        timeline_revision: { id: 'revision-1', timeline_id: 'timeline-1', lifecycle_state: 'DRAFT_CHECKPOINT', row_version: 1, duration: { num: 24, den: 1 }, content_hash: hash, tracks: [], markers: [] },
        cues: [{ audio_cue: { id: 'cue-1', project_id: 'project-1', timeline_id: 'timeline-1', cue_type: 'SILENCE', title: 'Room tone', row_version: 1 }, revision: { id: 'cue-revision-1', audio_cue_id: 'cue-1', lifecycle_state: 'DRAFT', row_version: 1, timing_dependency_revision_id: 'revision-1', timing_dependency_content_hash: hash, start: { num: 0, den: 1 }, end: { num: 1, den: 1 }, intent_text: '', provider_secret: 'nope' } }],
      } }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/subtitle-tracks')) return new Response(JSON.stringify({ ok: true, result: {
        timeline: { id: 'timeline-1', project_id: 'project-1' },
        timeline_revision: { id: 'revision-1', timeline_id: 'timeline-1', lifecycle_state: 'DRAFT_CHECKPOINT', row_version: 1, duration: { num: 24, den: 1 }, content_hash: hash, tracks: [], markers: [] },
        tracks: [{ subtitle_track: { id: 'track-1', project_id: 'project-1', timeline_id: 'timeline-1', locale: 'vi-VN', title: 'Tiếng Việt', row_version: 1 }, revision: { id: 'track-revision-1', subtitle_track_id: 'track-1', lifecycle_state: 'TIMED', row_version: 2, timing_dependency_revision_id: 'revision-1', timing_dependency_content_hash: hash, format_profile: 'TEXT', segments: [{ segment_index: 0, start: { num: 0, den: 1 }, end: { num: 1, den: 1 }, locale: 'vi-VN', text: 'Xin chào' }] } }],
      } }), { status: 200, headers: { 'content-type': 'application/json' } })
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new HttpCoreClient('http://core')
    const audio = await client.getTimelineAudioTiming('project-1', 'timeline-1', 'revision-1')
    expect(audio.cues[0].revision).toMatchObject({ id: 'cue-revision-1', timingDependencyRevisionId: 'revision-1', timelineContentHash: hash })
    expect(JSON.stringify(audio)).not.toContain('provider')
    const subtitles = await client.getTimelineSubtitleTiming('project-1', 'timeline-1', 'revision-1')
    expect(subtitles.tracks[0].revision?.segments[0]).toMatchObject({ locale: 'vi-VN', text: 'Xin chào' })
    await client.createAudioCueRevision('project-1', 'timeline-1', { timelineRevisionId: 'revision-1', timelineContentHash: hash, cueType: 'SILENCE', title: 'Room tone', start: { num: 0, den: 1 }, end: { num: 1, den: 1 } }, 'audio-create-1')
    await client.transitionAudioCueRevision('project-1', 'timeline-1', 'cue-1', 'cue-revision-1', 'CANDIDATE', 1, 'audio-transition-1')
    await client.createSubtitleTrackRevision('project-1', 'timeline-1', { timelineRevisionId: 'revision-1', timelineContentHash: hash, locale: 'vi-VN', title: 'Tiếng Việt', segments: [{ start: { num: 0, den: 1 }, end: { num: 1, den: 1 }, locale: 'vi-VN', text: 'Xin chào' }] }, 'subtitle-create-1')
    await client.transitionSubtitleTrackRevision('project-1', 'timeline-1', 'track-1', 'track-revision-1', 'TIMED', 1, 'subtitle-transition-1')
    const paths = calls.map((call) => `${call.init?.method ?? 'GET'} ${new URL(call.url).pathname}`)
    expect(paths).toEqual([
      'GET /v1/projects/project-1/timelines/timeline-1/revisions/revision-1/audio-cues',
      'GET /v1/projects/project-1/timelines/timeline-1/revisions/revision-1/subtitle-tracks',
      'POST /v1/projects/project-1/audio-cues',
      'POST /v1/projects/project-1/audio-cues/cue-1/revisions/cue-revision-1/transition',
      'POST /v1/projects/project-1/subtitle-tracks',
      'POST /v1/projects/project-1/subtitle-tracks/track-1/revisions/track-revision-1/transition',
    ])
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({ timeline_id: 'timeline-1', timing_dependency_revision_id: 'revision-1', timing_dependency_content_hash: hash, cue_type: 'SILENCE' })
    expect(JSON.parse(String(calls[4].init?.body))).toMatchObject({ timeline_id: 'timeline-1', timing_dependency_revision_id: 'revision-1', timing_dependency_content_hash: hash, locale: 'vi-VN' })
    expect(calls.slice(2).every((call) => new Headers(call.init?.headers).get('Idempotency-Key'))).toBe(true)
  })
})
