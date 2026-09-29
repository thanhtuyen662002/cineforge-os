import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReleaseView } from '../src/App'
import type { CoreClient, DashboardSnapshot, ProjectSummary, ReleaseReadiness } from '../src/types'

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
})
