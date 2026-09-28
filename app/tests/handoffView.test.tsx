import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HandoffView } from '../src/App'
import type { CoreClient, DashboardSnapshot, HandoffWorkspace, ProjectSummary, ReviewSession, TimelineRevision, TimelineSummary, TimelineWorkspace } from '../src/types'

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
const approvedRevision: TimelineRevision = { id: 'revision-approved', timelineId: timeline.id, mediaProfileRevisionId: 'profile-rev-1', state: 'APPROVED', rowVersion: 7, editHash: 'a'.repeat(64), duration: { num: 24, den: 1 }, tracks: [], markers: [], readinessState: 'READY' }
const timelineWorkspace: TimelineWorkspace = { timeline, mediaProfile: null, revisions: [approvedRevision], currentRevision: approvedRevision, needsYou: [] }
const review: ReviewSession = { id: 'review-1', projectId: project.id, subjectType: 'TIMELINE_REVISION', subjectId: approvedRevision.id, subjectRevisionId: approvedRevision.id, mediaProfileRevisionId: 'profile-rev-1', dependencySnapshotHash: 'b'.repeat(64), subjectContentHash: 'a'.repeat(64), state: 'SUBMITTED', stale: false, rowVersion: 3, humanReview: { id: 'human-1', reviewSessionId: 'review-1', decision: 'APPROVE', notes: 'OK', reasonCodes: [] } }

const result: HandoffWorkspace = {
  exportSession: { id: 'session-1', projectId: project.id, timelineRevisionId: approvedRevision.id, deliverableType: 'TIMELINE_INTERCHANGE', targetProfile: 'GENERIC_INTERCHANGE', targetEditor: 'UNKNOWN_EDITOR', targetVersion: '1', state: 'PREFLIGHT', reviewSessionId: review.id, dependencySnapshotHash: 'b'.repeat(64), subjectContentHash: 'a'.repeat(64), mediaProfileRevisionId: 'profile-rev-1', nextStep: 'Review compatibility', rowVersion: 2 },
  handoffManifest: { id: 'manifest-1', exportSessionId: 'session-1', projectId: project.id, targetEditor: 'UNKNOWN_EDITOR', targetVersion: '1', compatibilityProfileVersion: 'HANDOFF_COMPATIBILITY_V1', manifestHash: 'c'.repeat(64), artifactAllowlist: [], compatibility: { profileVersion: 'HANDOFF_COMPATIBILITY_V1', targetEditor: 'UNKNOWN_EDITOR', targetVersion: '1', editableClaim: false, entries: [{ feature: 'timing', status: 'UNKNOWN', detail: 'Unknown editor target.' }] }, sanitizationReport: { policy: 'HANDOFF_SANITIZATION_V1', recorded: true, removedFields: ['local_paths', 'credentials'], nextStep: 'Keep metadata only' } },
  manifestHash: 'c'.repeat(64), compatibilityReport: { profileVersion: 'HANDOFF_COMPATIBILITY_V1', targetEditor: 'UNKNOWN_EDITOR', targetVersion: '1', editableClaim: false, entries: [{ feature: 'timing', status: 'UNKNOWN', detail: 'Unknown editor target.' }] },
  sanitizationReport: { policy: 'HANDOFF_SANITIZATION_V1', recorded: true, removedFields: ['local_paths', 'credentials'], nextStep: 'Keep metadata only' }, nextStep: 'Review compatibility', projectionSeq: 1,
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    getDashboard: vi.fn(async () => snapshot), acknowledgeDecision: vi.fn(async () => undefined), createProject: vi.fn(async () => project), addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getHandoffs: vi.fn(async () => []), getHandoff: vi.fn(async () => result), createHandoffManifest: vi.fn(async () => result),
    getTimelines: vi.fn(async () => [timeline]), getTimelineWorkspace: vi.fn(async () => timelineWorkspace), getReviews: vi.fn(async () => [review]),
    ...overrides,
  }
}

describe('HandoffView', () => {
  it('requires exact approved evidence and creates a conservative manifest', async () => {
    const core = client()
    render(<HandoffView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText('Main cut')).toBeTruthy()
    expect(await screen.findByText('Revision đã approve')).toBeTruthy()
    expect(screen.getByText('review-1')).toBeTruthy()
    const createButton = screen.getByRole('button', { name: 'Tạo manifest' })
    expect(createButton).toHaveProperty('disabled', false)
    fireEvent.click(createButton)
    await waitFor(() => expect(core.createHandoffManifest).toHaveBeenCalledWith(project.id, expect.objectContaining({ timelineRevisionId: approvedRevision.id, reviewSessionId: review.id, dependencySnapshotHash: 'b'.repeat(64), expectedVersion: approvedRevision.rowVersion, targetEditor: 'UNKNOWN_EDITOR', targetVersion: '1' }), expect.any(String)))
    expect(await screen.findByText('Handoff workspace')).toBeTruthy()
    expect(screen.getByText(/Không claim editable/)).toBeTruthy()
    expect(screen.getByText('local_paths')).toBeTruthy()
  })

  it('keeps creation disabled while Core is offline', async () => {
    const core = client({ isLive: () => false })
    render(<HandoffView snapshot={{ ...snapshot, system: { ...snapshot.system, connected: false, offline: true } }} locale="en" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText(/Core is offline/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create manifest' })).toHaveProperty('disabled', true)
  })
})
