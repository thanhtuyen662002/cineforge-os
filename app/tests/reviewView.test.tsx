import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewView } from '../src/App'
import type { CoreClient, DashboardSnapshot, ProjectSummary, ReviewSession, ReviewWorkspace, TimelineRevision, TimelineSummary, TimelineWorkspace } from '../src/types'

const project: ProjectSummary = {
  id: 'project-1', name: 'Phim thử', kind: 'Project', updatedAt: 'Vừa cập nhật', stage: 'ACTIVE', stageDetail: 'test',
  cover: 'linear-gradient(145deg, #7664a9, #35446a)', accent: '#b9a0ff', completion: { done: 0, total: 0 },
  health: 'healthy', nextAction: 'Mở', nextActionLabel: 'Mở', storage: '0 B', productionItems: [],
}

const snapshot: DashboardSnapshot = {
  generatedAt: new Date().toISOString(), projects: [project], decisions: [], activity: [],
  system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false },
}

const timeline: TimelineSummary = { id: 'timeline-1', projectId: project.id, scopeType: 'PROJECT', scopeId: project.id, code: 'MAIN', title: 'Main cut', state: 'ACTIVE', rowVersion: 2 }
const revision: TimelineRevision = { id: 'revision-1', timelineId: timeline.id, mediaProfileRevisionId: 'profile-rev-1', state: 'CANDIDATE', rowVersion: 2, duration: { num: 24, den: 1 }, tracks: [], markers: [], readinessState: 'READY' }
const timelineWorkspace: TimelineWorkspace = { timeline, mediaProfile: null, revisions: [revision], currentRevision: revision, needsYou: [] }

function makeReview(state: ReviewSession['state'] = 'OPEN'): ReviewSession {
  return { id: 'review-1', projectId: project.id, subjectType: 'TIMELINE_REVISION', subjectId: revision.id, subjectRevisionId: revision.id, mediaProfileRevisionId: 'profile-rev-1', dependencySnapshotHash: 'b'.repeat(64), subjectContentHash: 'a'.repeat(64), state, stale: false, rowVersion: state === 'OPEN' ? 1 : 2, nextStep: 'Chọn quyết định', humanReview: state === 'SUBMITTED' ? { id: 'human-1', reviewSessionId: 'review-1', decision: 'APPROVE', notes: 'Ổn', reasonCodes: [] } : null }
}

function reviewWorkspace(state: ReviewSession['state'] = 'OPEN'): ReviewWorkspace {
  return { review: makeReview(state), subject: revision, timeline, mediaProfileRevision: null, snapshot: { hash: 'b'.repeat(64), currentHash: 'b'.repeat(64), stale: false }, projectionSeq: 4 }
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    getDashboard: vi.fn(async () => snapshot), acknowledgeDecision: vi.fn(async () => undefined), createProject: vi.fn(async () => project), addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getReviews: vi.fn(async () => []), getReview: vi.fn(async () => reviewWorkspace()), getTimelines: vi.fn(async () => [timeline]), getTimelineWorkspace: vi.fn(async () => timelineWorkspace),
    openReview: vi.fn(async () => reviewWorkspace()), submitReview: vi.fn(async () => reviewWorkspace('SUBMITTED')), transitionTimelineRevision: vi.fn(async () => timelineWorkspace),
    ...overrides,
  }
}

describe('ReviewView', () => {
  it('opens and submits an exact candidate review before exposing approval', async () => {
    const core = client()
    render(<ReviewView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('Main cut')).toBeTruthy()
    expect(screen.getByText('Chưa có review')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Mở review' }))
    await waitFor(() => expect(core.openReview).toHaveBeenCalledWith(project.id, revision.id, revision.rowVersion, expect.any(String)))
    expect(await screen.findByText('Review workspace')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Ổn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi quyết định' }))
    await waitFor(() => expect(core.submitReview).toHaveBeenCalledWith(project.id, 'review-1', 'APPROVE', 1, 'Ổn', [], expect.any(String)))
  })

  it('keeps stale evidence visible and disables mutation controls', async () => {
    const stale = { ...makeReview('SUBMITTED'), stale: true, state: 'STALE' }
    const core = client({ getReviews: vi.fn(async () => [stale]), getReview: vi.fn(async () => ({ ...reviewWorkspace('SUBMITTED'), review: stale, snapshot: { hash: 'b'.repeat(64), currentHash: 'c'.repeat(64), stale: true } })) })
    render(<ReviewView snapshot={snapshot} locale="en" client={core} onToast={vi.fn()} />)
    expect((await screen.findAllByText('STALE')).length).toBeGreaterThan(0)
    expect(screen.getByText(/snapshot no longer matches/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve timeline/i })).toBeNull()
  })
})
