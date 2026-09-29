import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsView } from '../src/App'
import type { BackupSummary, BackupWorkspace, CoreClient, DashboardSnapshot, StagingEvidence, StagingWorkspace, StorageAdmission } from '../src/types'

const snapshot: DashboardSnapshot = {
  generatedAt: '2026-09-29T08:00:00.000Z',
  projects: [],
  decisions: [],
  activity: [],
  system: { connected: true, offline: false, storageUsed: '2 MB', storageTotal: '1 GB', storageAttention: false },
}

const backup: BackupSummary = {
  id: 'backup-1', backupType: 'FULL_LOCAL', durabilityClass: 'LOCAL_WRITABLE', failureDomain: 'LOCAL_MACHINE',
  destinationName: 'backup-1', manifestName: 'manifest.json', snapshotName: 'cineforge.sqlite', state: 'VERIFIED',
  manifestSha256: 'a'.repeat(64), dbSha256: 'b'.repeat(64), byteSize: 2048, objectCount: 2, rowVersion: 1,
  createdAt: '2026-09-29T07:59:00.000Z', completedAt: '2026-09-29T07:59:02.000Z',
}
const workspace: BackupWorkspace = {
  backup,
  verifications: [{ id: 'verification-1', backupId: backup.id, outcome: 'VERIFIED', integrityState: 'PASS', createdAt: backup.completedAt }],
}
const admission: StorageAdmission = {
  destinationName: 'backups', durabilityClass: 'LOCAL_WRITABLE', failureDomain: 'LOCAL_MACHINE',
  estimatedBytes: 1000, availableBytes: 5000, reserveBytes: 500, databaseBytes: 200, objectBytes: 300, objectCount: 2,
}

const writingStaging: StagingEvidence = {
  id: 'stage-1', state: 'WRITING', tempName: 'clip.mov', expectedSize: 1024, currentSize: 512,
  hashAlgorithm: 'SHA-256', sha256: 'a'.repeat(64), reparseState: 'CLEAR',
  sourceFileIdentityState: 'MATCH', osFileIdentityState: 'MATCH', rowVersion: 2,
  updatedAt: '2026-09-29T08:00:00.000Z',
}
const registeredStaging: StagingEvidence = { ...writingStaging, id: 'stage-registered', state: 'REGISTERED', tempName: 'done.mov', rowVersion: 4 }

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    isLive: () => true,
    getDashboard: vi.fn(async () => snapshot),
    acknowledgeDecision: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ id: 'project', name: 'Project', kind: 'Project', updatedAt: '', stage: 'ACTIVE', stageDetail: '', cover: '', accent: '', completion: { done: 0, total: 0 }, health: 'healthy', nextAction: '', nextActionLabel: '', storage: '0 B', productionItems: [] })),
    addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getBackups: vi.fn(async () => [backup]),
    getBackup: vi.fn(async () => workspace),
    getStorageAdmission: vi.fn(async () => admission),
    createBackup: vi.fn(async () => ({ backup, verification: workspace.verifications[0] })),
    verifyBackup: vi.fn(async () => ({ backup: { ...backup, rowVersion: 2 }, verification: { ...workspace.verifications[0], id: 'verification-2' } })),
    getStaging: vi.fn(async () => ({ items: [] } as StagingWorkspace)),
    reconcileStaging: vi.fn(async () => ({ items: [] } as StagingWorkspace)),
    ...overrides,
  }
}

describe('SettingsView backup workspace', () => {
  it('loads admission and lets the user create then verify a redacted local backup', async () => {
    const core = client()
    render(<SettingsView snapshot={snapshot} locale="en" client={core} theme="dark" onThemeChange={vi.fn()} onLocaleChange={vi.fn()} onRefresh={vi.fn()} refreshLabel="Refresh" onToast={vi.fn()} />)

    expect(await screen.findByText('Verified local backups')).toBeTruthy()
    await waitFor(() => expect(core.getStorageAdmission).toHaveBeenCalled())
    const createButton = screen.getByRole('button', { name: 'Create backup' }) as HTMLButtonElement
    expect(createButton.disabled).toBe(false)
    fireEvent.click(createButton)
    await waitFor(() => expect(core.createBackup).toHaveBeenCalledWith({ durabilityClass: 'LOCAL_WRITABLE' }, expect.any(String)))

    const verifyButton = await screen.findByRole('button', { name: 'Verify again' })
    fireEvent.click(verifyButton)
    await waitFor(() => expect(core.verifyBackup).toHaveBeenCalledWith('backup-1', expect.any(String)))
    expect(screen.queryByText(/destination_path/i)).toBeNull()
    expect(screen.queryByText(/C:\\|file:\/\//i)).toBeNull()
  })

  it('fails closed when storage admission is unknown or under pressure', async () => {
    const blockedAdmission: StorageAdmission = { ...admission, estimatedBytes: 6000, availableBytes: 5000 }
    const core = client({ getStorageAdmission: vi.fn(async () => blockedAdmission) })
    render(<SettingsView snapshot={snapshot} locale="vi" client={core} theme="dark" onThemeChange={vi.fn()} onLocaleChange={vi.fn()} onRefresh={vi.fn()} refreshLabel="Tải lại" onToast={vi.fn()} />)

    const createButton = await screen.findByRole('button', { name: 'Tạo backup' }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)
    expect(await screen.findByText(/Dung lượng trống thấp hơn estimate/)).toBeTruthy()
    expect(core.createBackup).not.toHaveBeenCalled()
  })

  it('shows redacted staging states, only enables pending reconcile, and preserves evidence after failure', async () => {
    const getStaging = vi.fn()
      .mockResolvedValueOnce({ items: [writingStaging, registeredStaging] })
      .mockResolvedValue({ items: [{ ...writingStaging, state: 'QUARANTINED' }, registeredStaging] })
    const reconcileStaging = vi.fn(async () => { throw new Error('reconcile failed') })
    const core = client({ getStaging, reconcileStaging })
    render(<SettingsView snapshot={snapshot} locale="en" client={core} theme="dark" onThemeChange={vi.fn()} onLocaleChange={vi.fn()} onRefresh={vi.fn()} refreshLabel="Refresh" onToast={vi.fn()} />)

    expect(await screen.findByText('Import staging')).toBeTruthy()
    expect(await screen.findByText('Writing')).toBeTruthy()
    expect(screen.queryByText(/C:\\private|file:\/\//i)).toBeNull()
    const reconcileButtons = screen.getAllByRole('button', { name: 'Reconcile' }) as HTMLButtonElement[]
    expect(reconcileButtons).toHaveLength(2)
    expect(reconcileButtons[0].disabled).toBe(false)
    expect(reconcileButtons[1].disabled).toBe(true)
    fireEvent.click(reconcileButtons[0])
    await waitFor(() => expect(reconcileStaging).toHaveBeenCalledWith('stage-1', expect.any(String)))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(await screen.findByText('Writing')).toBeTruthy()
  })

  it('fails closed for offline and unsupported staging bridges', async () => {
    const offlineSnapshot = { ...snapshot, system: { ...snapshot.system, connected: false, offline: true } }
    const offlineCore = client({ getStaging: vi.fn(async () => ({ items: [writingStaging] })), reconcileStaging: vi.fn(async () => ({ items: [] })) })
    const offlineView = render(<SettingsView snapshot={offlineSnapshot} locale="vi" client={offlineCore} theme="dark" onThemeChange={vi.fn()} onLocaleChange={vi.fn()} onRefresh={vi.fn()} refreshLabel="Tải lại" onToast={vi.fn()} />)
    expect(await screen.findByText('Staging import')).toBeTruthy()
    const offlineButton = (screen.getByRole('button', { name: 'Reconcile' }) as HTMLButtonElement)
    expect(offlineButton.disabled).toBe(true)
    expect(offlineCore.reconcileStaging).not.toHaveBeenCalled()
    offlineView.unmount()

    const unsupported = client({ getStaging: undefined, reconcileStaging: undefined })
    render(<SettingsView snapshot={snapshot} locale="vi" client={unsupported} theme="dark" onThemeChange={vi.fn()} onLocaleChange={vi.fn()} onRefresh={vi.fn()} refreshLabel="Tải lại" onToast={vi.fn()} />)
    expect(await screen.findByText('Bridge chưa hỗ trợ staging workspace.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reconcile' })).toBeNull()
  })
})
