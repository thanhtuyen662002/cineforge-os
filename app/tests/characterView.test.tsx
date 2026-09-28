import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CharactersView } from '../src/App'
import { CoreClientError } from '../src/coreAdapter'
import type { CharacterSummary, CharacterWorkspace, CoreClient, DashboardSnapshot, ProjectSummary } from '../src/types'

const project: ProjectSummary = {
  id: 'project-1', name: 'Phim thử', kind: 'Project', updatedAt: 'Vừa cập nhật', stage: 'ACTIVE', stageDetail: 'test',
  cover: 'linear-gradient(145deg, #7664a9, #35446a)', accent: '#b9a0ff', completion: { done: 0, total: 0 },
  health: 'healthy', nextAction: 'Mở dự án', nextActionLabel: 'Mở', storage: '0 B', productionItems: [],
}

const snapshot: DashboardSnapshot = {
  generatedAt: new Date().toISOString(), projects: [project], decisions: [], activity: [],
  system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false },
}

function character(overrides: Partial<CharacterSummary> = {}): CharacterSummary {
  return {
    id: 'character-1', projectId: project.id, stableCode: 'MAYA', displayName: 'Maya', lifecycleState: 'ACTIVE', rowVersion: 1,
    visualIdentityPackage: null, voiceIdentityPackage: null, performanceBible: null, needsYou: [], ...overrides,
  }
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  const maya = character()
  const workspace: CharacterWorkspace = { character: maya, generatedAt: new Date().toISOString(), projectionSeq: 4, needsYou: [] }
  return {
    getDashboard: vi.fn(async () => snapshot),
    acknowledgeDecision: vi.fn(async () => undefined),
    createProject: vi.fn(async () => project),
    addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getCharacters: vi.fn(async () => [maya]),
    getCharacterWorkspace: vi.fn(async () => workspace),
    createCharacter: vi.fn(async (_projectId, displayName) => character({ id: 'character-2', displayName, stableCode: displayName.toUpperCase() })),
    createVisualIdentityRevision: vi.fn(async () => ({ id: 'visual-1', kind: 'visual' as const, state: 'DRAFT' })),
    ...overrides,
  }
}

describe('CharactersView', () => {
  it('loads a project character, exposes separate packages, and creates an identity', async () => {
    const core = client()
    render(<CharactersView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)

    expect((await screen.findAllByText('Maya')).length).toBeGreaterThan(0)
    expect(core.getCharacters).toHaveBeenCalledWith(project.id, expect.any(AbortSignal))
    expect(screen.getAllByText('Maya').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Tên nhân vật'), { target: { value: 'Linh' } })
    fireEvent.change(screen.getByLabelText('Mã ổn định (tuỳ chọn)'), { target: { value: 'LINH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo CharacterIdentity' }))
    await waitFor(() => expect(core.createCharacter).toHaveBeenCalledWith(project.id, 'Linh', 'LINH', expect.any(String)))
    expect(await screen.findByText('Linh')).toBeTruthy()
  })

  it('keeps an English load failure visible and retryable', async () => {
    const getCharacters = vi.fn()
      .mockRejectedValueOnce(new Error('Core unavailable'))
      .mockResolvedValue([character()])
    const core = client({ getCharacters })
    render(<CharactersView snapshot={snapshot} locale="en" client={core} onToast={vi.fn()} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Core unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect((await screen.findAllByText('Maya')).length).toBeGreaterThan(0)
    expect(getCharacters).toHaveBeenCalledTimes(2)
  })

  it('keeps the loaded workspace visible when Core asks the user to resolve a create conflict', async () => {
    const createCharacter = vi.fn().mockRejectedValue(new CoreClientError('duplicate', {
      code: 'DUPLICATE_CHARACTER_CODE', category: 'CONFLICT', needsUser: true,
    }))
    const core = client({ createCharacter })
    render(<CharactersView snapshot={snapshot} locale="vi" client={core} onToast={vi.fn()} />)

    expect((await screen.findAllByText('Maya')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Tên nhân vật'), { target: { value: 'Maya 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo CharacterIdentity' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Mã nhân vật đã tồn tại')
    expect(alert.textContent).toContain('Danh sách hiện tại vẫn được giữ nguyên')
    expect(screen.getAllByText('Maya').length).toBeGreaterThan(0)
  })
})
