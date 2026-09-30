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

  it('reads project-scoped release readiness and keeps evidence redacted', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://core/v1/projects/project-1/release/readiness')
      return new Response(JSON.stringify({ ok: true, result: {
        project_id: 'project-1', project_title: 'Film', overall_state: 'NOT_CHECKED',
        policy: { purpose: 'RELEASE', unknown_blocks: true }, exact_source: { timeline_id: 'timeline-1', local_path: 'C:\\secret\\cut.mov' },
        gates: [{ key: 'PICTURE', state: 'PASS', blocking: false, evidence: { clip_count: 2, provider_path: 'C:\\secret\\provider' } }, { key: 'QC', state: 'UNKNOWN', blocking: true, reason: 'QC_NOT_SUBMITTED', evidence: { review_count: 0 } }],
        blocking_gate_keys: ['QC'], blocking_count: 1, unknown_count: 1, gate_manifest_hash: 'a'.repeat(64), projection_seq: 7,
      } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const readiness = await new HttpCoreClient('http://core').getReleaseReadiness!('project-1')
      expect(readiness.overallState).toBe('NOT_CHECKED')
      expect(readiness.gates).toHaveLength(2)
      expect(readiness.gates[0].evidence).toEqual({ clip_count: 2 })
      expect(readiness.exactSource).toEqual({ timeline_id: 'timeline-1' })
      expect(JSON.stringify(readiness)).not.toContain('secret')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads, creates, and cancels release candidate metadata with safe mapping and stale-safe inputs', async () => {
    const candidate = {
      id: 'candidate-1', project_id: 'project-1', timeline_revision_id: 'revision-1',
      media_profile_revision_id: 'profile-1', review_session_id: 'review-1',
      readiness_digest: 'A'.repeat(64), rights_snapshot_hash: 'B'.repeat(64),
      state: 'DRAFT', next_step: 'Metadata only.', row_version: 1,
      readiness_snapshot_schema_version: 1, readiness_snapshot_json: '{"local_path":"C:\\secret"}',
      provider_uri: 'https://provider.invalid',
    }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/release/candidates') && !init?.method) {
        return new Response(JSON.stringify({ ok: true, result: { items: [candidate], projection_seq: 4, generated_at: '2026-09-29T00:00:00.000Z' } }), { status: 200 })
      }
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      if (url.endsWith('/release/candidates')) {
        expect(headers['Idempotency-Key']).toBe('candidate-create-1')
        expect(init?.body).toBe('{}')
        return new Response(JSON.stringify({ ok: true, result: candidate }), { status: 200 })
      }
      expect(url).toContain('/release/candidates/candidate-1/cancel')
      expect(headers['Idempotency-Key']).toBe('candidate-cancel-1')
      expect(JSON.parse(String(init?.body))).toEqual({ expected_version: 1 })
      return new Response(JSON.stringify({ ok: true, result: { ...candidate, state: 'CANCELLED', row_version: 2 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const listed = await client.getReleaseCandidates?.('project-1')
      expect(listed?.items[0]).toMatchObject({ id: 'candidate-1', projectId: 'project-1', readinessDigest: 'a'.repeat(64), rightsSnapshotHash: 'b'.repeat(64), state: 'DRAFT', rowVersion: 1 })
      expect(JSON.stringify(listed)).not.toContain('secret')
      expect(JSON.stringify(listed)).not.toContain('provider')
      const created = await client.createReleaseCandidateDraft?.('project-1', 'candidate-create-1')
      expect(created).toMatchObject({ id: 'candidate-1', projectId: 'project-1', state: 'DRAFT' })
      const cancelled = await client.cancelReleaseCandidateDraft?.('project-1', 'candidate-1', 1, 'candidate-cancel-1')
      expect(cancelled).toMatchObject({ id: 'candidate-1', state: 'CANCELLED', rowVersion: 2 })
      expect(calls).toHaveLength(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails closed for candidate commands without a connection, scope, or valid row version', async () => {
    const client = new HttpCoreClient('')
    await expect(client.getReleaseCandidates?.('project-1')).rejects.toMatchObject({ code: 'CORE_OFFLINE' })
    await expect(new HttpCoreClient('http://core').getReleaseCandidates?.('')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(new HttpCoreClient('http://core').cancelReleaseCandidateDraft?.('project-1', 'candidate-1', 0, 'cancel')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(new HttpCoreClient('http://core').createReleaseCandidateDraft?.('project-1', ' ')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
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

  it('maps redacted backup/admission projections and sends idempotent backup commands', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/backups') && !init?.method) {
        return new Response(JSON.stringify({ ok: true, result: { backups: [{ id: 'backup-1', state: 'VERIFIED', destination_name: 'backup-1', manifest_name: 'manifest.json', snapshot_name: 'cineforge.sqlite', byte_size: 2048, object_count: 3, manifest_sha256: 'a'.repeat(64), row_version: 1 }] } }), { status: 200 })
      }
      if (url.endsWith('/v1/storage/admission')) {
        return new Response(JSON.stringify({ ok: true, result: { destination_name: 'backups', durability_class: 'LOCAL_WRITABLE', estimated_bytes: 1000, available_bytes: 5000, reserve_bytes: 500, object_count: 3 } }), { status: 200 })
      }
      if (url.endsWith('/v1/backups/backup-1') && !init?.method) {
        return new Response(JSON.stringify({ ok: true, result: { backup: { id: 'backup-1', state: 'VERIFIED', destination_name: 'backup-1', manifest_name: 'manifest.json', snapshot_name: 'cineforge.sqlite', row_version: 1 }, verifications: [{ id: 'verification-1', backup_id: 'backup-1', outcome: 'VERIFIED', integrity_state: 'PASS', details: { db_sha256: 'b'.repeat(64) } }] } }), { status: 200 })
      }
      if (url.endsWith('/v1/backups/backup-1/restore-estimate')) {
        return new Response(JSON.stringify({ ok: true, result: {
          backup: { id: 'backup-1', state: 'VERIFIED', destination_name: 'backup-1', row_version: 1 },
          restore_estimate: {
            schema_version: 1, preflight_state: 'UNKNOWN', restore_allowed: false, activation_state: 'NOT_IMPLEMENTED',
            checks: [{ id: 'ARTIFACT_INTEGRITY', state: 'PASS' }, { id: 'TARGET_INSTALLATION', state: 'UNKNOWN', code: 'BACKUP_INSTALLATION_RECONCILIATION_REQUIRED' }],
            artifact: { byte_size: 2048, object_count: 3, manifest_sha256: 'a'.repeat(64) },
            target: { current_schema_version: 18, current_event_seq: 5, installation_state: 'UNKNOWN', schema_state: 'PASS', checkpoint_state: 'PASS' },
            estimated_restore_bytes: 2048, estimated_restore_duration_ms: 1, duration_estimate_method: 'THEORETICAL_IO_ONLY_64_MIB_PER_SECOND',
          },
        } }), { status: 200 })
      }
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe(url.endsWith('/verify') ? 'backup-verify-1' : 'backup-create-1')
      if (url.endsWith('/verify')) {
        expect(JSON.parse(String(init?.body))).toEqual({})
        return new Response(JSON.stringify({ ok: true, result: { backup: { id: 'backup-1', state: 'VERIFIED', destination_name: 'backup-1', row_version: 2 }, verification: { id: 'verification-2', backup_id: 'backup-1', outcome: 'VERIFIED', integrity_state: 'PASS' } } }), { status: 200 })
      }
      expect(JSON.parse(String(init?.body))).toEqual({ durability_class: 'LOCAL_WRITABLE' })
      return new Response(JSON.stringify({ ok: true, result: { backup: { id: 'backup-1', state: 'VERIFIED', destination_name: 'backup-1', row_version: 1 }, verification: { id: 'verification-1', backup_id: 'backup-1', outcome: 'VERIFIED', integrity_state: 'PASS' } } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const backups = await client.getBackups?.()
      expect(backups?.[0]).toMatchObject({ id: 'backup-1', destinationName: 'backup-1', byteSize: 2048, objectCount: 3 })
      expect((backups?.[0] as Record<string, unknown>).destinationPath).toBeUndefined()
      const admission = await client.getStorageAdmission?.()
      expect(admission).toMatchObject({ estimatedBytes: 1000, availableBytes: 5000, reserveBytes: 500 })
      const workspace = await client.getBackup?.('backup-1')
      expect(workspace?.verifications[0]).toMatchObject({ outcome: 'VERIFIED', integrityState: 'PASS' })
      const restorePlan = await client.getBackupRestoreEstimate?.('backup-1')
      expect(restorePlan?.restoreEstimate).toMatchObject({ preflightState: 'UNKNOWN', restoreAllowed: false, activationState: 'NOT_IMPLEMENTED' })
      expect(restorePlan?.restoreEstimate?.checks[1]).toMatchObject({ id: 'TARGET_INSTALLATION', state: 'UNKNOWN' })
      const created = await client.createBackup?.({ durabilityClass: 'LOCAL_WRITABLE' }, 'backup-create-1')
      expect(created?.backup?.state).toBe('VERIFIED')
      const verified = await client.verifyBackup?.('backup-1', 'backup-verify-1')
      expect(verified?.verification?.integrityState).toBe('PASS')
      expect(fetchMock).toHaveBeenCalledTimes(6)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads redacted staging evidence and sends a bounded idempotent reconcile command', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://core/v1/storage/staging?')) {
        const parsed = new URL(url)
        expect(parsed.searchParams.get('state')).toBe('WRITING')
        expect(parsed.searchParams.get('limit')).toBe('25')
        return new Response(JSON.stringify({ ok: true, result: {
          items: [{
            id: 'stage-1', state: 'WRITING', temp_name: 'C:\\private\\clip.mov', temp_path: 'C:\\private\\clip.mov',
            expected_size: 1024, current_size: 512, hash_algorithm: 'SHA-256', sha256: 'a'.repeat(64),
            source_path_fingerprint: 'b'.repeat(64), reparse_state: 'CLEAR',
            source_file_identity: { state: 'MATCH', path: 'C:\\private\\source.mov' },
            os_file_identity: { status: 'MATCH', device: 7 }, finalization_identity: null,
            row_version: 3, created_at: '2026-09-29T08:00:00.000Z', updated_at: '2026-09-29T08:00:01.000Z',
          }], projection_seq: 9,
        } }), { status: 200 })
      }
      expect(url).toBe('http://core/v1/storage/staging/reconcile')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('staging-reconcile-1')
      expect(JSON.parse(String(init?.body))).toEqual({ staging_id: 'stage-1' })
      return new Response(JSON.stringify({ ok: true, result: {
        staging: { items: [{ id: 'stage-1', previous_state: 'WRITING', state: 'VERIFIED', reason: 'VERIFIED_CONTENT' }], checked_count: 1, projection_seq: 10 },
      } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const workspace = await client.getStaging?.('writing', 25)
      expect(workspace?.items[0]).toMatchObject({ id: 'stage-1', state: 'WRITING', tempName: 'clip.mov', expectedSize: 1024, currentSize: 512, reparseState: 'CLEAR', sourceFileIdentityState: 'MATCH', osFileIdentityState: 'MATCH' })
      expect((workspace?.items[0] as Record<string, unknown>).tempPath).toBeUndefined()
      expect((workspace?.items[0] as Record<string, unknown>).sourceFileIdentity).toBeUndefined()
      const reconciled = await client.reconcileStaging?.('stage-1', 'staging-reconcile-1')
      expect(reconciled).toMatchObject({ checkedCount: 1, projectionSeq: 10 })
      expect(reconciled?.items[0]).toMatchObject({ id: 'stage-1', state: 'VERIFIED' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
