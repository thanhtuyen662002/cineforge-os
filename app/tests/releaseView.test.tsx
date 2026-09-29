import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReleaseView } from '../src/App'
import type { CoreClient, DashboardSnapshot, ProjectSummary, ReleaseCandidate, ReleaseReadiness } from '../src/types'

const projectOne: ProjectSummary = {
  id: 'project-1', name: 'Phim thử', kind: 'Project', updatedAt: 'Vừa cập nhật', stage: 'ACTIVE', stageDetail: 'test',
  cover: 'linear-gradient(145deg, #7664a9, #35446a)', accent: '#b9a0ff', completion: { done: 0, total: 0 }, health: 'healthy',
  nextAction: 'Mở', nextActionLabel: 'Mở', storage: '0 B', productionItems: [],
}
const projectTwo = { ...projectOne, id: 'project-2', name: 'Second film' }
const snapshot: DashboardSnapshot = {
  generatedAt: new Date().toISOString(), projects: [projectOne, projectTwo], decisions: [], activity: [],
  system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false },
}

const gateKeys = ['PICTURE', 'AUDIO', 'LOCALIZATION', 'TECHNICAL_MEDIA', 'QC', 'RIGHTS', 'MISSING_MEDIA', 'UNRESOLVED_DECISIONS']
const readiness: ReleaseReadiness = {
  projectId: projectOne.id, projectTitle: projectOne.name, overallState: 'NOT_CHECKED', policy: { purpose: 'RELEASE', unknownBlocks: true },
  exactSource: { timelineId: 'timeline-1', local_path: 'C:\\secret\\file.mov' }, blockingGateKeys: ['QC'], blockingCount: 3, unknownCount: 2,
  gateManifestHash: 'a'.repeat(64), nextStep: 'Resolve the first blocker.', gates: gateKeys.map((key, index) => ({
    key, state: index === 0 ? 'PASS' : index === 1 ? 'FAIL' : 'UNKNOWN', blocking: index !== 0,
    reason: index === 1 ? 'QC_REJECTED' : undefined, nextStep: index === 1 ? 'Open a new review.' : undefined,
    evidence: { count: index + 1, provider_path: 'C:\\secret\\provider', content_hash: 'b'.repeat(64) },
  })),
}

const readyReadiness: ReleaseReadiness = {
  ...readiness,
  overallState: 'READY',
  exactSource: { timeline_revision_id: 'revision-1', media_profile_revision_id: 'profile-1', review_session_id: 'review-1' },
  blockingGateKeys: [], blockingCount: 0, unknownCount: 0, nextStep: 'Ready for metadata candidate.',
  gates: gateKeys.map((key) => ({ key, state: 'PASS' as const, blocking: false, evidence: { count: 1 } })),
}

const candidateDraft: ReleaseCandidate = {
  id: 'candidate-1', projectId: projectOne.id, timelineRevisionId: 'revision-1',
  mediaProfileRevisionId: 'profile-1', reviewSessionId: 'review-1', readinessDigest: 'a'.repeat(64),
  rightsSnapshotHash: 'b'.repeat(64), state: 'DRAFT', rowVersion: 1, snapshotSchemaVersion: 1,
  nextStep: 'Metadata only.',
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    isLive: () => true,
    getDashboard: vi.fn(async () => snapshot), acknowledgeDecision: vi.fn(async () => undefined), createProject: vi.fn(async () => projectOne),
    addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getReleaseReadiness: vi.fn(async () => readiness),
    ...overrides,
  }
}

describe('ReleaseView', () => {
  it('renders all eight gates as a read-only, fail-closed workspace and redacts unsafe evidence', async () => {
    const core = client()
    render(<ReleaseView snapshot={snapshot} locale="vi" client={core} />)

    expect(await screen.findByText('Kiểm tra readiness')).toBeTruthy()
    expect(await screen.findByText('Picture lock')).toBeTruthy()
    expect(screen.getByText('Quyết định đang mở')).toBeTruthy()
    expect(screen.getByText('QC_REJECTED')).toBeTruthy()
    expect(screen.getByText('Resolve the first blocker.')).toBeTruthy()
    expect(screen.queryByText(/provider_path|C:\\secret\\provider|local_path/)).toBeNull()
    expect(screen.getByRole('button', { name: /Export master/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Publish/ })).toHaveProperty('disabled', true)
    expect(core.getReleaseReadiness).toHaveBeenCalledWith(projectOne.id, expect.any(AbortSignal))
  })

  it('rebinds the exact project and ignores a stale response after switching', async () => {
    let resolveFirst: ((value: ReleaseReadiness) => void) | undefined
    const first = new Promise<ReleaseReadiness>((resolve) => { resolveFirst = resolve })
    const second = { ...readiness, projectId: projectTwo.id, projectTitle: projectTwo.name, overallState: 'READY' as const, blockingCount: 0, unknownCount: 0 }
    const getReleaseReadiness = vi.fn((id: string) => id === projectOne.id ? first : Promise.resolve(second))
    const core = client({ getReleaseReadiness })
    render(<ReleaseView snapshot={snapshot} locale="en" client={core} />)
    const projectSelect = await screen.findByRole('combobox', { name: 'Readiness project' })
    fireEvent.change(projectSelect, { target: { value: projectTwo.id } })
    expect(await screen.findByText('Ready')).toBeTruthy()
    resolveFirst?.(readiness)
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy())
    expect(getReleaseReadiness).toHaveBeenCalledWith(projectTwo.id, expect.any(AbortSignal))
    expect(getReleaseReadiness.mock.calls.map(([id]) => id)).toContain(projectOne.id)
  })

  it('does not conclude from an offline snapshot or an unsupported bridge', async () => {
    const offline = client({ isLive: () => false, getReleaseReadiness: vi.fn(async () => readiness) })
    render(<ReleaseView snapshot={{ ...snapshot, system: { ...snapshot.system, connected: false, offline: true } }} locale="en" client={offline} />)
    expect(await screen.findByText(/Core is offline/i)).toBeTruthy()
    expect(offline.getReleaseReadiness).not.toHaveBeenCalled()

    const unsupported = client()
    delete unsupported.getReleaseReadiness
    render(<ReleaseView snapshot={snapshot} locale="en" client={unsupported} />)
    expect(await screen.findByText(/does not expose release readiness/i)).toBeTruthy()
  })

  it('creates a ready metadata candidate and cancels it with confirmation and the current row version', async () => {
    const created = vi.fn(async (_projectId: string, _key?: string) => candidateDraft)
    const cancelled = vi.fn(async (_projectId: string, _id: string, expectedVersion: number, _key?: string) => ({ ...candidateDraft, state: 'CANCELLED' as const, rowVersion: expectedVersion + 1 }))
    const core = client({
      getReleaseReadiness: vi.fn(async () => readyReadiness),
      getReleaseCandidates: vi.fn(async () => ({ items: [], projectionSeq: 1 })),
      createReleaseCandidateDraft: created,
      cancelReleaseCandidateDraft: cancelled,
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      render(<ReleaseView snapshot={snapshot} locale="vi" client={core} />)
      const createButton = await screen.findByRole('button', { name: 'Tạo candidate' })
      expect(createButton).toHaveProperty('disabled', false)
      fireEvent.click(createButton)
      await waitFor(() => expect(created).toHaveBeenCalledTimes(1))
      expect(created.mock.calls[0][0]).toBe(projectOne.id)
      expect(created.mock.calls[0][1]).toMatch(/^release-candidate-create:project-1:a{64}:/)
      expect(await screen.findByText('candidate-1')).toBeTruthy()
      const cancelButton = await screen.findByRole('button', { name: 'Huỷ draft' })
      fireEvent.click(cancelButton)
      await waitFor(() => expect(cancelled).toHaveBeenCalledWith(projectOne.id, candidateDraft.id, 1, `release-candidate-cancel:${candidateDraft.id}:v1`))
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('Đã huỷ')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Tạo candidate' })).toHaveProperty('disabled', true)
      expect(screen.getByText(/exact readiness này đã có candidate bị huỷ/i)).toBeTruthy()
    } finally {
      confirm.mockRestore()
    }
  })

  it('keeps candidate creation disabled for blocked or unknown readiness', async () => {
    const blocked: ReleaseReadiness = {
      ...readiness,
      overallState: 'BLOCKED', blockingCount: 1, unknownCount: 1,
      gates: gateKeys.map((key, index) => ({ key, state: index === 0 ? 'UNKNOWN' as const : 'PASS' as const, blocking: index === 0, reason: index === 0 ? 'EVIDENCE_UNKNOWN' : undefined })),
    }
    const core = client({
      getReleaseReadiness: vi.fn(async () => blocked),
      getReleaseCandidates: vi.fn(async () => ({ items: [], projectionSeq: 1 })),
      createReleaseCandidateDraft: vi.fn(async () => candidateDraft),
    })
    render(<ReleaseView snapshot={snapshot} locale="en" client={core} />)
    const createButton = await screen.findByRole('button', { name: 'Create candidate' })
    expect(createButton).toHaveProperty('disabled', true)
    expect(await screen.findByText(/only when readiness is READY/i)).toBeTruthy()
  })

  it('ignores stale candidate lists and late creates after switching projects', async () => {
    let resolveFirstReadiness: ((value: ReleaseReadiness) => void) | undefined
    let resolveFirstCandidates: ((value: { items: ReleaseCandidate[] }) => void) | undefined
    let resolveFirstCreate: ((value: ReleaseCandidate) => void) | undefined
    const firstReadiness = new Promise<ReleaseReadiness>((resolve) => { resolveFirstReadiness = resolve })
    const firstCandidates = new Promise<{ items: ReleaseCandidate[] }>((resolve) => { resolveFirstCandidates = resolve })
    const firstCandidate = { ...candidateDraft, id: 'candidate-old', projectId: projectOne.id }
    const secondCandidate = { ...candidateDraft, id: 'candidate-new', projectId: projectTwo.id, state: 'CANCELLED' as const }
    const secondReadiness = { ...readyReadiness, projectId: projectTwo.id, projectTitle: projectTwo.name }
    const getReleaseReadiness = vi.fn((id: string) => id === projectOne.id ? firstReadiness : Promise.resolve(secondReadiness))
    const getReleaseCandidates = vi.fn((id: string) => id === projectOne.id ? firstCandidates : Promise.resolve({ items: [secondCandidate] }))
    const create = vi.fn(() => new Promise<ReleaseCandidate>((resolve) => { resolveFirstCreate = resolve }))
    const core = client({ getReleaseReadiness, getReleaseCandidates, createReleaseCandidateDraft: create })
    render(<ReleaseView snapshot={snapshot} locale="en" client={core} />)
    const projectSelect = await screen.findByRole('combobox', { name: 'Readiness project' })
    fireEvent.change(projectSelect, { target: { value: projectTwo.id } })
    expect(await screen.findByText('candidate-new')).toBeTruthy()
    resolveFirstReadiness?.({ ...readyReadiness, projectId: projectOne.id })
    resolveFirstCandidates?.({ items: [firstCandidate] })
    await waitFor(() => expect(screen.queryByText('candidate-old')).toBeNull())

    // The late mutation belongs to project one. Switching before it resolves
    // must not insert its result or leave the project-two UI locked.
    fireEvent.change(projectSelect, { target: { value: projectOne.id } })
    await waitFor(() => expect(getReleaseReadiness).toHaveBeenCalledWith(projectOne.id, expect.any(AbortSignal)))
    // Resolve the latest project-one reads so the create action is available.
    resolveFirstReadiness?.({ ...readyReadiness, projectId: projectOne.id })
    resolveFirstCandidates?.({ items: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create candidate' })).not.toHaveProperty('disabled', true))
    fireEvent.click(screen.getByRole('button', { name: 'Create candidate' }))
    fireEvent.change(projectSelect, { target: { value: projectTwo.id } })
    resolveFirstCreate?.(firstCandidate)
    await waitFor(() => expect(screen.queryByText('candidate-old')).toBeNull())
    expect(screen.queryByText('candidate-new')).toBeTruthy()
  })
})
