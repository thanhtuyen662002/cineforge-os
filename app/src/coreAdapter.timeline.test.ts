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
})
