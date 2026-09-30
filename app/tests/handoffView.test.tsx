import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HandoffView } from '../src/App'
import type { AssetSummary, CoreClient, DashboardSnapshot, ExternalEdit, HandoffWorkspace, ProjectSummary, ReviewSession, TimelineRevision, TimelineSummary, TimelineWorkspace } from '../src/types'

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

const completedResult: HandoffWorkspace = {
  ...result,
  exportSession: {
    ...result.exportSession!, state: 'COMPLETED', rowVersion: 6,
    outputAssetRevisionId: 'interchange-revision-1', outputContentHash: 'd'.repeat(64), outputByteSize: 512,
    validationSnapshot: { schemaVersion: 1, exportProfile: 'GENERIC_INTERCHANGE_V1', artifactCount: 0, clipCount: 0, documentHash: 'd'.repeat(64), verifiedAt: '2026-09-30T00:00:00.000Z' },
    nextStep: 'Interchange JSON đã sẵn sàng tải xuống',
  },
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

  it('keeps verified interchange build disabled while Core is offline even when the bridge exposes the command', async () => {
    const core = client({
      isLive: () => false,
      getHandoffs: vi.fn(async () => [{ exportSession: result.exportSession!, handoffManifest: result.handoffManifest! }]),
      buildTimelineInterchangeExport: vi.fn(async () => result),
    })
    render(<HandoffView snapshot={{ ...snapshot, system: { ...snapshot.system, connected: false, offline: true } }} locale="vi" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText(/Core đang offline/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Tạo interchange đã verify' })).toHaveProperty('disabled', true)
    expect(core.buildTimelineInterchangeExport).not.toHaveBeenCalled()
  })

  it('downloads a safe metadata evidence copy and never serializes unknown unsafe fields', async () => {
    const originalUrlDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'URL')
    const originalBlobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob')
    const createObjectURL = vi.fn(() => 'blob:cineforge-manifest')
    const revokeObjectURL = vi.fn()
    const blobParts: unknown[][] = []
    class CapturingBlob {
      constructor(parts: unknown[]) { blobParts.push(parts) }
    }
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: { createObjectURL, revokeObjectURL } })
    Object.defineProperty(globalThis, 'Blob', { configurable: true, value: CapturingBlob })
    let downloadedName = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloadedName = this.download })
    const unsafeManifest = {
      ...result.handoffManifest!,
      manifest: {
        manifest_type: 'CINEFORGE_TIMELINE_HANDOFF',
        source: { project_id: project.id, timeline_id: timeline.id, unsafe_path: 'C:\\secret\\source.mov', credentials: 'should-never-cross' },
        api_endpoint: 'http://127.0.0.1:48201',
      },
    }
    const downloadedResult: HandoffWorkspace = { ...result, handoffManifest: unsafeManifest }
    const core = client({ createHandoffManifest: vi.fn(async () => downloadedResult) })
    try {
      render(<HandoffView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Tạo manifest' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Tải manifest JSON' }))
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
      const downloaded = String(blobParts[0]?.[0] ?? '')
      expect(downloaded).toContain('CINEFORGE_HANDOFF_EVIDENCE_V1')
      expect(downloaded).toContain(project.id)
      expect(downloaded).not.toContain('unsafe_path')
      expect(downloaded).not.toContain('should-never-cross')
      expect(downloaded).not.toContain('api_endpoint')
      expect(downloadedName).toMatch(/^cineforge-handoff-UNKNOWN_EDITOR-c{16}\.json$/)
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:cineforge-manifest'))
    } finally {
      click.mockRestore()
      if (originalUrlDescriptor) Object.defineProperty(globalThis, 'URL', originalUrlDescriptor)
      else delete (globalThis as { URL?: unknown }).URL
      if (originalBlobDescriptor) Object.defineProperty(globalThis, 'Blob', originalBlobDescriptor)
      else delete (globalThis as { Blob?: unknown }).Blob
    }
  })

  it('keeps verified interchange build behind exact detail evidence and exposes the completed download action', async () => {
    const core = client({
      getHandoffs: vi.fn(async () => [{ exportSession: result.exportSession!, handoffManifest: result.handoffManifest! }]),
      buildTimelineInterchangeExport: vi.fn(async () => completedResult),
      resolveTimelineInterchangeDownload: vi.fn(async () => ({ projectId: project.id, exportSessionId: 'session-1', downloadUrl: 'http://core/v1/projects/project-1/exports/session-1/download?token=opaque', byteSize: 512, contentHash: 'd'.repeat(64) })),
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    try {
      render(<HandoffView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
      const buildButton = await screen.findByRole('button', { name: 'Tạo interchange đã verify' })
      await waitFor(() => expect(buildButton).toHaveProperty('disabled', false))
      fireEvent.click(buildButton)
      await waitFor(() => expect(core.buildTimelineInterchangeExport).toHaveBeenCalledWith(project.id, 'session-1', 'b'.repeat(64), 2, expect.stringContaining('timeline-interchange:project-1:session-1')))
      expect((await screen.findAllByText('COMPLETED')).length).toBeGreaterThanOrEqual(1)
      const downloadButton = await screen.findByRole('button', { name: 'Tải interchange đã verify' })
      expect(downloadButton).toHaveProperty('disabled', false)
      fireEvent.click(downloadButton)
      await waitFor(() => expect(core.resolveTimelineInterchangeDownload).toHaveBeenCalledWith(project.id, 'session-1'))
      expect(click).toHaveBeenCalled()
    } finally {
      click.mockRestore()
    }
  })

  it('shows a blocked export next step and keeps build available for an explicit retry', async () => {
    const blocked: HandoffWorkspace = {
      ...result,
      exportSession: { ...result.exportSession!, state: 'BLOCKED_RIGHTS', rowVersion: 4, nextStep: 'Bổ sung rights/consent cho asset trước khi retry.' },
    }
    const core = client({ getHandoffs: vi.fn(async () => [{ exportSession: blocked.exportSession!, handoffManifest: blocked.handoffManifest! }]), getHandoff: vi.fn(async () => blocked), buildTimelineInterchangeExport: vi.fn(async () => blocked) })
    render(<HandoffView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
    expect(await screen.findByText(/Bổ sung rights\/consent/)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo interchange đã verify' })).toHaveProperty('disabled', false))
  })

  it('registers a selected managed returned interchange without applying it to the timeline', async () => {
    const returnedAsset: AssetSummary = { id: 'asset-returned', projectId: project.id, name: 'Returned cut', assetType: 'TIMELINE_INTERCHANGE', originType: 'EXTERNAL_EDIT', state: 'ACTIVE', availability: 'AVAILABLE', readinessState: 'READY', revisionId: 'returned-revision-1', contentHash: 'e'.repeat(64), byteSize: 1024, warnings: [] }
    const registered: ExternalEdit = { id: 'external-edit-1', projectId: project.id, handoffManifestId: 'manifest-1', exportSessionId: 'session-1', timelineRevisionId: approvedRevision.id, returnedAssetRevisionId: returnedAsset.revisionId, lineageConfidence: 'PARTIAL', validationState: 'REGISTERED', sourceDocumentHash: returnedAsset.contentHash, sourceDocumentByteSize: returnedAsset.byteSize, returnedRightsStatus: 'ALLOWED', validationSnapshot: { schemaVersion: 1 }, contractDiffCount: 1, contractDiffs: [{ id: 'diff-1', diffType: 'DURATION', severity: 'WARNING', before: { duration: '24/1' }, after: { duration: '25/1' } }], nextStep: 'Review the returned interchange before applying it.', rowVersion: 1 }
    const registerExternalEdit = vi.fn(async () => registered)
    const core = client({ getHandoffs: vi.fn(async () => [{ exportSession: completedResult.exportSession!, handoffManifest: completedResult.handoffManifest! }]), getHandoff: vi.fn(async () => completedResult), getAssets: vi.fn(async () => [returnedAsset]), getExternalEdits: vi.fn(async () => ({ items: [] })), registerExternalEdit })
    render(<HandoffView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)
    const registerButton = await screen.findByRole('button', { name: 'Đăng ký interchange trả về' })
    const returnedAssetSelect = await screen.findByRole('combobox', { name: 'Asset interchange trả về' })
    await waitFor(() => expect(returnedAssetSelect).toHaveProperty('disabled', false))
    fireEvent.change(returnedAssetSelect, { target: { value: 'returned-revision-1' } })
    await waitFor(() => expect(registerButton).toHaveProperty('disabled', false))
    fireEvent.click(registerButton)
    await waitFor(() => expect(registerExternalEdit).toHaveBeenCalledWith(project.id, expect.objectContaining({ handoffManifestId: 'manifest-1', exportSessionId: 'session-1', returnedAssetRevisionId: 'returned-revision-1', expectedVersion: 6, lineageConfidence: 'PARTIAL' }), expect.stringMatching(/^external-edit-register:/)))
    expect(await screen.findByText('Đã đăng ký')).toBeTruthy()
    expect(screen.getByText('Review the returned interchange before applying it.')).toBeTruthy()
  })
})
