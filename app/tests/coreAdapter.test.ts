import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpCoreClient, createCoreClient } from '../src/coreAdapter'

describe('local Core adapter', () => {
  beforeEach(() => localStorage.clear())

  it('persists a created project and its production item across reads', async () => {
    const client = createCoreClient()
    const created = await client.createProject('Test / First Film')

    expect(created.name).toBe('Test / First Film')
    expect((await client.getDashboard()).projects[0].id).toBe(created.id)

    const item = await client.addProductionItem(created.id, 'Thêm shot mở đầu')
    const reloaded = await client.getDashboard()
    const persisted = reloaded.projects.find((project) => project.id === created.id)

    expect(item.title).toBe('Thêm shot mở đầu')
    expect(persisted?.productionItems).toEqual([item])
    expect(persisted?.completion.total).toBe(1)
  })

  it('acknowledges a decision without pretending to complete production work', async () => {
    const client = createCoreClient()
    const before = await client.getDashboard()
    const decision = before.decisions[0]

    await client.acknowledgeDecision(decision.id)
    const after = await client.getDashboard()

    expect(after.decisions.some((candidate) => candidate.id === decision.id)).toBe(false)
    expect(after.activity.some((item) => item.state === 'running')).toBe(true)
  })

  it('maps canonical live decisions and sends stale-safe resolve commands', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/dashboard')) {
        return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), projects: [], decisions: [{ id: 'decision-live', project_id: 'project-1', project_title: 'Live film', decision_type: 'RIGHTS', title_key: 'rights.title', reason_key: 'rights.reason', blocking_scope_type: 'PROJECT', blocking_scope_id: 'project-1', severity: 'HIGH', state: 'OPEN', decision_version: 4, choices: [{ id: 'hold', label_key: 'rights.hold', recommended: true }] }], activity: [], system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false } }), { status: 200 })
      }
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('decision-resolve-1')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.choice_id).toBe('hold')
      expect(body.expected_decision_version).toBe(4)
      return new Response(JSON.stringify({ ok: true, result: { id: 'decision-live', project_id: 'project-1', project_title: 'Live film', decision_type: 'RIGHTS', title: 'rights.title', reason: 'rights.reason', blocking_scope_type: 'PROJECT', blocking_scope_id: 'project-1', severity: 'HIGH', state: 'RESOLVED', decision_version: 5, resolved_choice_id: 'hold', choices: [{ id: 'hold', label_key: 'rights.hold', recommended: true }] } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const dashboard = await client.getDashboard()
      expect(dashboard.decisions[0].decisionVersion).toBe(4)
      expect(dashboard.decisions[0].projectName).toBe('Live film')
      const resolved = await client.resolveDecision?.('decision-live', 'hold', 4, 'decision-resolve-1')
      expect(resolved?.state).toBe('RESOLVED')
      expect(resolved?.resolvedChoiceId).toBe('hold')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('recovers from a malformed local snapshot', async () => {
    localStorage.setItem('cineforge-dashboard-v1', '{broken')
    const snapshot = await createCoreClient().getDashboard()

    expect(snapshot.projects.length).toBeGreaterThan(0)
    expect(localStorage.getItem('cineforge-dashboard-v1')).toBeNull()
  })

  it('exposes a read-only workspace view from the same local source of truth', async () => {
    const client = createCoreClient()
    const project = (await client.getDashboard()).projects[0]

    const workspace = await client.getProjectWorkspace?.(project.id)

    expect(workspace?.projectId).toBe(project.id)
    expect(workspace?.productionItems).toEqual(project.productionItems)
    expect(workspace?.tasks.map((task) => task.title)).toEqual(project.productionItems?.map((item) => item.title))
    expect(workspace?.shotsCount).toBe(0)
    expect(workspace?.shots).toEqual([])
    expect(workspace?.notes).toEqual([])
  })

  it('keeps activity reads empty for an unknown local project', async () => {
    const client = createCoreClient()

    await expect(client.getProjectActivity?.('missing-project')).resolves.toEqual([])
  })

  it('keeps task, planning shot, and append-only note records separate in the local workspace', async () => {
    const client = createCoreClient()
    const project = (await client.getDashboard()).projects[0]
    const task = await client.createTask?.(project.id, 'Lock shot list', { description: 'Review with director' })
    const shot = await client.createShot?.(project.id, 'SH010', 'Door opens')
    const note = await client.addNote?.(project.id, { entityType: 'SHOT', entityId: shot!.id }, 'Keep the prop on the left.')
    const workspace = await client.getProjectWorkspace?.(project.id)

    expect(task?.status).toBe('PLANNED')
    expect(shot?.lifecycleState).toBe('ACTIVE')
    expect(note?.entityType).toBe('SHOT')
    expect(workspace?.tasks.some((candidate) => candidate.id === task?.id)).toBe(true)
    expect(workspace?.shots.some((candidate) => candidate.id === shot?.id)).toBe(true)
    expect(workspace?.notes[0].body).toBe('Keep the prop on the left.')
  })

  it('replays local mutating commands by idempotency key without duplicating records', async () => {
    const client = createCoreClient()
    const project = (await client.getDashboard()).projects[0]

    const task = await client.createTask!(project.id, 'Idempotent task', { idempotencyKey: 'local-task-create' })
    const taskReplay = await client.createTask!(project.id, 'Idempotent task', { idempotencyKey: 'local-task-create' })
    expect(taskReplay).toEqual(task)

    const shot = await client.createShot!(project.id, 'SH020', 'Idempotent shot', 'local-shot-create')
    const shotReplay = await client.createShot!(project.id, 'SH020', 'Idempotent shot', 'local-shot-create')
    expect(shotReplay).toEqual(shot)

    const note = await client.addNote!(project.id, { entityType: 'SHOT', entityId: shot.id }, 'Keep one copy.', 'local-note-create')
    const noteReplay = await client.addNote!(project.id, { entityType: 'SHOT', entityId: shot.id }, 'Keep one copy.', 'local-note-create')
    expect(noteReplay).toEqual(note)

    const taskUpdate = await client.updateTask!(task.id, { status: 'IN_PROGRESS' }, task.rowVersion, 'local-task-update')
    const taskUpdateReplay = await client.updateTask!(task.id, { status: 'IN_PROGRESS' }, task.rowVersion, 'local-task-update')
    expect(taskUpdateReplay).toEqual(taskUpdate)

    const shotUpdate = await client.updateShot!(shot.id, { lifecycleState: 'PAUSED' }, shot.rowVersion, 'local-shot-update')
    const shotUpdateReplay = await client.updateShot!(shot.id, { lifecycleState: 'PAUSED' }, shot.rowVersion, 'local-shot-update')
    expect(shotUpdateReplay).toEqual(shotUpdate)

    const workspace = await client.getProjectWorkspace!(project.id)
    expect(workspace.tasks.filter((candidate) => candidate.id === task.id)).toHaveLength(1)
    expect(workspace.shots.filter((candidate) => candidate.id === shot.id)).toHaveLength(1)
    expect(workspace.notes.filter((candidate) => candidate.id === note.id)).toHaveLength(1)
    expect(workspace.tasks.find((candidate) => candidate.id === task.id)?.rowVersion).toBe(task.rowVersion + 1)
    expect(workspace.shots.find((candidate) => candidate.id === shot.id)?.rowVersion).toBe(shot.rowVersion + 1)
  })

  it('binds failed local keys and rejects reuse with a different payload', async () => {
    const client = createCoreClient()
    const project = (await client.getDashboard()).projects[0]
    const first = await client.createShot!(project.id, 'SH030', 'Existing code', 'local-shot-conflict')

    await expect(client.createShot!(project.id, 'SH030', 'Different title', 'local-shot-duplicate')).rejects.toMatchObject({ code: 'DUPLICATE_SHOT_CODE' })
    await expect(client.createShot!(project.id, 'SH030', 'Different title', 'local-shot-duplicate')).rejects.toMatchObject({ code: 'DUPLICATE_SHOT_CODE' })
    await expect(client.createShot!(project.id, 'SH031', 'Different code', 'local-shot-duplicate')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT' })
    expect(first.code).toBe('SH030')
  })

  it('maps HTTP asset records and sends a Core import command', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/v1/desktop/stage')) {
        expect(init?.method).toBe('POST')
        const encodedName = (init?.headers as Record<string, string>)['X-CineForge-Filename-B64']
        expect(encodedName).toMatch(/^[A-Za-z0-9_-]+$/)
        const padded = encodedName.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedName.length / 4) * 4, '=')
        const decoded = new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))
        expect(decoded).toBe('Cảnh 🎬.mp4')
        return new Response(JSON.stringify({ ok: true, result: { handle: 'b'.repeat(32), name: 'Cảnh 🎬.mp4', mimeType: 'video/mp4', byteSize: 42 } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'asset-1', projectId: 'project-1', name: 'shot.png', assetType: 'IMAGE', availability: 'AVAILABLE', revisionId: 'revision-1', contentHash: 'a'.repeat(64), byteSize: 42, storageUri: 'object://sha-256/a/aaa', rights: { status: 'UNKNOWN', eligible: false, rights_identity_id: 'rights-1', blockers: [{ code: 'CONSENT_MISSING' }], evidence: [] }, warnings: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      expect(url).toContain('/v1/assets')
      return new Response(JSON.stringify({ assets: [{ id: 'asset-1', projectId: 'project-1', name: 'shot.png', assetType: 'IMAGE', availability: 'AVAILABLE', revisionId: 'revision-1', contentHash: 'a'.repeat(64), byteSize: 42, storageUri: 'object://sha-256/a/aaa', rights: { status: 'UNKNOWN', eligible: false, rights_identity_id: 'rights-1', blockers: [{ code: 'CONSENT_MISSING' }], evidence: [] }, warnings: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const assets = await client.getAssets?.()
      expect(assets?.[0].contentHash).toBe('a'.repeat(64))
      expect(assets?.[0].byteSize).toBe(42)
      expect(assets?.[0].rights?.status).toBe('UNKNOWN')
      expect(assets?.[0].rights?.rightsIdentityId).toBe('rights-1')
      const staged = await client.stageAsset?.(new File(['bytes'], 'Cảnh 🎬.mp4', { type: 'video/mp4' }))
      expect(staged?.handle).toBe('b'.repeat(32))
      expect(staged?.byteSize).toBe(42)
      const imported = await client.importAsset?.({ sourcePath: 'C:/media/shot.png', projectId: 'project-1', idempotencyKey: 'stable-import-key' })
      expect(imported?.id).toBe('asset-1')
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(String(fetchMock.mock.calls[2][0])).toContain('/v1/projects/project-1/assets')
      expect((fetchMock.mock.calls[2][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('stable-import-key')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps first-class workspace records and sends expected row versions for stale-safe updates', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/workspace')) {
        return new Response(JSON.stringify({ ok: true, result: { tasks: [{ id: 'task-1', project_id: 'project-1', title: 'Task', description: '', status: 'PLANNED', priority: 1, row_version: 3 }], shots: [{ id: 'shot-1', project_id: 'project-1', code: 'SH010', title: 'Shot', lifecycle_state: 'ACTIVE', row_version: 2 }], notes: [{ id: 'note-1', project_id: 'project-1', entity_type: 'SHOT', entity_id: 'shot-1', body: 'Keep left.' }], counts: { shots: 1, notes: 1 }, projection_seq: 8 } }), { status: 200 })
      }
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body)) as { expected_versions: { TASK: number } }
      expect(body.command_type).toBe('UpdateTask')
      expect(body.expected_versions.TASK).toBe(3)
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('task-update-1')
      return new Response(JSON.stringify({ ok: true, result: { id: 'task-1', project_id: 'project-1', title: 'Task', description: '', status: 'IN_PROGRESS', priority: 1, row_version: 4 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const workspace = await client.getProjectWorkspace?.('project-1')
      expect(workspace?.tasks[0].rowVersion).toBe(3)
      expect(workspace?.shots[0].code).toBe('SH010')
      expect(workspace?.notes[0].entityType).toBe('SHOT')
      const task = await client.updateTask?.('task-1', { status: 'IN_PROGRESS' }, 3, 'task-update-1')
      expect(task?.status).toBe('IN_PROGRESS')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates a live task from the canonical nested command result without local dashboard state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/v1/projects/project-live/tasks')
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('task-create-1')
      const body = JSON.parse(String(init?.body)) as { title: string; priority: number }
      expect(body).toMatchObject({ title: 'Live task', priority: 5 })
      return new Response(JSON.stringify({ ok: true, result: { id: 'command-1', status: 'SUCCEEDED', task: { id: 'task-live', project_id: 'project-live', title: body.title, description: 'From Core', status: 'IN_PROGRESS', priority: 5, row_version: 1 } } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const task = await client.createTask?.('project-live', 'Live task', { description: 'From Core', priority: 5, idempotencyKey: 'task-create-1' })
      expect(task).toMatchObject({ id: 'task-live', projectId: 'project-live', status: 'IN_PROGRESS', priority: 5, rowVersion: 1 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves structured stale errors for conflict-aware UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'STALE_REVISION', category: 'STALE_REVISION', user_message_key: 'errors.stale_revision', needs_user: true, retryable: false, technical_details: { current: 4 } } }), { status: 409 })))
    try {
      const client = new HttpCoreClient('http://core')
      await expect(client.updateTask?.('task-1', { status: 'DONE' }, 3, 'stale-key')).rejects.toMatchObject({ code: 'STALE_REVISION', needsUser: true, technicalDetails: { current: 4 } })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
