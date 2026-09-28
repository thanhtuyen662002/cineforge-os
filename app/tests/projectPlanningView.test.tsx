import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreClientError } from '../src/coreAdapter'
import { ProjectPlanningView } from '../src/App'
import type { CoreClient, DashboardSnapshot, ProjectWorkspace, TaskSummary } from '../src/types'

const project = {
  id: 'project-1', name: 'Phim thử', kind: 'Project', updatedAt: 'Vừa cập nhật', stage: 'ACTIVE', stageDetail: 'test',
  cover: 'linear-gradient(145deg, #7664a9, #35446a)', accent: '#b9a0ff', completion: { done: 0, total: 0 },
  health: 'healthy' as const, nextAction: 'Mở dự án', nextActionLabel: 'Mở', storage: '0 B', productionItems: [],
}

const snapshot: DashboardSnapshot = {
  generatedAt: new Date().toISOString(), projects: [project], decisions: [], activity: [],
  system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false },
}

function workspace(): ProjectWorkspace {
  return {
    projectId: project.id, productionItems: [], tasks: [{ id: 'task-1', projectId: project.id, title: 'Khoá shot list', description: '', status: 'PLANNED', priority: 0, rowVersion: 1 }],
    shots: [], notes: [], shotsCount: 0, notesCount: 0, projectionSeq: 1,
  }
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    getDashboard: vi.fn(async () => snapshot),
    acknowledgeDecision: vi.fn(async () => undefined),
    createProject: vi.fn(async () => project),
    addProductionItem: vi.fn(async () => ({ id: 'item', title: 'item', detail: '', state: 'todo' as const })),
    getProjectWorkspace: vi.fn(async () => workspace()),
    ...overrides,
  }
}

describe('ProjectPlanningView', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('exposes keyboard-addressable task, planning-shot, and note tabs', async () => {
    const createShot = vi.fn(async () => ({ id: 'shot-1', projectId: project.id, code: 'SH010', title: 'Cửa mở', lifecycleState: 'ACTIVE' as const, rowVersion: 1 }))
    const addNote = vi.fn(async () => ({ id: 'note-1', projectId: project.id, entityType: 'PROJECT' as const, entityId: project.id, body: 'Nhớ đạo cụ', createdAt: new Date().toISOString() }))
    render(<ProjectPlanningView snapshot={snapshot} projectId={project.id} locale="vi" client={client({ createShot, addNote })} onBack={vi.fn()} />)

    expect(await screen.findByText('Khoá shot list')).toBeTruthy()
    const shotTab = screen.getByRole('tab', { name: 'Shot kế hoạch' })
    fireEvent.click(shotTab)
    expect(screen.getByRole('tabpanel').textContent).toContain('Đây là bản ghi lập kế hoạch')
    fireEvent.change(screen.getByLabelText('Mã shot'), { target: { value: 'SH010' } })
    fireEvent.change(screen.getByLabelText('Tên shot kế hoạch'), { target: { value: 'Cửa mở' } })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm shot kế hoạch' }))
    await waitFor(() => expect(createShot).toHaveBeenCalledWith(project.id, 'SH010', 'Cửa mở', expect.any(String)))
    await waitFor(() => expect((screen.getByLabelText('Mã shot') as HTMLInputElement).value).toBe(''))

    fireEvent.click(screen.getByRole('tab', { name: 'Ghi chú' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Ghi chú' }), { target: { value: 'Nhớ đạo cụ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú' }))
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(project.id, { entityType: 'PROJECT', entityId: project.id }, 'Nhớ đạo cụ', expect.any(String)))
  })

  it('shows a localized stale conflict and leaves the workspace usable', async () => {
    const updateTask = vi.fn(async () => { throw new CoreClientError('stale', { code: 'STALE_REVISION', category: 'STALE_REVISION', needsUser: true }) })
    render(<ProjectPlanningView snapshot={snapshot} projectId={project.id} locale="vi" client={client({ updateTask })} onBack={vi.fn()} />)
    expect(await screen.findByText('Khoá shot list')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Trạng thái: Khoá shot list'), { target: { value: 'IN_PROGRESS' } })
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace đã thay đổi ở nơi khác')
    expect(screen.getByText('Khoá shot list')).toBeTruthy()
  })

  it('offers only valid lifecycle transitions for the current records', async () => {
    const getProjectWorkspace = vi.fn(async () => ({
      ...workspace(),
      shots: [{ id: 'shot-1', projectId: project.id, code: 'SH010', title: 'Cửa mở', lifecycleState: 'ACTIVE' as const, rowVersion: 1 }],
    }))
    render(<ProjectPlanningView snapshot={snapshot} projectId={project.id} locale="vi" client={client({ getProjectWorkspace })} onBack={vi.fn()} />)

    expect(await screen.findByText('Khoá shot list')).toBeTruthy()
    const taskStatus = screen.getByLabelText('Trạng thái: Khoá shot list') as HTMLSelectElement
    expect(Array.from(taskStatus.options).map((option) => option.value)).toEqual(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED'])

    fireEvent.click(screen.getByRole('tab', { name: 'Shot kế hoạch' }))
    const shotLifecycle = screen.getByLabelText('Lifecycle của SH010') as HTMLSelectElement
    expect(Array.from(shotLifecycle.options).map((option) => option.value)).toEqual(['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED'])
  })

  it('disables a create action while Core is pending and clears the draft after Core confirms it', async () => {
    let resolveCreate: ((value: TaskSummary) => void) | undefined
    const createTask = vi.fn(() => new Promise<TaskSummary>((resolve) => { resolveCreate = resolve }))
    render(<ProjectPlanningView snapshot={snapshot} projectId={project.id} locale="vi" client={client({ createTask })} onBack={vi.fn()} />)

    expect(await screen.findByText('Khoá shot list')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Tên công việc'), { target: { value: 'Thêm continuity check' } })
    const submit = screen.getByRole('button', { name: 'Thêm công việc' }) as HTMLButtonElement
    fireEvent.click(submit)
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(submit.disabled).toBe(true)
    resolveCreate?.({ id: 'task-2', projectId: project.id, title: 'Thêm continuity check', description: '', status: 'PLANNED', priority: 0, rowVersion: 1 })
    await waitFor(() => expect((screen.getByLabelText('Tên công việc') as HTMLInputElement).value).toBe(''))
    expect(submit.disabled).toBe(true)
  })

  it('keeps loading truthful, exposes retry, and supports English keyboard tab navigation', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const pending = new Promise<ProjectWorkspace>((_resolve, reject) => { rejectFirst = reject })
    const getProjectWorkspace = vi.fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue(workspace())
    render(<ProjectPlanningView snapshot={snapshot} projectId={project.id} locale="en" client={client({ getProjectWorkspace })} onBack={vi.fn()} />)

    expect(screen.getByText('Reading workspace from Core…')).toBeTruthy()
    expect(screen.getByRole('tabpanel').textContent).toContain('Preparing workspace')
    rejectFirst?.(new Error('Core unavailable'))
    expect((await screen.findByRole('alert')).textContent).toContain('Core unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Khoá shot list')).toBeTruthy()

    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(tabs[4].getAttribute('aria-selected')).toBe('true')
    expect(tabs[4].getAttribute('aria-controls')).toBe('workspace-panel-context')
    expect(tabs[0].getAttribute('aria-controls')).toBeNull()
  })
})
