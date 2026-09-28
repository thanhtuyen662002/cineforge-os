import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineView } from '../src/App'
import type { CoreClient, DashboardSnapshot, MediaProfileWorkspace, ProjectSummary, TimelineRevision, TimelineSummary, TimelineWorkspace } from '../src/types'

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
const revision: TimelineRevision = { id: 'revision-1', timelineId: timeline.id, mediaProfileRevisionId: profileRevision.id, state: 'DRAFT_CHECKPOINT', rowVersion: 1, duration: { num: 1, den: 1 }, tracks: [], markers: [], readinessState: 'READY' }
const workspace: TimelineWorkspace = { timeline, mediaProfile: profile, revisions: [revision], currentRevision: revision, needsYou: [] }

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
  it('loads the project workspace and sends a duration-bearing empty checkpoint', async () => {
    const core = client()
    render(<TimelineView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('Main cut')).toBeTruthy()
    expect(screen.getByText('Đã duyệt')).toBeTruthy()
    await waitFor(() => expect(core.getTimelineWorkspace).toHaveBeenCalled())
    expect(await screen.findByText('Duration num')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Duration num'), { target: { value: '24000' } })
    fireEvent.change(screen.getByLabelText('Duration den'), { target: { value: '1001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu checkpoint rỗng' }))
    await waitFor(() => expect(core.createTimelineRevision).toHaveBeenCalledWith(project.id, timeline.id, expect.objectContaining({ mediaProfileRevisionId: profileRevision.id, duration: { num: 24000, den: 1001 }, tracks: [], markers: [] }), timeline.rowVersion, expect.any(String)))
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
})
