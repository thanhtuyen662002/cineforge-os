import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineView } from '../src/App'
import type { AssetSummary, CoreClient, DashboardSnapshot, MediaProfileWorkspace, ProjectSummary, TimelineRevision, TimelineSummary, TimelineWorkingWorkspace, TimelineWorkspace } from '../src/types'

const project: ProjectSummary = {
  id: 'project-1', name: 'Phim thử', kind: 'Project', updatedAt: 'Vừa cập nhật', stage: 'ACTIVE', stageDetail: 'test',
  cover: 'linear-gradient(145deg, #7664a9, #35446a)', accent: '#b9a0ff', completion: { done: 0, total: 0 },
  health: 'healthy', nextAction: 'Mở dự án', nextActionLabel: 'Mở', storage: '0 B', productionItems: [],
}

const snapshot: DashboardSnapshot = {
  generatedAt: new Date().toISOString(), projects: [project], decisions: [], activity: [],
  system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false },
}

const profileRevision = {
  id: 'profile-revision-1', profileId: 'profile-1', projectId: project.id, state: 'APPROVED', rowVersion: 2,
  timelineRate: { num: 24, den: 1 }, timeBase: { num: 1, den: 24 }, dropFramePolicy: 'NON_DROP', width: 1920, height: 1080,
  pixelAspect: { num: 1, den: 1 }, workingColorSpace: 'REC709', transferFunction: 'SDR', hdrPolicy: 'DISABLED', audioSampleRate: 48000, audioChannelLayout: 'STEREO',
}
const profile: MediaProfileWorkspace = { profile: { id: 'profile-1', projectId: project.id }, revisions: [profileRevision], approvedRevision: profileRevision, candidateRevisions: [] }
const timeline: TimelineSummary = { id: 'timeline-1', projectId: project.id, scopeType: 'PROJECT', scopeId: project.id, code: 'MAIN', title: 'Main cut', state: 'ACTIVE', rowVersion: 2 }
const revision: TimelineRevision = { id: 'revision-1', timelineId: timeline.id, mediaProfileRevisionId: profileRevision.id, state: 'DRAFT_CHECKPOINT', rowVersion: 1, editHash: 'a'.repeat(64), duration: { num: 1, den: 1 }, tracks: [], markers: [], readinessState: 'READY' }
const workspace: TimelineWorkspace = { timeline, mediaProfile: profile, revisions: [revision], currentRevision: revision, needsYou: [] }

const workingTrack = { id: 'track-1', trackType: 'VIDEO', orderIndex: 0, name: 'Picture', enabled: true, clips: [] }
const workingWorkspace: TimelineWorkingWorkspace = {
  timeline,
  session: {
    id: 'session-1', timelineId: timeline.id, baseRevisionId: revision.id, baseRevisionRowVersion: revision.rowVersion,
    baseContentHash: revision.editHash, actorId: 'actor-1', clientInstanceId: 'client-1', mode: 'EXCLUSIVE', state: 'OPEN',
    draftHash: 'd'.repeat(64), autosavedHash: 'd'.repeat(64), draft: { schemaVersion: 1, mediaProfileRevisionId: profileRevision.id, duration: { num: 1, den: 1 }, tracks: [workingTrack], markers: [] },
    lastAcknowledgedOpSeq: 0, historyCursorSeq: 0, nextOpSeq: 1, rowVersion: 1, operations: [], historyActions: [],
  },
}

const eligibleAsset: AssetSummary = {
  id: 'asset-eligible', projectId: project.id, name: 'Verified picture', assetType: 'VIDEO', originType: 'IMPORTED',
  state: 'ACTIVE', availability: 'AVAILABLE', readinessState: 'READY', revisionId: 'asset-revision-eligible', byteSize: 100,
  warnings: [], rights: { status: 'ALLOWED', eligible: true, blockers: [], evidence: [] },
}
const rightsBlockedAsset: AssetSummary = {
  id: 'asset-blocked', projectId: project.id, name: 'Rights blocked', assetType: 'VIDEO', originType: 'IMPORTED',
  state: 'ACTIVE', availability: 'AVAILABLE', readinessState: 'READY', revisionId: 'asset-revision-blocked', byteSize: 100,
  warnings: [], rights: { status: 'RESTRICTED', eligible: false, blockers: [{ code: 'CONSENT_REQUIRED' }], evidence: [] },
}
const foreignAsset: AssetSummary = {
  id: 'asset-foreign', projectId: 'project-foreign', name: 'Other project', assetType: 'VIDEO', originType: 'IMPORTED',
  state: 'ACTIVE', availability: 'AVAILABLE', readinessState: 'READY', revisionId: 'asset-revision-foreign', byteSize: 100,
  warnings: [], rights: { status: 'ALLOWED', eligible: true, blockers: [], evidence: [] },
}
const unscopedAsset: AssetSummary = {
  id: 'asset-unscoped', name: 'Unknown scope', assetType: 'VIDEO', originType: 'IMPORTED', state: 'ACTIVE',
  availability: 'AVAILABLE', readinessState: 'READY', revisionId: 'asset-revision-unscoped', byteSize: 100,
  warnings: [], rights: { status: 'ALLOWED', eligible: true, blockers: [], evidence: [] },
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    getDashboard: vi.fn(async () => snapshot), acknowledgeDecision: vi.fn(async () => undefined), createProject: vi.fn(async () => project), addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getMediaProfile: vi.fn(async () => profile), getTimelines: vi.fn(async () => [timeline]), getTimelineWorkspace: vi.fn(async () => workspace),
    createMediaProfileRevision: vi.fn(async () => profile), transitionMediaProfileRevision: vi.fn(async () => profile),
    createTimeline: vi.fn(async () => timeline), createTimelineRevision: vi.fn(async () => workspace), transitionTimelineRevision: vi.fn(async () => workspace),
    ...overrides,
  }
}

describe('TimelineView', () => {
  beforeEach(() => localStorage.clear())

  it('loads the project workspace and sends a duration-bearing VIDEO checkpoint from bounded JSON', async () => {
    const core = client()
    render(<TimelineView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('Main cut')).toBeTruthy()
    expect(screen.getByText('Đã duyệt')).toBeTruthy()
    await waitFor(() => expect(core.getTimelineWorkspace).toHaveBeenCalled())
    expect(await screen.findByText('Duration num')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Duration num'), { target: { value: '24000' } })
    fireEvent.change(screen.getByLabelText('Duration den'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('Tracks JSON'), { target: { value: '[{"trackType":"VIDEO","orderIndex":0,"name":"Picture","enabled":true,"clips":[{"timelineIn":{"num":0,"den":1},"timelineOut":{"num":12,"den":1}}]}]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu checkpoint' }))
    await waitFor(() => expect(core.createTimelineRevision).toHaveBeenCalledWith(project.id, timeline.id, expect.objectContaining({
      mediaProfileRevisionId: profileRevision.id,
      duration: { num: 24000, den: 1001 },
      tracks: [{ trackType: 'VIDEO', orderIndex: 0, name: 'Picture', enabled: true, clips: [{ timelineIn: { num: 0, den: 1 }, timelineOut: { num: 12, den: 1 } }] }],
      markers: [],
    }), timeline.rowVersion, expect.any(String)))
  })

  it('shows the empty and needs-user state when no approved profile exists', async () => {
    const noProfile: MediaProfileWorkspace = { profile: { id: 'profile-1', projectId: project.id }, revisions: [], approvedRevision: null, candidateRevisions: [] }
    const core = client({ getMediaProfile: vi.fn(async () => noProfile), getTimelines: vi.fn(async () => []) })
    render(<TimelineView snapshot={snapshot} locale="en" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('No timelines yet')).toBeTruthy()
    expect(screen.getByText('An approved Media Profile is required before creating the first timeline.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create timeline' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a load error visible and retryable', async () => {
    const getMediaProfile = vi.fn().mockRejectedValueOnce(new Error('Core unavailable')).mockResolvedValue(profile)
    const core = client({ getMediaProfile })
    render(<TimelineView snapshot={snapshot} locale="en" client={core} onToast={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Core unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Main cut')).toBeTruthy()
    expect(getMediaProfile).toHaveBeenCalledTimes(2)
  })

  it('offers exact project-scoped asset revisions and keeps blocked options visibly disabled', async () => {
    const core = client({
      getAssets: vi.fn(async () => [eligibleAsset, rightsBlockedAsset, foreignAsset, unscopedAsset]),
      getTimelineWorkspace: vi.fn(async () => workspace),
      getTimelineAudioTiming: vi.fn(async () => ({ timeline, timelineRevision: revision, cues: [] })),
      getTimelineSubtitleTiming: vi.fn(async () => ({ timeline, timelineRevision: revision, tracks: [] })),
      beginTimelineWorkingSession: vi.fn(async () => workingWorkspace),
      applyTimelineEditOps: vi.fn(async () => workingWorkspace),
    })
    render(<TimelineView snapshot={snapshot} locale="en" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('Main cut')).toBeTruthy()
    await waitFor(() => expect(core.getAssets).toHaveBeenCalledWith(project.id, expect.any(AbortSignal)))

    fireEvent.click(screen.getByRole('button', { name: 'Open editing session' }))
    const assetPicker = await screen.findByLabelText('Clip asset')
    expect((within(assetPicker).getByRole('option', { name: /Rights\/consent/ }) as HTMLOptionElement).disabled).toBe(true)
    expect((within(assetPicker).getByRole('option', { name: /Different project/ }) as HTMLOptionElement).disabled).toBe(true)
    expect((within(assetPicker).getByRole('option', { name: /Project scope unknown/ }) as HTMLOptionElement).disabled).toBe(true)

    fireEvent.change(assetPicker, { target: { value: eligibleAsset.revisionId } })
    fireEvent.change(screen.getByLabelText('Track ID'), { target: { value: workingTrack.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert clip' }))
    await waitFor(() => expect(core.applyTimelineEditOps).toHaveBeenCalledWith(
      project.id,
      timeline.id,
      workingWorkspace.session?.id,
      [expect.objectContaining({ op_type: 'INSERT_CLIP', payload: expect.objectContaining({
        track_id: workingTrack.id,
        clip: expect.objectContaining({ asset_revision_id: eligibleAsset.revisionId }),
      }) })],
      workingWorkspace.session?.rowVersion,
      expect.any(String),
    ))

    fireEvent.change(screen.getByLabelText('Cue type'), { target: { value: 'SFX' } })
    const audioPicker = await screen.findByLabelText('Audio asset')
    expect((within(audioPicker).getByRole('option', { name: /Rights\/consent/ }) as HTMLOptionElement).disabled).toBe(true)
    fireEvent.change(audioPicker, { target: { value: eligibleAsset.revisionId } })
    expect((audioPicker as HTMLSelectElement).value).toBe(eligibleAsset.revisionId)
  })

  it('clears an exact asset choice when the timeline project changes', async () => {
    const projectTwo: ProjectSummary = { ...project, id: 'project-2', name: 'Phim hai' }
    const profileRevisionTwo = { ...profileRevision, id: 'profile-revision-2', profileId: 'profile-2', projectId: projectTwo.id }
    const profileTwo: MediaProfileWorkspace = { profile: { id: 'profile-2', projectId: projectTwo.id }, revisions: [profileRevisionTwo], approvedRevision: profileRevisionTwo, candidateRevisions: [] }
    const timelineTwo: TimelineSummary = { ...timeline, id: 'timeline-2', projectId: projectTwo.id, scopeId: projectTwo.id, title: 'Second cut' }
    const revisionTwo: TimelineRevision = { ...revision, id: 'revision-2', timelineId: timelineTwo.id, mediaProfileRevisionId: profileRevisionTwo.id }
    const workspaceTwo: TimelineWorkspace = { timeline: timelineTwo, mediaProfile: profileTwo, revisions: [revisionTwo], currentRevision: revisionTwo, needsYou: [] }
    const workingWorkspaceTwo: TimelineWorkingWorkspace = { ...workingWorkspace, timeline: timelineTwo, session: { ...workingWorkspace.session!, id: 'session-2', timelineId: timelineTwo.id, baseRevisionId: revisionTwo.id, baseRevisionRowVersion: revisionTwo.rowVersion, baseContentHash: revisionTwo.editHash, clientInstanceId: 'client-2', draft: { ...workingWorkspace.session!.draft, mediaProfileRevisionId: profileRevisionTwo.id } } }
    const multiProjectSnapshot: DashboardSnapshot = { ...snapshot, projects: [project, projectTwo] }
    const core = client({
      getMediaProfile: vi.fn(async (projectId) => projectId === projectTwo.id ? profileTwo : profile),
      getTimelines: vi.fn(async (projectId) => projectId === projectTwo.id ? [timelineTwo] : [timeline]),
      getTimelineWorkspace: vi.fn(async (projectId) => projectId === projectTwo.id ? workspaceTwo : workspace),
      getAssets: vi.fn(async (projectId) => projectId === projectTwo.id ? [] : [eligibleAsset]),
      beginTimelineWorkingSession: vi.fn(async (projectId) => projectId === projectTwo.id ? workingWorkspaceTwo : workingWorkspace),
    })
    render(<TimelineView snapshot={multiProjectSnapshot} locale="en" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('Main cut')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open editing session' }))
    const firstPicker = await screen.findByLabelText('Clip asset')
    fireEvent.change(firstPicker, { target: { value: eligibleAsset.revisionId } })
    expect((firstPicker as HTMLSelectElement).value).toBe(eligibleAsset.revisionId)

    fireEvent.change(screen.getByLabelText('Timeline project'), { target: { value: projectTwo.id } })
    await waitFor(() => expect(core.getAssets).toHaveBeenCalledWith(projectTwo.id, expect.any(AbortSignal)))
    expect(await screen.findByText('Second cut')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Open editing session' }))
    const secondPicker = await screen.findByLabelText('Clip asset')
    expect((secondPicker as HTMLSelectElement).value).toBe('')
    expect((secondPicker as HTMLSelectElement).disabled).toBe(true)
  })
})
