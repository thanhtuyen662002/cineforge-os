import { mockSnapshot } from './data/mockSnapshot'
import type { ActivityItem, AssetSummary, CharacterRevision, CharacterRevisionInput, CharacterRevisionKind, CharacterSummary, CharacterWorkspace, CoreClient, DashboardSnapshot, DecisionRequest, HandoffListItem, HandoffWorkspace, HumanReviewDecision, ImportAssetInput, MediaProfileInput, MediaProfileRevision, MediaProfileWorkspace, NoteSummary, ProductionItem, ProjectSummary, ProjectWorkspace, ReviewSession, ReviewWorkspace, RightsState, RightsSummary, ShotLifecycleState, ShotSummary, StagedAsset, TaskStatus, TaskSummary, TimelineClip, TimelineInput, TimelineMarker, TimelineRevision, TimelineSnapshotInput, TimelineSummary, TimelineTrack, TimelineWorkspace, WorkspaceNoteEntityType, WorkState } from './types'

declare global {
  interface Window {
    /** Optional runtime override injected by the desktop bootstrapper. */
    __CINEFORGE_CORE_BASE_URL__?: string
  }
}

export interface CoreBridge {
  getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot>
  acknowledgeDecision(id: string): Promise<void>
  resolveDecision?(id: string, choiceId: string, expectedVersion: number, idempotencyKey?: string): Promise<DecisionRequest>
  dismissDecision?(id: string, expectedVersion: number, idempotencyKey?: string): Promise<DecisionRequest>
  createProject(name: string): Promise<ProjectSummary>
  addProductionItem(projectId: string, title: string): Promise<ProductionItem>
  createTask?(projectId: string, title: string, options?: { description?: string; priority?: number; idempotencyKey?: string }): Promise<TaskSummary>
  updateTask?(taskId: string, patch: { title?: string; description?: string; priority?: number; status?: TaskStatus }, expectedVersion: number, idempotencyKey?: string): Promise<TaskSummary>
  createShot?(projectId: string, code: string, title: string, idempotencyKey?: string): Promise<ShotSummary>
  updateShot?(shotId: string, patch: { title?: string; lifecycleState?: ShotLifecycleState }, expectedVersion: number, idempotencyKey?: string): Promise<ShotSummary>
  addNote?(projectId: string, target: { entityType: WorkspaceNoteEntityType; entityId: string }, body: string, idempotencyKey?: string): Promise<NoteSummary>
  getProjectWorkspace?(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspace>
  getProjectActivity?(projectId: string, signal?: AbortSignal): Promise<ActivityItem[]>
  getAssets?(projectId?: string, signal?: AbortSignal): Promise<AssetSummary[]>
  stageAsset?(file: File): Promise<StagedAsset>
  importAsset?(input: ImportAssetInput): Promise<AssetSummary>
  getCharacters?(projectId?: string, signal?: AbortSignal): Promise<CharacterSummary[]>
  getCharacterWorkspace?(characterId: string, signal?: AbortSignal): Promise<CharacterWorkspace>
  createCharacter?(projectId: string, displayName: string, stableCode?: string, idempotencyKey?: string): Promise<CharacterSummary>
  createVisualIdentityRevision?(characterId: string, input: CharacterRevisionInput, idempotencyKey?: string): Promise<CharacterRevision>
  createVoiceIdentityRevision?(characterId: string, input: CharacterRevisionInput, idempotencyKey?: string): Promise<CharacterRevision>
  createPerformanceBibleRevision?(characterId: string, input: CharacterRevisionInput, idempotencyKey?: string): Promise<CharacterRevision>
  getMediaProfile?(projectId: string, signal?: AbortSignal): Promise<MediaProfileWorkspace>
  createMediaProfileRevision?(projectId: string, input: MediaProfileInput, idempotencyKey?: string): Promise<MediaProfileWorkspace>
  transitionMediaProfileRevision?(projectId: string, revisionId: string, nextState: string, expectedVersion: number, idempotencyKey?: string): Promise<MediaProfileWorkspace>
  getTimelines?(projectId: string, signal?: AbortSignal): Promise<TimelineSummary[]>
  getTimelineWorkspace?(projectId: string, timelineId: string, signal?: AbortSignal): Promise<TimelineWorkspace>
  createTimeline?(projectId: string, input: TimelineInput, idempotencyKey?: string): Promise<TimelineSummary>
  createTimelineRevision?(projectId: string, timelineId: string, input: TimelineSnapshotInput, expectedVersion: number, idempotencyKey?: string): Promise<TimelineWorkspace>
  transitionTimelineRevision?(projectId: string, timelineId: string, revisionId: string, nextState: string, expectedVersion: number, idempotencyKey?: string, reviewSessionId?: string, dependencySnapshotHash?: string): Promise<TimelineWorkspace>
  getReviews?(projectId: string, state?: string, signal?: AbortSignal): Promise<ReviewSession[]>
  getReview?(projectId: string, reviewSessionId: string, signal?: AbortSignal): Promise<ReviewWorkspace>
  openReview?(projectId: string, subjectRevisionId: string, expectedVersion: number, idempotencyKey?: string): Promise<ReviewWorkspace>
  submitReview?(projectId: string, reviewSessionId: string, decision: HumanReviewDecision, expectedVersion: number, notes?: string, reasonCodes?: string[], idempotencyKey?: string): Promise<ReviewWorkspace>
  getHandoffs?(projectId: string, state?: string, signal?: AbortSignal): Promise<HandoffListItem[]>
  getHandoff?(projectId: string, handoffId: string, signal?: AbortSignal): Promise<HandoffWorkspace>
  createHandoffManifest?(projectId: string, input: { timelineRevisionId: string; reviewSessionId: string; dependencySnapshotHash: string; targetEditor: string; targetVersion: string; targetProfile?: string; expectedVersion: number }, idempotencyKey?: string): Promise<HandoffWorkspace>
}

const LOCAL_SNAPSHOT_KEY = 'cineforge-dashboard-v1'
const LOCAL_WORKSPACE_KEY = 'cineforge-workspaces-v1'
const LOCAL_IDEMPOTENCY_KEY = 'cineforge-idempotency-v1'

export class CoreClientError extends Error {
  readonly code: string
  readonly category: string
  readonly retryable: boolean
  readonly needsUser: boolean
  readonly userMessageKey?: string
  readonly technicalDetails: Record<string, unknown>

  constructor(message: string, fields: Partial<Pick<CoreClientError, 'code' | 'category' | 'retryable' | 'needsUser' | 'userMessageKey' | 'technicalDetails'>> = {}) {
    super(message)
    this.name = 'CoreClientError'
    this.code = fields.code ?? 'CORE_REQUEST_FAILED'
    this.category = fields.category ?? 'UNKNOWN'
    this.retryable = fields.retryable ?? false
    this.needsUser = fields.needsUser ?? true
    this.userMessageKey = fields.userMessageKey
    this.technicalDetails = fields.technicalDetails ?? {}
  }
}

function localSnapshot(): DashboardSnapshot {
  const stored = localStorage.getItem(LOCAL_SNAPSHOT_KEY)
  if (!stored) {
    const snapshot = structuredClone(mockSnapshot)
    snapshot.decisions = snapshot.decisions.map(mapDecisionRecord)
    return snapshot
  }
  try {
    const snapshot = JSON.parse(stored) as DashboardSnapshot
    snapshot.decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions.map(mapDecisionRecord) : []
    return snapshot
  } catch {
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY)
    const snapshot = structuredClone(mockSnapshot)
    snapshot.decisions = snapshot.decisions.map(mapDecisionRecord)
    return snapshot
  }
}

function saveLocalSnapshot(snapshot: DashboardSnapshot) {
  localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(snapshot))
}

type LocalWorkspaceState = { tasks: TaskSummary[]; shots: ShotSummary[]; notes: NoteSummary[]; projectionSeq: number }

type LocalIdempotencyFailure = {
  message: string
  code: string
  category: string
  retryable: boolean
  needsUser: boolean
  userMessageKey?: string
  technicalDetails: Record<string, unknown>
}

type LocalIdempotencyEntry = {
  fingerprint: string
  status: 'SUCCEEDED' | 'FAILED'
  result?: unknown
  error?: LocalIdempotencyFailure
}

function localWorkspaceStore(): Record<string, LocalWorkspaceState> {
  const stored = localStorage.getItem(LOCAL_WORKSPACE_KEY)
  if (!stored) return {}
  try {
    const parsed = JSON.parse(stored) as Record<string, LocalWorkspaceState>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    localStorage.removeItem(LOCAL_WORKSPACE_KEY)
    return {}
  }
}

function saveLocalWorkspaceStore(store: Record<string, LocalWorkspaceState>) {
  localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(store))
}

function localIdempotencyStore(): Record<string, LocalIdempotencyEntry> {
  const stored = localStorage.getItem(LOCAL_IDEMPOTENCY_KEY)
  if (!stored) return {}
  try {
    const parsed = JSON.parse(stored) as Record<string, LocalIdempotencyEntry>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => {
      return Boolean(entry && typeof entry === 'object' && typeof entry.fingerprint === 'string' && (entry.status === 'SUCCEEDED' || entry.status === 'FAILED'))
    }))
  } catch {
    localStorage.removeItem(LOCAL_IDEMPOTENCY_KEY)
    return {}
  }
}

function saveLocalIdempotencyStore(store: Record<string, LocalIdempotencyEntry>) {
  localStorage.setItem(LOCAL_IDEMPOTENCY_KEY, JSON.stringify(store))
}

function stableLocalValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'number:' + String(value)
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableLocalValue).join(',') + ']'
  if (typeof value === 'object') {
    return '{' + Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableLocalValue((value as Record<string, unknown>)[key])}`).join(',') + '}'
  }
  return JSON.stringify(String(value))
}

function localCommandFingerprint(payload: unknown, expectedVersions: unknown = {}): string {
  return stableLocalValue({ payload, expectedVersions })
}

function localCommandStorageKey(commandType: string, idempotencyKey: string): string {
  return stableLocalValue([commandType, idempotencyKey])
}

function localCommandReplay<T>(commandType: string, idempotencyKey: string, fingerprint: string): { handled: boolean; result?: T } {
  const entry = localIdempotencyStore()[localCommandStorageKey(commandType, idempotencyKey)]
  if (!entry) return { handled: false }
  if (entry.fingerprint !== fingerprint) {
    throw new CoreClientError('The idempotency key is already bound to a different request.', {
      code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
      category: 'CONFLICT',
      needsUser: true,
    })
  }
  if (entry.status === 'FAILED') {
    const failure = entry.error
    throw new CoreClientError(failure?.message ?? 'The previous request failed.', {
      code: failure?.code ?? 'COMMAND_FAILED',
      category: failure?.category ?? 'UNKNOWN',
      retryable: failure?.retryable ?? false,
      needsUser: failure?.needsUser ?? true,
      userMessageKey: failure?.userMessageKey,
      technicalDetails: failure?.technicalDetails ?? {},
    })
  }
  return { handled: true, result: structuredClone(entry.result) as T }
}

function localCommandSuccess(commandType: string, idempotencyKey: string, fingerprint: string, result: unknown) {
  const store = localIdempotencyStore()
  store[localCommandStorageKey(commandType, idempotencyKey)] = { fingerprint, status: 'SUCCEEDED', result: structuredClone(result) }
  saveLocalIdempotencyStore(store)
}

function localCommandFailure(commandType: string, idempotencyKey: string, fingerprint: string, cause: unknown) {
  const error = cause instanceof CoreClientError
    ? cause
    : new CoreClientError(cause instanceof Error ? cause.message : 'The local Core request failed.', { code: 'COMMAND_FAILED', category: 'UNKNOWN', needsUser: true })
  const store = localIdempotencyStore()
  store[localCommandStorageKey(commandType, idempotencyKey)] = {
    fingerprint,
    status: 'FAILED',
    error: {
      message: error.message,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      needsUser: error.needsUser,
      userMessageKey: error.userMessageKey,
      technicalDetails: error.technicalDetails,
    },
  }
  saveLocalIdempotencyStore(store)
}

function localWorkspace(projectId: string): LocalWorkspaceState {
  const store = localWorkspaceStore()
  const existing = store[projectId]
  if (existing) return existing
  const project = localSnapshot().projects.find((candidate) => candidate.id === projectId)
  const tasks = (project?.productionItems ?? []).map((item, index): TaskSummary => ({
    id: item.id,
    projectId,
    title: item.title,
    description: item.detail,
    status: item.state === 'done' ? 'DONE' : item.state === 'in_progress' ? 'IN_PROGRESS' : item.state === 'blocked' ? 'BLOCKED' : item.state === 'cancelled' ? 'CANCELLED' : 'PLANNED',
    priority: 0,
    rowVersion: 1,
    createdAt: new Date(Date.now() + index).toISOString(),
  }))
  return { tasks, shots: [], notes: [], projectionSeq: 0 }
}

function persistLocalWorkspace(projectId: string, value: LocalWorkspaceState) {
  const store = localWorkspaceStore()
  store[projectId] = value
  saveLocalWorkspaceStore(store)
}

/**
 * Stable UI/Core boundary.
 *
 * The browser adapter speaks the versioned local Core HTTP surface. In a
 * Tauri build the same interface can be backed by invoke() without changing
 * the UI. A read-only mock is used when no Core endpoint is configured so the
 * app remains useful for design review and first-run onboarding.
 */
export class HttpCoreClient implements CoreClient {
  constructor(private readonly baseUrl = import.meta.env.VITE_CORE_BASE_URL ?? globalThis.window?.__CINEFORGE_CORE_BASE_URL__ ?? '') {}

  isLive(): boolean {
    return this.baseUrl.length > 0
  }

  async getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot> {
    if (!this.baseUrl) return localSnapshot()
    const response = await fetch(`${this.baseUrl}/v1/dashboard`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Core dashboard request failed (${response.status})`)
    const raw = await response.json() as DashboardSnapshot
    const next: DashboardSnapshot = {
      ...raw,
      decisions: Array.isArray(raw.decisions) ? raw.decisions.map(mapDecisionRecord) : [],
    }
    if (!next || !Array.isArray(next.projects)) throw new Error('Core dashboard response is invalid')
    // The dashboard route is intentionally lightweight. Enrich each project
    // from the canonical workspace/activity read models when the server
    // exposes them; a single unavailable project must not hide the rest of
    // the dashboard.
    const enriched = await Promise.all(next.projects.map(async (project) => {
      try {
        const [workspace, activity] = await Promise.all([
          this.getProjectWorkspace(project.id, signal),
          this.getProjectActivity(project.id, signal),
        ])
        const productionItems = workspace.productionItems
        const completion = {
          done: productionItems.filter((item) => item.state === 'done').length,
          total: productionItems.length,
        }
        return {
          ...project,
          productionItems,
          completion: completion.total > 0 || project.completion.total === 0 ? completion : project.completion,
          activity: activity.map((item) => item.projectId === project.id || item.projectName === project.id ? { ...item, projectId: project.id, projectName: project.name } : item),
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        return { ...project, activity: [] }
      }
    }))
    const projectActivity = enriched.flatMap((project) => project.activity)
    return {
      ...next,
      projects: enriched.map(({ activity: _activity, ...project }) => project),
      activity: next.activity.length > 0 ? next.activity : projectActivity,
    }
  }

  async acknowledgeDecision(id: string): Promise<void> {
    if (!this.baseUrl) {
      const snapshot = localSnapshot()
      snapshot.decisions = snapshot.decisions.filter((decision) => decision.id !== id)
      saveLocalSnapshot(snapshot)
      return
    }
    const response = await fetch(`${this.baseUrl}/v1/decisions/${encodeURIComponent(id)}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'desktop-ui' }),
    })
    if (!response.ok) throw new Error(`Core decision acknowledgement failed (${response.status})`)
  }

  async resolveDecision(id: string, choiceId: string, expectedVersion: number, idempotencyKey = crypto.randomUUID()): Promise<DecisionRequest> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !choiceId.trim()) {
      throw new CoreClientError('A decision choice and current version are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    }
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/decisions/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ decision_request_id: id, choice_id: choiceId, expected_decision_version: expectedVersion }),
      })
      return mapDecisionRecord(await readCorePayload(response, 'decision resolution'))
    }
    const fingerprint = localCommandFingerprint({ id, choiceId }, { DECISION_REQUEST: expectedVersion })
    const replay = localCommandReplay<DecisionRequest>('ResolveDecisionRequest', idempotencyKey, fingerprint)
    if (replay.handled) return replay.result as DecisionRequest
    try {
      const snapshot = localSnapshot()
      const current = snapshot.decisions.find((decision) => decision.id === id)
      if (!current) throw new CoreClientError('Decision request not found or already closed.', { code: 'NOT_FOUND', category: 'VALIDATION' })
      if (current.decisionVersion !== expectedVersion) throw new CoreClientError('Decision changed. Refresh before resolving it.', { code: 'STALE_DECISION', category: 'STALE_REVISION', needsUser: true })
      if (current.state !== 'OPEN') throw new CoreClientError('This decision is no longer open.', { code: 'DECISION_NOT_OPEN', category: 'CONFLICT', needsUser: true })
      if (!current.choices.some((choice) => choice.id === choiceId)) throw new CoreClientError('That choice is no longer available.', { code: 'INVALID_DECISION_CHOICE', category: 'VALIDATION', needsUser: true })
      const resolved: DecisionRequest = { ...current, state: 'RESOLVED', resolvedChoiceId: choiceId, decisionVersion: current.decisionVersion + 1, resolvedAt: new Date().toISOString() }
      snapshot.decisions = snapshot.decisions.filter((decision) => decision.id !== id)
      snapshot.generatedAt = new Date().toISOString()
      saveLocalSnapshot(snapshot)
      localCommandSuccess('ResolveDecisionRequest', idempotencyKey, fingerprint, resolved)
      return resolved
    } catch (cause) {
      localCommandFailure('ResolveDecisionRequest', idempotencyKey, fingerprint, cause)
      throw cause
    }
  }

  async dismissDecision(id: string, expectedVersion: number, idempotencyKey = crypto.randomUUID()): Promise<DecisionRequest> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new CoreClientError('A current decision version is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    }
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/decisions/${encodeURIComponent(id)}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ decision_request_id: id, expected_decision_version: expectedVersion }),
      })
      return mapDecisionRecord(await readCorePayload(response, 'decision dismissal'))
    }
    const fingerprint = localCommandFingerprint({ id }, { DECISION_REQUEST: expectedVersion })
    const replay = localCommandReplay<DecisionRequest>('DismissDecisionRequest', idempotencyKey, fingerprint)
    if (replay.handled) return replay.result as DecisionRequest
    try {
      const snapshot = localSnapshot()
      const current = snapshot.decisions.find((decision) => decision.id === id)
      if (!current) throw new CoreClientError('Decision request not found or already closed.', { code: 'NOT_FOUND', category: 'VALIDATION' })
      if (current.decisionVersion !== expectedVersion) throw new CoreClientError('Decision changed. Refresh before dismissing it.', { code: 'STALE_DECISION', category: 'STALE_REVISION', needsUser: true })
      if (current.state !== 'OPEN') throw new CoreClientError('This decision is no longer open.', { code: 'DECISION_NOT_OPEN', category: 'CONFLICT', needsUser: true })
      const dismissed: DecisionRequest = { ...current, state: 'DISMISSED', decisionVersion: current.decisionVersion + 1, resolvedAt: new Date().toISOString() }
      snapshot.decisions = snapshot.decisions.filter((decision) => decision.id !== id)
      snapshot.generatedAt = new Date().toISOString()
      saveLocalSnapshot(snapshot)
      localCommandSuccess('DismissDecisionRequest', idempotencyKey, fingerprint, dismissed)
      return dismissed
    } catch (cause) {
      localCommandFailure('DismissDecisionRequest', idempotencyKey, fingerprint, cause)
      throw cause
    }
  }

  async createProject(name: string): Promise<ProjectSummary> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!response.ok) throw new Error(`Core project creation failed (${response.status})`)
      return response.json() as Promise<ProjectSummary>
    }
    const snapshot = localSnapshot()
    const project: ProjectSummary = {
      id: `project-${Date.now().toString(36)}`,
      name,
      kind: 'Phim ngắn',
      updatedAt: 'Vừa tạo',
      stage: 'Chuẩn bị',
      stageDetail: 'Chưa có cảnh quay',
      cover: 'linear-gradient(145deg, #7664a9 0%, #35446a 56%, #171c2a 100%)',
      accent: '#b9a0ff',
      completion: { done: 0, total: 0 },
      health: 'attention',
      nextAction: 'Thêm production item đầu tiên',
      nextActionLabel: 'Mở dự án',
      storage: '0 B',
      productionItems: [],
    }
    snapshot.projects = [project, ...snapshot.projects]
    snapshot.generatedAt = new Date().toISOString()
    saveLocalSnapshot(snapshot)
    return project
  }

  async addProductionItem(projectId: string, title: string): Promise<ProductionItem> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/production-items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
      if (!response.ok) throw new Error(`Core production item creation failed (${response.status})`)
      return response.json() as Promise<ProductionItem>
    }
    const snapshot = localSnapshot()
    const project = snapshot.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new Error('Project no longer exists in Core')
    const item: ProductionItem = { id: `${projectId}-item-${Date.now().toString(36)}`, title, detail: 'Mới tạo · chưa bắt đầu', state: 'todo' }
    project.productionItems = [...(project.productionItems ?? []), item]
    project.completion.total = Math.max(project.completion.total, project.productionItems.length)
    project.updatedAt = 'Vừa cập nhật'
    saveLocalSnapshot(snapshot)
    const state = localWorkspace(projectId)
    const task: TaskSummary = { id: item.id, projectId, title, description: item.detail, status: 'PLANNED', priority: 0, rowVersion: 1, createdAt: new Date().toISOString() }
    if (!state.tasks.some((candidate) => candidate.id === task.id)) persistLocalWorkspace(projectId, { ...state, tasks: [...state.tasks, task], projectionSeq: state.projectionSeq + 1 })
    return item
  }

  async createTask(projectId: string, title: string, options: { description?: string; priority?: number; idempotencyKey?: string } = {}): Promise<TaskSummary> {
    const normalizedTitle = title.trim()
    if (!normalizedTitle || normalizedTitle.length > 500) throw new CoreClientError('A task title is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const { idempotencyKey, ...taskOptions } = options
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({ title: normalizedTitle, ...taskOptions }),
      })
      return mapTaskRecord(await readCorePayload(response, 'task creation'))
    }
    const requestKey = idempotencyKey ?? crypto.randomUUID()
    const description = taskOptions.description ?? ''
    const priority = taskOptions.priority ?? 0
    const fingerprint = localCommandFingerprint({ projectId, title: normalizedTitle, description, priority })
    const replay = localCommandReplay<TaskSummary>('CreateTask', requestKey, fingerprint)
    if (replay.handled) return replay.result as TaskSummary
    try {
      const project = localSnapshot().projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new CoreClientError('Project not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      const state = localWorkspace(projectId)
      if (description.length > 10000 || !Number.isSafeInteger(priority) || priority < -1000 || priority > 1000) throw new CoreClientError('Task fields are invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      const task: TaskSummary = { id: `${projectId}-task-${crypto.randomUUID()}`, projectId, title: normalizedTitle, description, status: 'PLANNED', priority, rowVersion: 1, createdAt: new Date().toISOString() }
      const next = { ...state, tasks: [...state.tasks, task], projectionSeq: state.projectionSeq + 1 }
      persistLocalWorkspace(projectId, next)
      syncLocalTasks(projectId, next.tasks)
      localCommandSuccess('CreateTask', requestKey, fingerprint, task)
      return task
    } catch (cause) {
      localCommandFailure('CreateTask', requestKey, fingerprint, cause)
      throw cause
    }
  }

  async updateTask(taskId: string, patch: { title?: string; description?: string; priority?: number; status?: TaskStatus }, expectedVersion: number, idempotencyKey = crypto.randomUUID()): Promise<TaskSummary> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ command_type: 'UpdateTask', payload: { task_id: taskId, ...patch }, expected_versions: { TASK: expectedVersion } }),
      })
      return mapTaskRecord(await readCorePayload(response, 'task update'))
    }
    const fingerprint = localCommandFingerprint({ taskId, patch }, { TASK: expectedVersion })
    const replay = localCommandReplay<TaskSummary>('UpdateTask', idempotencyKey, fingerprint)
    if (replay.handled) return replay.result as TaskSummary
    try {
      const store = localWorkspaceStore()
      const entry = Object.entries(store).find(([, value]) => value.tasks.some((task) => task.id === taskId))
      if (!entry) throw new CoreClientError('Task not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      const [projectId, state] = entry
      const current = state.tasks.find((task) => task.id === taskId)
      if (!current) throw new CoreClientError('Task not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      if (current.rowVersion !== expectedVersion) throw new CoreClientError('Workspace changed. Refresh before retrying.', { code: 'STALE_REVISION', category: 'STALE_REVISION', needsUser: true })
      if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > 500)) throw new CoreClientError('A task title is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      if (patch.description !== undefined && (typeof patch.description !== 'string' || patch.description.length > 10000)) throw new CoreClientError('Task description is invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      if (patch.priority !== undefined && (!Number.isSafeInteger(patch.priority) || patch.priority < -1000 || patch.priority > 1000)) throw new CoreClientError('Task priority is invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      if (patch.status !== undefined && !['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'].includes(patch.status)) throw new CoreClientError('Task status is invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      if (patch.status && patch.status !== current.status && !taskTransitionsFor(current.status).includes(patch.status)) throw new CoreClientError('That task state change is not allowed.', { code: 'INVALID_STATE_TRANSITION', category: 'CONFLICT', needsUser: true })
      const updated = { ...current, ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}), rowVersion: current.rowVersion + 1, updatedAt: new Date().toISOString() }
      const next = { ...state, tasks: state.tasks.map((task) => task.id === taskId ? updated : task), projectionSeq: state.projectionSeq + 1 }
      persistLocalWorkspace(projectId, next)
      syncLocalTasks(projectId, next.tasks)
      localCommandSuccess('UpdateTask', idempotencyKey, fingerprint, updated)
      return updated
    } catch (cause) {
      localCommandFailure('UpdateTask', idempotencyKey, fingerprint, cause)
      throw cause
    }
  }

  async createShot(projectId: string, code: string, title: string, idempotencyKey = crypto.randomUUID()): Promise<ShotSummary> {
    const normalizedCode = code.trim().toUpperCase()
    const normalizedTitle = title.trim()
    if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(normalizedCode) || !normalizedTitle || normalizedTitle.length > 500) throw new CoreClientError('Shot code and title are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ code: normalizedCode, title: normalizedTitle }),
      })
      return mapShotRecord(await readCorePayload(response, 'shot creation'))
    }
    const fingerprint = localCommandFingerprint({ projectId, code: normalizedCode, title: normalizedTitle })
    const replay = localCommandReplay<ShotSummary>('CreateShot', idempotencyKey, fingerprint)
    if (replay.handled) return replay.result as ShotSummary
    try {
      const project = localSnapshot().projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new CoreClientError('Project not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      const state = localWorkspace(projectId)
      if (state.shots.some((shot) => shot.code.toLowerCase() === normalizedCode.toLowerCase())) throw new CoreClientError('Shot code already exists in this project.', { code: 'DUPLICATE_SHOT_CODE', category: 'CONFLICT', needsUser: true })
      const shot: ShotSummary = { id: `${projectId}-shot-${crypto.randomUUID()}`, projectId, code: normalizedCode, title: normalizedTitle, lifecycleState: 'ACTIVE', rowVersion: 1, createdAt: new Date().toISOString() }
      persistLocalWorkspace(projectId, { ...state, shots: [...state.shots, shot], projectionSeq: state.projectionSeq + 1 })
      localCommandSuccess('CreateShot', idempotencyKey, fingerprint, shot)
      return shot
    } catch (cause) {
      localCommandFailure('CreateShot', idempotencyKey, fingerprint, cause)
      throw cause
    }
  }

  async updateShot(shotId: string, patch: { title?: string; lifecycleState?: ShotLifecycleState }, expectedVersion: number, idempotencyKey = crypto.randomUUID()): Promise<ShotSummary> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ command_type: 'UpdateShot', payload: { shot_id: shotId, ...patch, ...(patch.lifecycleState ? { lifecycle_state: patch.lifecycleState } : {}) }, expected_versions: { SHOT: expectedVersion } }),
      })
      return mapShotRecord(await readCorePayload(response, 'shot update'))
    }
    const fingerprint = localCommandFingerprint({ shotId, patch }, { SHOT: expectedVersion })
    const replay = localCommandReplay<ShotSummary>('UpdateShot', idempotencyKey, fingerprint)
    if (replay.handled) return replay.result as ShotSummary
    try {
      const store = localWorkspaceStore()
      const entry = Object.entries(store).find(([, value]) => value.shots.some((shot) => shot.id === shotId))
      if (!entry) throw new CoreClientError('Shot not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      const [projectId, state] = entry
      const current = state.shots.find((shot) => shot.id === shotId)
      if (!current) throw new CoreClientError('Shot not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      if (current.rowVersion !== expectedVersion) throw new CoreClientError('Workspace changed. Refresh before retrying.', { code: 'STALE_REVISION', category: 'STALE_REVISION', needsUser: true })
      if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > 500)) throw new CoreClientError('A shot title is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      if (patch.lifecycleState !== undefined && !['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED'].includes(patch.lifecycleState)) throw new CoreClientError('Shot lifecycle is invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      if (patch.lifecycleState && patch.lifecycleState !== current.lifecycleState && !shotTransitionsFor(current.lifecycleState).includes(patch.lifecycleState)) throw new CoreClientError('That shot lifecycle change is not allowed.', { code: 'INVALID_STATE_TRANSITION', category: 'CONFLICT', needsUser: true })
      const updated = { ...current, ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}), rowVersion: current.rowVersion + 1, updatedAt: new Date().toISOString() }
      persistLocalWorkspace(projectId, { ...state, shots: state.shots.map((shot) => shot.id === shotId ? updated : shot), projectionSeq: state.projectionSeq + 1 })
      localCommandSuccess('UpdateShot', idempotencyKey, fingerprint, updated)
      return updated
    } catch (cause) {
      localCommandFailure('UpdateShot', idempotencyKey, fingerprint, cause)
      throw cause
    }
  }

  async addNote(projectId: string, target: { entityType: WorkspaceNoteEntityType; entityId: string }, body: string, idempotencyKey = crypto.randomUUID()): Promise<NoteSummary> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ entity_type: target.entityType, entity_id: target.entityId, body }),
      })
      return mapNoteRecord(await readCorePayload(response, 'note creation'))
    }
    const normalizedBody = typeof body === 'string' ? body.trim() : ''
    const fingerprint = localCommandFingerprint({ projectId, target, body: normalizedBody })
    const replay = localCommandReplay<NoteSummary>('AddNote', idempotencyKey, fingerprint)
    if (replay.handled) return replay.result as NoteSummary
    try {
      const project = localSnapshot().projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new CoreClientError('Project not found', { code: 'NOT_FOUND', category: 'VALIDATION' })
      if (!['PROJECT', 'TASK', 'SHOT'].includes(target.entityType) || typeof target.entityId !== 'string' || !target.entityId.trim()) throw new CoreClientError('Note target is invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      const state = localWorkspace(projectId)
      if (target.entityType === 'TASK' && !state.tasks.some((task) => task.id === target.entityId)) throw new CoreClientError('Task does not belong to this project.', { code: 'ENTITY_SCOPE_MISMATCH', category: 'CONFLICT', needsUser: true })
      if (target.entityType === 'SHOT' && !state.shots.some((shot) => shot.id === target.entityId)) throw new CoreClientError('Shot does not belong to this project.', { code: 'ENTITY_SCOPE_MISMATCH', category: 'CONFLICT', needsUser: true })
      if (target.entityType === 'PROJECT' && target.entityId !== projectId) throw new CoreClientError('Project scope does not match.', { code: 'ENTITY_SCOPE_MISMATCH', category: 'CONFLICT', needsUser: true })
      if (!normalizedBody || normalizedBody.length > 50000) throw new CoreClientError('A note body is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
      const note: NoteSummary = { id: `${projectId}-note-${crypto.randomUUID()}`, projectId, entityType: target.entityType, entityId: target.entityId, body: normalizedBody, createdAt: new Date().toISOString() }
      const next = { ...state, notes: [note, ...state.notes], projectionSeq: state.projectionSeq + 1 }
      persistLocalWorkspace(projectId, next)
      localCommandSuccess('AddNote', idempotencyKey, fingerprint, note)
      return note
    } catch (cause) {
      localCommandFailure('AddNote', idempotencyKey, fingerprint, cause)
      throw cause
    }
  }

  async getProjectWorkspace(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspace> {
    if (!this.baseUrl) {
      const project = localSnapshot().projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new Error('Project no longer exists in Core')
      const state = localWorkspace(projectId)
      const productionItems = state.tasks.map(taskToProductionItem)
      return { projectId, productionItems, tasks: structuredClone(state.tasks), shots: structuredClone(state.shots), notes: structuredClone(state.notes), shotsCount: state.shots.length, notesCount: state.notes.length, projectionSeq: state.projectionSeq, generatedAt: new Date().toISOString() }
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/workspace`, { signal, headers: { Accept: 'application/json' } })
    const payload = await readCorePayload(response, 'workspace')
    const result = asRecord(payload)
    const taskSources = arrayValue(result.tasks ?? result.production_items ?? result.productionItems)
    const counts = asRecord(result.counts)
    const tasks = taskSources.map(mapTaskRecord)
    const shots = arrayValue(result.shots).map(mapShotRecord)
    const notes = arrayValue(result.notes).map(mapNoteRecord)
    const productionItems = tasks.map(taskToProductionItem)
    return {
      projectId,
      productionItems,
      tasks,
      shots,
      notes,
      shotsCount: numberValue(result.shots_count ?? result.shotsCount ?? counts.shots ?? shots.length, shots.length),
      notesCount: numberValue(result.notes_count ?? result.notesCount ?? counts.notes ?? notes.length, notes.length),
      projectionSeq: numberValue(result.projection_seq ?? result.projectionSeq, 0),
      generatedAt: stringValue(result.generated_at ?? result.generatedAt),
    }
  }

  async getProjectActivity(projectId: string, signal?: AbortSignal): Promise<ActivityItem[]> {
    if (!this.baseUrl) {
      const snapshot = localSnapshot()
      const project = snapshot.projects.find((candidate) => candidate.id === projectId)
      return project ? snapshot.activity.filter((item) => item.projectId === project.id || item.projectName === project.name) : []
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/activity`, { signal, headers: { Accept: 'application/json' } })
    const payload = await readCorePayload(response, 'activity')
    const result = asRecord(payload)
    const sources = arrayValue(result.activity ?? result.items ?? result.events ?? payload)
    return sources.map((source, index) => mapActivityRecord(source, projectId, index))
  }

  async getAssets(projectId?: string, signal?: AbortSignal): Promise<AssetSummary[]> {
    if (!this.baseUrl) return []
    const endpoint = projectId
      ? `${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/assets`
      : `${this.baseUrl}/v1/assets`
    const response = await fetch(endpoint, { signal, headers: { Accept: 'application/json' } })
    const payload = await readCorePayload(response, 'assets')
    const result = asRecord(payload)
    return arrayValue(result.assets).map(mapAssetRecord)
  }

  async getMediaProfile(projectId: string, signal?: AbortSignal): Promise<MediaProfileWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Media profile requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/media-profile`, { signal, headers: { Accept: 'application/json' } })
    return mapMediaProfileWorkspaceRecord(await readCorePayload(response, 'media profile'))
  }

  async createMediaProfileRevision(projectId: string, input: MediaProfileInput, idempotencyKey: string = crypto.randomUUID()): Promise<MediaProfileWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Media profile changes require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/media-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        timeline_rate: input.timelineRate,
        time_base: input.timeBase,
        pixel_aspect: input.pixelAspect,
        width: input.width,
        height: input.height,
        drop_frame_policy: input.dropFramePolicy ?? 'NON_DROP',
        working_color_space: input.workingColorSpace,
        transfer_function: input.transferFunction,
        hdr_policy: input.hdrPolicy,
        audio_sample_rate: input.audioSampleRate,
        audio_channel_layout: input.audioChannelLayout,
        proxy_profile: input.proxyProfile ?? {},
        mastering_targets: input.masteringTargets ?? {},
      }),
    })
    return mapMediaProfileWorkspaceRecord(await readCorePayload(response, 'media profile creation'))
  }

  async transitionMediaProfileRevision(projectId: string, revisionId: string, nextState: string, expectedVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<MediaProfileWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Media profile transitions require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/media-profile/revisions/${encodeURIComponent(revisionId)}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ next_state: nextState, expected_version: expectedVersion }),
    })
    return mapMediaProfileWorkspaceRecord(await readCorePayload(response, 'media profile transition'))
  }

  async getTimelines(projectId: string, signal?: AbortSignal): Promise<TimelineSummary[]> {
    if (!this.baseUrl) throw new CoreClientError('Timeline requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'timelines'))
    return arrayValue(payload.timelines ?? payload.items ?? payload).map(mapTimelineSummaryRecord)
  }

  async getTimelineWorkspace(projectId: string, timelineId: string, signal?: AbortSignal): Promise<TimelineWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Timeline workspace requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/workspace`, { signal, headers: { Accept: 'application/json' } })
    return mapTimelineWorkspaceRecord(await readCorePayload(response, 'timeline workspace'))
  }

  async createTimeline(projectId: string, input: TimelineInput, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineSummary> {
    if (!this.baseUrl) throw new CoreClientError('Timeline creation requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const title = input.title.trim()
    if (!title || title.length > 500) throw new CoreClientError('A timeline title is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        title,
        ...(input.code?.trim() ? { code: input.code.trim() } : {}),
        scope_type: input.scopeType ?? 'PROJECT',
        ...(input.scopeId ? { scope_id: input.scopeId } : {}),
        media_profile_revision_id: input.mediaProfileRevisionId,
      }),
    })
    return mapTimelineSummaryRecord(await readCorePayload(response, 'timeline creation'))
  }

  async createTimelineRevision(projectId: string, timelineId: string, input: TimelineSnapshotInput, expectedVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Timeline checkpoints require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        media_profile_revision_id: input.mediaProfileRevisionId,
        duration: input.duration,
        tracks: input.tracks,
        markers: input.markers,
        expected_version: expectedVersion,
      }),
    })
    return mapTimelineWorkspaceRecord(await readCorePayload(response, 'timeline checkpoint'))
  }

  async transitionTimelineRevision(projectId: string, timelineId: string, revisionId: string, nextState: string, expectedVersion: number, idempotencyKey: string = crypto.randomUUID(), reviewSessionId?: string, dependencySnapshotHash?: string): Promise<TimelineWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Timeline transitions require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/revisions/${encodeURIComponent(revisionId)}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        next_state: nextState,
        expected_version: expectedVersion,
        ...(reviewSessionId ? { review_session_id: reviewSessionId } : {}),
        ...(dependencySnapshotHash ? { dependency_snapshot_hash: dependencySnapshotHash } : {}),
      }),
    })
    return mapTimelineWorkspaceRecord(await readCorePayload(response, 'timeline revision transition'))
  }

  async getReviews(projectId: string, state?: string, signal?: AbortSignal): Promise<ReviewSession[]> {
    if (!this.baseUrl) throw new CoreClientError('Review requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const query = state ? `?state=${encodeURIComponent(state)}` : ''
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/reviews${query}`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'reviews'))
    return arrayValue(payload.reviews ?? payload.items ?? payload).map(mapReviewSessionRecord)
  }

  async getReview(projectId: string, reviewSessionId: string, signal?: AbortSignal): Promise<ReviewWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Review details require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewSessionId)}`, { signal, headers: { Accept: 'application/json' } })
    return mapReviewWorkspaceRecord(await readCorePayload(response, 'review details'))
  }

  async openReview(projectId: string, subjectRevisionId: string, expectedVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<ReviewWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Opening a review requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!subjectRevisionId.trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new CoreClientError('A timeline revision and current version are required to open a review.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ subject_type: 'TIMELINE_REVISION', subject_revision_id: subjectRevisionId, expected_version: expectedVersion }),
    })
    return mapReviewWorkspaceRecord(await readCorePayload(response, 'review opening'))
  }

  async submitReview(projectId: string, reviewSessionId: string, decision: HumanReviewDecision, expectedVersion: number, notes = '', reasonCodes: string[] = [], idempotencyKey: string = crypto.randomUUID()): Promise<ReviewWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Submitting a review requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!reviewSessionId.trim() || !['APPROVE', 'REJECT', 'REPAIR', 'ABSTAIN'].includes(decision) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new CoreClientError('A review decision and current review version are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewSessionId)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ decision, notes, reason_codes: reasonCodes, expected_version: expectedVersion }),
    })
    return mapReviewWorkspaceRecord(await readCorePayload(response, 'review submission'))
  }

  async getHandoffs(projectId: string, state?: string, signal?: AbortSignal): Promise<HandoffListItem[]> {
    if (!this.baseUrl) throw new CoreClientError('Handoff requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const query = state ? `?state=${encodeURIComponent(state)}` : ''
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/handoffs${query}`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'handoffs'))
    return arrayValue(payload.items ?? payload.handoffs ?? payload).map(mapHandoffListItemRecord)
  }

  async getHandoff(projectId: string, handoffId: string, signal?: AbortSignal): Promise<HandoffWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Handoff details require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!handoffId.trim()) throw new CoreClientError('A handoff id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}`, { signal, headers: { Accept: 'application/json' } })
    return mapHandoffWorkspaceRecord(await readCorePayload(response, 'handoff details'))
  }

  async createHandoffManifest(projectId: string, input: { timelineRevisionId: string; reviewSessionId: string; dependencySnapshotHash: string; targetEditor: string; targetVersion: string; targetProfile?: string; expectedVersion: number }, idempotencyKey: string = crypto.randomUUID()): Promise<HandoffWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Creating a handoff preflight requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!input.timelineRevisionId.trim() || !input.reviewSessionId.trim() || !/^[0-9a-f]{64}$/i.test(input.dependencySnapshotHash) || !input.targetEditor.trim() || !input.targetVersion.trim() || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new CoreClientError('The approved timeline, review snapshot, target editor/version, and current revision version are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        timeline_revision_id: input.timelineRevisionId,
        review_session_id: input.reviewSessionId,
        dependency_snapshot_hash: input.dependencySnapshotHash,
        target_editor: input.targetEditor,
        target_version: input.targetVersion,
        target_profile: input.targetProfile ?? 'GENERIC_INTERCHANGE',
        expected_version: input.expectedVersion,
      }),
    })
    return mapHandoffWorkspaceRecord(await readCorePayload(response, 'handoff creation'))
  }

  async getCharacters(projectId?: string, signal?: AbortSignal): Promise<CharacterSummary[]> {
    if (!this.baseUrl) return []
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    const response = await fetch(`${this.baseUrl}/v1/characters${query}`, { signal, headers: { Accept: 'application/json' } })
    const payload = await readCorePayload(response, 'characters')
    const result = asRecord(payload)
    return arrayValue(result.characters ?? result.items ?? payload).map(mapCharacterRecord)
  }

  async getCharacterWorkspace(characterId: string, signal?: AbortSignal): Promise<CharacterWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Character workspace requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/characters/${encodeURIComponent(characterId)}/workspace`, { signal, headers: { Accept: 'application/json' } })
    return mapCharacterWorkspaceRecord(await readCorePayload(response, 'character workspace'))
  }

  async createCharacter(projectId: string, displayName: string, stableCode?: string, idempotencyKey: string = crypto.randomUUID()): Promise<CharacterSummary> {
    const normalizedName = displayName.trim()
    if (!normalizedName || normalizedName.length > 500) throw new CoreClientError('A character name is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    if (!this.baseUrl) throw new CoreClientError('Character creation requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/characters`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ display_name: normalizedName, ...(stableCode?.trim() ? { stable_code: stableCode.trim() } : {}) }),
    })
    return mapCharacterRecord(await readCorePayload(response, 'character creation'))
  }

  async createVisualIdentityRevision(characterId: string, input: CharacterRevisionInput, idempotencyKey: string = crypto.randomUUID()): Promise<CharacterRevision> {
    return this.createCharacterRevision('visual', characterId, input, idempotencyKey)
  }

  async createVoiceIdentityRevision(characterId: string, input: CharacterRevisionInput, idempotencyKey: string = crypto.randomUUID()): Promise<CharacterRevision> {
    return this.createCharacterRevision('voice', characterId, input, idempotencyKey)
  }

  async createPerformanceBibleRevision(characterId: string, input: CharacterRevisionInput, idempotencyKey: string = crypto.randomUUID()): Promise<CharacterRevision> {
    return this.createCharacterRevision('performance', characterId, input, idempotencyKey)
  }

  private async createCharacterRevision(kind: CharacterRevisionKind, characterId: string, input: CharacterRevisionInput, idempotencyKey: string): Promise<CharacterRevision> {
    if (!this.baseUrl) throw new CoreClientError('Character revisions require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const route = kind === 'visual' ? 'visual-revisions' : kind === 'voice' ? 'voice-revisions' : 'performance-bibles'
    const fields = allowedCharacterRevisionFields(kind, input.fields)
    const payload = {
      ...fields,
      ...(input.semanticDescription?.trim() ? { semantic_description: input.semanticDescription.trim() } : {}),
      ...(input.canonicalLanguage?.trim() ? { canonical_language: input.canonicalLanguage.trim() } : {}),
      ...(input.rightsIdentityId?.trim() ? { rights_identity_id: input.rightsIdentityId.trim() } : {}),
    }
    const response = await fetch(`${this.baseUrl}/v1/characters/${encodeURIComponent(characterId)}/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload),
    })
    return mapCharacterRevisionRecord(await readCorePayload(response, `${kind} revision creation`), kind)
  }

  async stageAsset(file: File): Promise<StagedAsset> {
    if (!this.baseUrl) throw new Error('File staging requires a connected Core')
    const response = await fetch(`${this.baseUrl}/v1/desktop/stage`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        // HTTP header values are byte strings. Encode the browser filename as
        // bounded UTF-8 base64url so Vietnamese/CJK/emoji names survive the
        // local boundary without parser failures or mojibake.
        'X-CineForge-Filename-B64': encodeFilenameHeader(file.name),
      },
      body: file,
    })
    const payload = await readCorePayload(response, 'file staging')
    const result = asRecord(payload)
    const handle = stringValue(result.handle)
    if (!handle) throw new Error('Core did not return a staging handle')
    return {
      handle,
      name: stringValue(result.name) ?? file.name,
      mimeType: stringValue(result.mimeType ?? result.mime_type) ?? file.type,
      byteSize: numberValue(result.byteSize ?? result.byte_size, file.size),
    }
  }

  async importAsset(input: ImportAssetInput): Promise<AssetSummary> {
    if (!this.baseUrl) throw new Error('Asset import requires a connected Core')
    if (!input.sourcePath && !input.sourceHandle) throw new Error('An asset path or staging handle is required')
    const endpoint = input.projectId
      ? `${this.baseUrl}/v1/projects/${encodeURIComponent(input.projectId)}/assets`
      : `${this.baseUrl}/v1/assets`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey ?? crypto.randomUUID() },
      body: JSON.stringify({
        ...(input.sourcePath ? { source_path: input.sourcePath } : {}),
        ...(input.sourceHandle ? { source_handle: input.sourceHandle } : {}),
        ...(input.projectId ? { project_id: input.projectId } : {}),
        ...(input.originalName ? { original_name: input.originalName } : {}),
        ...(input.displayName ? { display_name: input.displayName } : {}),
        ...(input.assetType ? { asset_type: input.assetType } : {}),
        ...(input.semanticRole ? { semantic_role: input.semanticRole } : {}),
        ...(input.storageMode ? { storage_mode: input.storageMode } : {}),
        ...(input.contentHash ? { content_hash: input.contentHash } : {}),
        ...(input.mimeType ? { mime_type: input.mimeType } : {}),
        ...(input.intentHint ? { intent_hint: input.intentHint } : {}),
      }),
    })
    const payload = await readCorePayload(response, 'asset import')
    return mapAssetRecord(payload)
  }
}

const CHARACTER_REVISION_FIELD_ALLOWLIST: Record<CharacterRevisionKind, ReadonlySet<string>> = {
  visual: new Set(['anatomy', 'proportion', 'proportions', 'palette', 'marking', 'markings', 'forbidden_drift', 'forbiddenDrift', 'references']),
  voice: new Set(['accent_profile', 'accentProfile', 'vocal_range', 'vocalRange', 'timbre', 'prosody', 'emotional_map', 'emotionalMap', 'pronunciation_lexicon', 'pronunciationLexicon', 'forbidden_traits', 'forbiddenTraits']),
  performance: new Set(['posture', 'gait', 'gestures', 'eye_behavior', 'eyeBehavior', 'reaction_timing', 'reactionTiming', 'speech_rhythm', 'speechRhythm', 'emotional_baseline', 'emotionalBaseline', 'forbidden_drift', 'forbiddenDrift']),
}

function allowedCharacterRevisionFields(kind: CharacterRevisionKind, fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {}
  const allowlist = CHARACTER_REVISION_FIELD_ALLOWLIST[kind]
  return Object.fromEntries(Object.entries(fields).filter(([key]) => allowlist.has(key)))
}

async function readCorePayload(response: Response, label: string): Promise<unknown> {
  let payload: unknown = null
  try { payload = await response.json() } catch { /* handled below */ }
  const envelope = asRecord(payload)
  if (!response.ok || envelope.ok === false) {
    const error = asRecord(envelope.error)
    const technicalDetails = asRecord(error.technical_details ?? error.technicalDetails)
    throw new CoreClientError(
      stringValue(error.user_message_key ?? error.message) ?? `Core ${label} request failed (${response.status})`,
      {
        code: stringValue(error.code) ?? `HTTP_${response.status}`,
        category: stringValue(error.category) ?? 'UNKNOWN',
        retryable: Boolean(error.retryable),
        needsUser: error.needs_user === undefined ? true : Boolean(error.needs_user),
        userMessageKey: stringValue(error.user_message_key),
        technicalDetails,
      },
    )
  }
  return envelope.result ?? payload
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function encodeFilenameHeader(filename: string): string {
  const bytes = new TextEncoder().encode(filename.slice(0, 255))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : fallback
}

function mapProductionItemRecord(value: unknown, index: number): ProductionItem {
  const source = asRecord(value)
  const rawState = stringValue(source.state ?? source.status ?? source.lifecycle_state) ?? 'todo'
  const state: ProductionItem['state'] = ['DONE', 'COMPLETE', 'completed', 'done'].includes(rawState) ? 'done' : ['RUNNING', 'IN_PROGRESS', 'running', 'in_progress'].includes(rawState) ? 'in_progress' : ['BLOCKED', 'blocked'].includes(rawState) ? 'blocked' : ['CANCELLED', 'cancelled'].includes(rawState) ? 'cancelled' : 'todo'
  return {
    id: stringValue(source.id ?? source.task_id) ?? `workspace-item-${index}`,
    title: stringValue(source.title ?? source.name) ?? 'Production item',
    detail: stringValue(source.detail ?? source.description) ?? (state === 'done' ? 'Đã hoàn tất' : 'Mới tạo · chưa bắt đầu'),
    state,
  }
}

function taskToProductionItem(task: TaskSummary): ProductionItem {
  const state: ProductionItem['state'] = task.status === 'DONE' ? 'done' : task.status === 'IN_PROGRESS' ? 'in_progress' : task.status === 'BLOCKED' ? 'blocked' : task.status === 'CANCELLED' ? 'cancelled' : 'todo'
  return {
    id: task.id,
    title: task.title,
    detail: task.description || (task.status === 'BLOCKED' ? 'Đang bị chặn' : task.status === 'CANCELLED' ? 'Đã huỷ' : 'Mới tạo · chưa bắt đầu'),
    state,
  }
}

function mapTaskRecord(value: unknown): TaskSummary {
  const envelope = asRecord(value)
  const source = asRecord(envelope.task ?? envelope.result ?? value)
  const rawStatus = stringValue(source.status ?? source.state) ?? 'PLANNED'
  const status: TaskStatus = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'].includes(rawStatus) ? rawStatus as TaskStatus : 'PLANNED'
  return {
    id: stringValue(source.id ?? source.task_id) ?? `task-${crypto.randomUUID()}`,
    projectId: stringValue(source.project_id ?? source.projectId) ?? '',
    title: stringValue(source.title) ?? 'Production task',
    description: typeof source.description === 'string' ? source.description : '',
    status,
    priority: integerValue(source.priority, 0, -1000, 1000),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapShotRecord(value: unknown): ShotSummary {
  const envelope = asRecord(value)
  const source = asRecord(envelope.shot ?? envelope.result ?? value)
  const rawState = stringValue(source.lifecycle_state ?? source.lifecycleState ?? source.state) ?? 'ACTIVE'
  const lifecycleState: ShotLifecycleState = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'TRASHED'].includes(rawState) ? rawState as ShotLifecycleState : 'ACTIVE'
  return {
    id: stringValue(source.id ?? source.shot_id) ?? `shot-${crypto.randomUUID()}`,
    projectId: stringValue(source.project_id ?? source.projectId) ?? '',
    code: stringValue(source.code) ?? 'SHOT',
    title: stringValue(source.title) ?? 'Planning shot',
    lifecycleState,
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapNoteRecord(value: unknown): NoteSummary {
  const envelope = asRecord(value)
  const source = asRecord(envelope.note ?? envelope.result ?? value)
  const rawType = stringValue(source.entity_type ?? source.entityType) ?? 'PROJECT'
  const entityType: WorkspaceNoteEntityType = ['PROJECT', 'TASK', 'SHOT'].includes(rawType) ? rawType as WorkspaceNoteEntityType : 'PROJECT'
  return {
    id: stringValue(source.id ?? source.note_id) ?? `note-${crypto.randomUUID()}`,
    projectId: stringValue(source.project_id ?? source.projectId) ?? '',
    entityType,
    entityId: stringValue(source.entity_id ?? source.entityId) ?? '',
    body: stringValue(source.body) ?? '',
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function syncLocalTasks(projectId: string, tasks: TaskSummary[]) {
  const snapshot = localSnapshot()
  const project = snapshot.projects.find((candidate) => candidate.id === projectId)
  if (!project) return
  project.productionItems = tasks.map(taskToProductionItem)
  project.completion = { done: tasks.filter((task) => task.status === 'DONE').length, total: tasks.length }
  project.health = project.health === 'blocked' ? 'blocked' : tasks.some((task) => task.status === 'BLOCKED') ? 'attention' : 'healthy'
  project.updatedAt = 'Vừa cập nhật'
  saveLocalSnapshot(snapshot)
}

function taskTransitionsFor(status: TaskStatus): TaskStatus[] {
  const transitions: Record<TaskStatus, TaskStatus[]> = {
    PLANNED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
    IN_PROGRESS: ['DONE', 'BLOCKED', 'CANCELLED'],
    BLOCKED: ['PLANNED', 'IN_PROGRESS', 'CANCELLED'],
    DONE: [],
    CANCELLED: [],
  }
  return transitions[status]
}

function shotTransitionsFor(state: ShotLifecycleState): ShotLifecycleState[] {
  const transitions: Record<ShotLifecycleState, ShotLifecycleState[]> = {
    ACTIVE: ['PAUSED', 'ARCHIVED', 'TRASHED'],
    PAUSED: ['ACTIVE', 'ARCHIVED', 'TRASHED'],
    ARCHIVED: ['TRASHED'],
    TRASHED: ['ACTIVE'],
  }
  return transitions[state]
}

function humanizeDecisionKey(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const text = value.replace(/^[a-z0-9]+\./i, '').replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : fallback
}

function decisionAge(createdAt: string | undefined): string {
  if (!createdAt) return 'Vừa cập nhật'
  const timestamp = Date.parse(createdAt)
  if (!Number.isFinite(timestamp)) return 'Vừa cập nhật'
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 1) return 'Vừa xong'
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Hôm qua' : `${days} ngày trước`
}

function mapDecisionRecord(value: unknown): DecisionRequest {
  const envelope = asRecord(value)
  const source = asRecord(envelope.decision ?? envelope.decision_request ?? envelope.result ?? value)
  const rawState = stringValue(source.state) ?? 'OPEN'
  const state: DecisionRequest['state'] = ['OPEN', 'RESOLVED', 'DISMISSED', 'EXPIRED', 'OBSOLETE'].includes(rawState) ? rawState as DecisionRequest['state'] : 'OPEN'
  const rawSeverity = stringValue(source.severity ?? source.priority) ?? 'NORMAL'
  const severity = rawSeverity.toUpperCase()
  const createdAt = stringValue(source.created_at ?? source.createdAt)
  const titleKey = stringValue(source.title_key ?? source.titleKey)
  const reasonKey = stringValue(source.reason_key ?? source.reasonKey)
  const title = stringValue(source.title) ?? humanizeDecisionKey(titleKey, 'Decision needed')
  const reason = stringValue(source.reason ?? source.detail) ?? humanizeDecisionKey(reasonKey, 'Core is waiting for your decision.')
  const choices = arrayValue(source.choices ?? source.decision_choices).map((value, index) => {
    const choice = asRecord(value)
    const labelKey = stringValue(choice.label_key ?? choice.labelKey)
    return {
      id: stringValue(choice.id) ?? `choice-${index + 1}`,
      labelKey,
      label: stringValue(choice.label) ?? humanizeDecisionKey(labelKey, `Choice ${index + 1}`),
      commandTemplate: choice.command_template ?? choice.commandTemplate,
      consequenceSummary: choice.consequence_summary ?? choice.consequenceSummary,
      recommended: Boolean(choice.recommended),
    }
  })
  const projectId = stringValue(source.project_id ?? source.projectId) ?? 'studio'
  const rawDefaultBehavior = source.default_behavior ?? source.defaultBehavior
  const defaultBehavior = typeof rawDefaultBehavior === 'string'
    ? rawDefaultBehavior
    : asRecord(rawDefaultBehavior).label_key
      ? humanizeDecisionKey(stringValue(asRecord(rawDefaultBehavior).label_key), '')
      : asRecord(rawDefaultBehavior).action
        ? humanizeDecisionKey(stringValue(asRecord(rawDefaultBehavior).action), '')
        : undefined
  const rawAge = stringValue(source.age)
  return {
    id: stringValue(source.id ?? source.decision_request_id) ?? `decision-${crypto.randomUUID()}`,
    projectId,
    projectName: stringValue(source.project_name ?? source.projectName ?? source.project_title ?? source.projectTitle) ?? (projectId === 'studio' ? 'Studio' : projectId),
    decisionType: stringValue(source.decision_type ?? source.decisionType) ?? 'GENERAL',
    title,
    titleKey,
    detail: stringValue(source.detail) ?? reason,
    reason,
    reasonKey,
    reasonArgs: asRecord(source.reason_args ?? source.reasonArgs),
    blockingScopeType: stringValue(source.blocking_scope_type ?? source.blockingScopeType) ?? 'SYSTEM',
    blockingScopeId: stringValue(source.blocking_scope_id ?? source.blockingScopeId),
    severity,
    state,
    decisionVersion: numberValue(source.decision_version ?? source.decisionVersion ?? source.row_version, 1),
    choices,
    recommendedChoiceId: stringValue(source.recommended_choice_id ?? source.recommendedChoiceId),
    deadlineAt: stringValue(source.deadline_at ?? source.deadlineAt),
    defaultBehavior,
    requiredAuthority: stringValue(source.required_authority ?? source.requiredAuthority),
    evidence: Array.isArray(source.evidence) ? source.evidence : [],
    resolvedChoiceId: stringValue(source.resolved_choice_id ?? source.resolvedChoiceId),
    createdAt,
    resolvedAt: stringValue(source.resolved_at ?? source.resolvedAt),
    age: rawAge && !Number.isFinite(Date.parse(rawAge)) ? rawAge : decisionAge(createdAt),
    priority: severity === 'HIGH' || severity === 'CRITICAL' ? 'high' : 'normal',
    actionLabel: stringValue(source.action_label ?? source.actionLabel) ?? (choices[0]?.label ?? 'Review'),
  }
}

function mapActivityRecord(value: unknown, projectId: string, index: number): ActivityItem {
  const source = asRecord(value)
  const rawState = stringValue(source.state ?? source.status ?? source.lifecycle_state) ?? 'waiting'
  const states: WorkState[] = ['running', 'needs_user', 'complete', 'blocked', 'waiting']
  const state = states.includes(rawState as WorkState) ? rawState as WorkState : rawState.toLowerCase().includes('block') ? 'blocked' : rawState.toLowerCase().includes('complete') || rawState.toLowerCase().includes('done') ? 'complete' : 'waiting'
  return {
    id: stringValue(source.id ?? source.event_id) ?? `${projectId}-activity-${index}`,
    projectId: stringValue(source.project_id ?? source.projectId) ?? projectId,
    projectName: stringValue(source.project_name ?? source.projectName) ?? projectId,
    label: stringValue(source.label ?? source.title ?? source.event_type) ?? 'Core activity',
    detail: stringValue(source.detail ?? source.description) ?? 'Activity recorded by Core',
    state,
    milestone: stringValue(source.milestone ?? source.message),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt ?? source.created_at) ?? 'Vừa cập nhật',
    actionable: Boolean(source.actionable ?? source.needs_user),
  }
}

function mapAssetRecord(value: unknown): AssetSummary {
  const source = asRecord(value)
  const asset = asRecord(source.asset ?? source)
  const revision = asRecord(asset.latest_revision ?? asset.latestRevision ?? source.revision)
  const storage = asRecord(revision.storage_object)
  const location = Array.isArray(revision.locations) ? asRecord(revision.locations[0]) : {}
  const warnings = Array.isArray(source.warnings) ? source.warnings.filter((item): item is string => typeof item === 'string') : []
  const rightsSource = asRecord(asset.rights ?? source.rights)
  const rightsStatus = String(rightsSource.status ?? rightsSource.state ?? 'UNKNOWN').toUpperCase()
  const rightsStates = ['ALLOWED', 'RESTRICTED', 'UNKNOWN', 'REVOKED', 'EXPIRED']
  const rights: RightsSummary = {
    status: (rightsStates.includes(rightsStatus) ? rightsStatus : 'UNKNOWN') as RightsSummary['status'],
    state: (rightsStates.includes(rightsStatus) ? rightsStatus : 'UNKNOWN') as RightsSummary['state'],
    eligible: Boolean(rightsSource.eligible),
    rightsIdentityId: stringValue(rightsSource.rights_identity_id ?? rightsSource.rightsIdentityId ?? rightsSource.identity_id ?? asRecord(rightsSource.identity).id),
    rightType: stringValue(rightsSource.right_type ?? rightsSource.rightType),
    consentType: stringValue(rightsSource.consent_type ?? rightsSource.consentType),
    rightStatus: rightsStates.includes(String(rightsSource.right_status ?? '').toUpperCase()) ? String(rightsSource.right_status).toUpperCase() as RightsSummary['rightStatus'] : undefined,
    consentStatus: rightsStates.includes(String(rightsSource.consent_status ?? '').toUpperCase()) ? String(rightsSource.consent_status).toUpperCase() as RightsSummary['consentStatus'] : undefined,
    blockers: Array.isArray(rightsSource.blockers) ? rightsSource.blockers.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [],
    evidence: Array.isArray(rightsSource.evidence) ? rightsSource.evidence.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [],
    evaluatedAt: stringValue(rightsSource.evaluated_at ?? rightsSource.evaluatedAt),
    identity: rightsSource.identity && typeof rightsSource.identity === 'object' && !Array.isArray(rightsSource.identity) ? rightsSource.identity as Record<string, unknown> : null,
  }
  return {
    id: stringValue(asset.id) ?? `asset-${Math.random().toString(36).slice(2)}`,
    projectId: stringValue(asset.project_id ?? asset.projectId),
    name: stringValue(asset.display_name ?? asset.name) ?? 'Imported asset',
    assetType: stringValue(asset.asset_type ?? asset.assetType) ?? 'GENERIC',
    originType: stringValue(asset.origin_type ?? asset.originType) ?? 'IMPORTED',
    state: stringValue(asset.lifecycle_state ?? asset.state) ?? 'ACTIVE',
    availability: stringValue(asset.availability ?? revision.availability_state ?? revision.availability) ?? 'AVAILABLE',
    readinessState: ['READY', 'UNKNOWN', 'REVIEW_REQUIRED'].includes(String(asset.readinessState ?? asset.readiness_state ?? revision.readiness_state).toUpperCase())
      ? String(asset.readinessState ?? asset.readiness_state ?? revision.readiness_state).toUpperCase() as AssetSummary['readinessState'] : 'UNKNOWN',
    revisionId: stringValue(asset.revisionId ?? asset.revision_id ?? revision.id ?? revision.revision_id ?? revision.revisionId),
    hashAlgorithm: stringValue(asset.hashAlgorithm ?? asset.hash_algorithm ?? storage.hash_algorithm ?? storage.hashAlgorithm),
    contentHash: stringValue(asset.contentHash ?? asset.content_hash ?? storage.content_hash ?? storage.contentHash),
    byteSize: numberValue(asset.byteSize ?? asset.byte_size ?? storage.byte_size ?? storage.byteSize, 0),
    storageUri: stringValue(asset.storageUri ?? asset.storage_uri ?? location.path_or_uri ?? location.pathOrUri),
    provenance: asRecord(revision.provenance),
    importSessionId: stringValue(asset.importSessionId ?? asRecord(source.import_session).id ?? source.importSessionId),
    importItemId: stringValue(asset.importItemId ?? asRecord(source.import_item).id ?? source.importItemId),
    warnings,
    rights,
    latestRevision: revision,
  }
}

function mapCharacterRights(value: unknown): RightsSummary | null {
  const source = asRecord(value)
  if (Object.keys(source).length === 0) return null
  const rightsStates: RightsState[] = ['ALLOWED', 'RESTRICTED', 'UNKNOWN', 'REVOKED', 'EXPIRED']
  const rawStatus = String(source.status ?? source.state ?? 'UNKNOWN').toUpperCase()
  const status = rightsStates.includes(rawStatus as RightsState) ? rawStatus as RightsState : 'UNKNOWN'
  const safeItems = (items: unknown): Array<Record<string, unknown>> => arrayValue(items)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => Object.fromEntries(['code', 'dimension', 'status', 'evidence_id', 'id']
      .filter((key) => typeof item[key] === 'string' && item[key].length > 0)
      .map((key) => [key, item[key]])))
  return {
    status,
    state: status,
    eligible: source.eligible === true,
    rightsIdentityId: stringValue(source.rights_identity_id ?? source.rightsIdentityId),
    rightType: stringValue(source.right_type ?? source.rightType),
    consentType: stringValue(source.consent_type ?? source.consentType),
    rightStatus: rightsStates.includes(String(source.right_status ?? '').toUpperCase() as RightsState) ? String(source.right_status).toUpperCase() as RightsState : 'UNKNOWN',
    consentStatus: rightsStates.includes(String(source.consent_status ?? '').toUpperCase() as RightsState) ? String(source.consent_status).toUpperCase() as RightsState : 'UNKNOWN',
    blockers: safeItems(source.blockers),
    evidence: safeItems(source.evidence),
    evaluatedAt: stringValue(source.evaluated_at ?? source.evaluatedAt),
    identity: null,
  }
}

function mapCharacterRevisionRecord(value: unknown, kind: CharacterRevisionKind): CharacterRevision {
  const envelope = asRecord(value)
  const source = asRecord(envelope.revision ?? envelope.visual_revision ?? envelope.voice_revision ?? envelope.performance_bible_revision ?? envelope.result ?? value)
  const rawState = stringValue(source.state ?? source.lifecycle_state ?? source.lifecycleState) ?? 'DRAFT'
  const rights = mapCharacterRights(source.rights)
  return {
    id: stringValue(source.id ?? source.revision_id ?? source.revisionId) ?? `${kind}-revision-${crypto.randomUUID()}`,
    kind,
    revisionNumber: numberValue(source.revision_number ?? source.revisionNumber ?? source.version, 0) || undefined,
    state: rawState,
    approvalState: stringValue(source.approval_state ?? source.approvalState),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
    semanticDescription: stringValue(source.semantic_description ?? source.semanticDescription ?? source.description),
    readinessState: stringValue(source.readiness_state ?? source.readinessState),
    nextStep: stringValue(source.next_step ?? source.nextStep),
    canonicalLanguage: stringValue(source.canonical_language ?? source.canonicalLanguage ?? source.language),
    rightsStatus: stringValue(source.rights_status ?? source.rightsStatus ?? rights?.status),
    rights,
    rightsIdentityId: stringValue(source.rights_identity_id ?? source.rightsIdentityId),
    bindingState: stringValue(source.binding_state ?? source.bindingState),
    referenceCount: numberValue(source.reference_count ?? source.referenceCount, 0),
    behaviorSummary: stringValue(source.behavior_summary ?? source.behaviorSummary),
  }
}

function mapCharacterRecord(value: unknown): CharacterSummary {
  const envelope = asRecord(value)
  const source = asRecord(envelope.character ?? envelope.identity ?? envelope.result ?? value)
  const mapPackage = (raw: unknown, kind: CharacterRevisionKind, revisionList: unknown): CharacterSummary['visualIdentityPackage'] => {
    const packageSource = asRecord(raw)
    const candidates = arrayValue(packageSource.candidate_revisions ?? packageSource.candidateRevisions ?? revisionList).map((item) => mapCharacterRevisionRecord(item, kind))
    const approvedRaw = packageSource.approved_revision ?? packageSource.approvedRevision
    return raw || candidates.length > 0 ? {
      id: stringValue(packageSource.id ?? packageSource.package_id ?? packageSource.packageId),
      approvedRevision: approvedRaw ? mapCharacterRevisionRecord(approvedRaw, kind) : null,
      candidateRevisions: candidates,
    } : null
  }
  return {
    id: stringValue(source.id ?? source.character_id ?? source.characterId) ?? `character-${crypto.randomUUID()}`,
    projectId: stringValue(source.project_id ?? source.projectId),
    stableCode: stringValue(source.stable_code ?? source.stableCode ?? source.code),
    displayName: stringValue(source.display_name ?? source.displayName ?? source.name) ?? 'Character',
    lifecycleState: stringValue(source.lifecycle_state ?? source.lifecycleState ?? source.state) ?? 'ACTIVE',
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
    visualIdentityPackage: mapPackage(source.visual_identity_package ?? source.visualIdentityPackage, 'visual', source.visual_revisions ?? source.visualIdentityRevisions),
    voiceIdentityPackage: mapPackage(source.voice_identity_package ?? source.voiceIdentityPackage, 'voice', source.voice_revisions ?? source.voiceIdentityRevisions),
    performanceBible: mapPackage(source.performance_bible_package ?? source.performanceBiblePackage ?? source.performance_bible ?? source.performanceBible, 'performance', source.performance_bible_revisions ?? source.performanceBibleRevisions),
    // These domains are outside the bounded canon adapter. Keep arbitrary
    // nested connector/provider data from being rendered before their own
    // allowlists are defined.
    costumeState: null,
    propState: null,
    continuityState: null,
    rights: null,
    usage: null,
    needsYou: arrayValue(source.needs_you ?? source.needsYou),
  }
}

function mapCharacterWorkspaceRecord(value: unknown): CharacterWorkspace {
  const envelope = asRecord(value)
  const source = asRecord(envelope.character ?? envelope.identity ?? envelope.result ?? value)
  const merged = {
    ...envelope,
    ...source,
    visual_revisions: envelope.visual_revisions ?? envelope.visualIdentityRevisions,
    voice_revisions: envelope.voice_revisions ?? envelope.voiceIdentityRevisions,
    performance_bible_revisions: envelope.performance_bible_revisions ?? envelope.performanceBibleRevisions,
  }
  return {
    character: mapCharacterRecord(merged),
    generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0),
    // Keep this adapter boundary closed until a dedicated allowlist exists
    // for workspace-level usage and rights projections. Character package
    // rights are mapped explicitly per revision above; arbitrary top-level
    // connector/provider objects must not reach the desktop model.
    usage: null,
    rights: null,
    needsYou: arrayValue(envelope.needs_you ?? envelope.needsYou),
  }
}

function safeRationalRecord(value: unknown, fallback: { num: number | string; den: number | string } = { num: 0, den: 1 }): { num: number | string; den: number | string } {
  const source = asRecord(value)
  const num = source.num ?? source.numerator
  const den = source.den ?? source.denominator
  const valid = (item: unknown) => (typeof item === 'number' && Number.isSafeInteger(item)) || (typeof item === 'string' && /^-?[0-9]+$/.test(item))
  return valid(num) && valid(den) && String(den) !== '0' ? { num: num as number | string, den: den as number | string } : fallback
}

function mapMediaProfileRevisionRecord(value: unknown): MediaProfileRevision {
  const source = asRecord(value)
  const timelineRate = safeRationalRecord(source.timeline_rate ?? source.timelineRate ?? { num: source.timeline_rate_num ?? source.timelineRateNum, den: source.timeline_rate_den ?? source.timelineRateDen })
  const timeBase = safeRationalRecord(source.time_base ?? source.timeBase ?? { num: source.time_base_num ?? source.timeBaseNum, den: source.time_base_den ?? source.timeBaseDen })
  const pixelAspect = safeRationalRecord(source.pixel_aspect ?? source.pixelAspect ?? { num: source.pixel_aspect_num ?? source.pixelAspectNum, den: source.pixel_aspect_den ?? source.pixelAspectDen })
  return {
    id: stringValue(source.id ?? source.revision_id ?? source.revisionId),
    profileId: stringValue(source.profile_id ?? source.profileId),
    projectId: stringValue(source.project_id ?? source.projectId),
    revisionNumber: numberValue(source.revision_number ?? source.revisionNumber, 0) || undefined,
    state: stringValue(source.state ?? source.lifecycle_state ?? source.lifecycleState) ?? 'DRAFT',
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    timelineRate,
    timeBase,
    dropFramePolicy: stringValue(source.drop_frame_policy ?? source.dropFramePolicy) ?? 'UNKNOWN',
    width: numberValue(source.width, 0),
    height: numberValue(source.height, 0),
    pixelAspect,
    workingColorSpace: stringValue(source.working_color_space ?? source.workingColorSpace) ?? 'UNKNOWN',
    transferFunction: stringValue(source.transfer_function ?? source.transferFunction) ?? 'UNKNOWN',
    hdrPolicy: stringValue(source.hdr_policy ?? source.hdrPolicy) ?? 'UNKNOWN',
    audioSampleRate: numberValue(source.audio_sample_rate ?? source.audioSampleRate, 0),
    audioChannelLayout: stringValue(source.audio_channel_layout ?? source.audioChannelLayout) ?? 'UNKNOWN',
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapMediaProfileWorkspaceRecord(value: unknown): MediaProfileWorkspace {
  const envelope = asRecord(value)
  const profileSource = asRecord(envelope.profile ?? envelope.media_profile ?? envelope.mediaProfile ?? envelope)
  const revisions = arrayValue(profileSource.revisions ?? envelope.revisions).map(mapMediaProfileRevisionRecord)
  const approved = envelope.approved_revision ?? envelope.approvedRevision ?? profileSource.approved_revision ?? profileSource.approvedRevision
  const candidates = envelope.candidate_revisions ?? envelope.candidateRevisions ?? profileSource.candidate_revisions ?? profileSource.candidateRevisions
  return {
    profile: {
      id: stringValue(profileSource.id ?? profileSource.profile_id ?? profileSource.profileId),
      projectId: stringValue(profileSource.project_id ?? profileSource.projectId ?? envelope.project_id ?? envelope.projectId),
    },
    revisions,
    approvedRevision: approved ? mapMediaProfileRevisionRecord(approved) : revisions.find((revision) => revision.state === 'APPROVED') ?? null,
    candidateRevisions: Array.isArray(candidates) ? candidates.map(mapMediaProfileRevisionRecord) : revisions.filter((revision) => ['DRAFT', 'CANDIDATE'].includes(revision.state)),
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0),
    generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
  }
}

function mapTimelineMarkerRecord(value: unknown): TimelineMarker {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.marker_id ?? source.markerId),
    time: safeRationalRecord(source.time ?? source.position ?? { num: source.time_num ?? source.timeNum, den: source.time_den ?? source.timeDen }),
    markerType: stringValue(source.marker_type ?? source.markerType ?? source.type) ?? 'NOTE',
    label: stringValue(source.label ?? source.name) ?? '',
  }
}

function mapTimelineClipRecord(value: unknown): TimelineClip {
  const source = asRecord(value)
  const rational = (nested: string, prefix: string, fallback: { num: number | string; den: number | string } = { num: 0, den: 1 }) => {
    const nestedValue = source[nested]
    const flatValue = { num: source[`${prefix}_num`], den: source[`${prefix}_den`] }
    if (nestedValue === undefined && flatValue.num === undefined && flatValue.den === undefined) return null
    return safeRationalRecord(nestedValue ?? flatValue, fallback)
  }
  return {
    id: stringValue(source.id ?? source.clip_id ?? source.clipId),
    assetRevisionId: stringValue(source.asset_revision_id ?? source.assetRevisionId),
    timelineIn: rational('timeline_in', 'timeline_in') ?? { num: 0, den: 1 },
    timelineOut: rational('timeline_out', 'timeline_out') ?? { num: 0, den: 1 },
    sourceIn: source.source_in === null || source.sourceIn === null ? null : rational('source_in', 'source_in'),
    sourceOut: source.source_out === null || source.sourceOut === null ? null : rational('source_out', 'source_out'),
    speed: rational('speed', 'speed', { num: 1, den: 1 }) ?? { num: 1, den: 1 },
    label: stringValue(source.label ?? source.name ?? source.display_name ?? source.displayName),
  }
}

function mapTimelineTrackRecord(value: unknown): TimelineTrack {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.track_id ?? source.trackId),
    trackType: stringValue(source.track_type ?? source.trackType ?? source.type) ?? 'VIDEO',
    orderIndex: numberValue(source.order_index ?? source.orderIndex, 0),
    name: stringValue(source.name) ?? 'Track',
    enabled: source.enabled !== false,
    clips: arrayValue(source.clips ?? source.clip_instances ?? source.clipInstances).map(mapTimelineClipRecord),
  }
}

function mapTimelineRevisionRecord(value: unknown): TimelineRevision {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.timeline_revision_id ?? source.timelineRevisionId),
    timelineId: stringValue(source.timeline_id ?? source.timelineId),
    mediaProfileRevisionId: stringValue(source.media_profile_revision_id ?? source.mediaProfileRevisionId),
    revisionNumber: numberValue(source.revision_number ?? source.revisionNumber, 0) || undefined,
    state: stringValue(source.state ?? source.lifecycle_state ?? source.lifecycleState) ?? 'DRAFT_CHECKPOINT',
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    duration: safeRationalRecord(source.duration ?? { num: source.duration_num ?? source.durationNum, den: source.duration_den ?? source.durationDen }),
    editHash: stringValue(source.edit_hash ?? source.editHash ?? source.content_hash ?? source.contentHash),
    tracks: arrayValue(source.tracks ?? source.timeline_tracks ?? source.timelineTracks).map(mapTimelineTrackRecord),
    markers: arrayValue(source.markers ?? source.timeline_markers ?? source.timelineMarkers).map(mapTimelineMarkerRecord),
    readinessState: stringValue(source.readiness_state ?? source.readinessState) ?? 'UNKNOWN',
    nextStep: stringValue(source.next_step ?? source.nextStep),
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapTimelineSummaryRecord(value: unknown): TimelineSummary {
  const envelope = asRecord(value)
  const source = asRecord(envelope.timeline ?? envelope.result ?? value)
  return {
    id: stringValue(source.id ?? source.timeline_id ?? source.timelineId),
    projectId: stringValue(source.project_id ?? source.projectId),
    scopeType: stringValue(source.scope_type ?? source.scopeType) ?? 'PROJECT',
    scopeId: stringValue(source.scope_id ?? source.scopeId),
    code: stringValue(source.code ?? source.stable_code ?? source.stableCode),
    title: stringValue(source.title ?? source.name) ?? 'Timeline',
    state: stringValue(source.state ?? source.lifecycle_state ?? source.lifecycleState) ?? 'ACTIVE',
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapTimelineWorkspaceRecord(value: unknown): TimelineWorkspace {
  const envelope = asRecord(value)
  const timelineSource = asRecord(envelope.timeline ?? envelope)
  const revisionValues = envelope.revisions ?? envelope.timeline_revisions ?? envelope.timelineRevisions
  const revisions = arrayValue(revisionValues).map(mapTimelineRevisionRecord)
  const singleRevision = envelope.revision ?? envelope.timeline_revision
  const current = envelope.current_revision ?? envelope.currentRevision ?? envelope.approved_revision ?? envelope.approvedRevision ?? singleRevision
  const mappedCurrent = current ? mapTimelineRevisionRecord(current) : null
  const allRevisions = mappedCurrent && !revisions.some((revision) => revision.id && revision.id === mappedCurrent.id)
    ? [mappedCurrent, ...revisions]
    : revisions
  const mediaProfileRevision = envelope.media_profile_revision ?? envelope.mediaProfileRevision
  const profileRevision = asRecord(mediaProfileRevision)
  const mediaProfileValue = envelope.media_profile ?? envelope.mediaProfile
    ?? (mediaProfileRevision ? { profile: { id: profileRevision.profile_id ?? profileRevision.profileId, project_id: profileRevision.project_id ?? profileRevision.projectId }, revisions: [mediaProfileRevision] } : null)
  return {
    timeline: mapTimelineSummaryRecord(timelineSource),
    mediaProfile: mediaProfileValue ? mapMediaProfileWorkspaceRecord(mediaProfileValue) : null,
    revisions: allRevisions,
    currentRevision: mappedCurrent ?? allRevisions.find((revision) => revision.state === 'APPROVED') ?? allRevisions[0] ?? null,
    needsYou: arrayValue(envelope.needs_you ?? envelope.needsYou),
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0),
    generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
  }
}

function mapHumanReviewRecord(value: unknown) {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.human_review_id ?? source.humanReviewId),
    reviewSessionId: stringValue(source.review_session_id ?? source.reviewSessionId),
    decision: stringValue(source.decision) ?? 'ABSTAIN',
    notes: stringValue(source.notes) ?? '',
    reasonCodes: arrayValue(source.reason_codes ?? source.reasonCodes).filter((item): item is string => typeof item === 'string'),
    dependencySnapshotHash: stringValue(source.dependency_snapshot_hash ?? source.dependencySnapshotHash),
    subjectContentHash: stringValue(source.subject_content_hash ?? source.subjectContentHash),
    reviewerActorId: stringValue(source.reviewer_actor_id ?? source.reviewerActorId),
    reviewedAt: stringValue(source.reviewed_at ?? source.reviewedAt),
  }
}

function mapReviewSessionRecord(value: unknown): ReviewSession {
  const envelope = asRecord(value)
  const source = asRecord(envelope.review ?? envelope.session ?? envelope.review_session ?? envelope.result ?? value)
  const rawState = stringValue(source.review_state ?? source.reviewState ?? source.state) ?? 'UNKNOWN'
  return {
    id: stringValue(source.id ?? source.review_session_id ?? source.reviewSessionId),
    projectId: stringValue(source.project_id ?? source.projectId),
    subjectType: stringValue(source.subject_type ?? source.subjectType) ?? 'TIMELINE_REVISION',
    subjectId: stringValue(source.subject_id ?? source.subjectId),
    subjectRevisionId: stringValue(source.subject_revision_id ?? source.subjectRevisionId),
    representationAssetRevisionId: stringValue(source.representation_asset_revision_id ?? source.representationAssetRevisionId),
    dependencySnapshotHash: stringValue(source.dependency_snapshot_hash ?? source.dependencySnapshotHash),
    subjectContentHash: stringValue(source.subject_content_hash ?? source.subjectContentHash),
    mediaProfileRevisionId: stringValue(source.media_profile_revision_id ?? source.mediaProfileRevisionId),
    state: rawState,
    stale: Boolean(source.stale) || rawState === 'STALE',
    reviewerActorId: stringValue(source.reviewer_actor_id ?? source.reviewerActorId),
    openedAt: stringValue(source.opened_at ?? source.openedAt),
    submittedAt: stringValue(source.submitted_at ?? source.submittedAt),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    nextStep: stringValue(source.next_step ?? source.nextStep),
    humanReview: source.human_review || source.humanReview ? mapHumanReviewRecord(source.human_review ?? source.humanReview) : null,
  }
}

function mapReviewWorkspaceRecord(value: unknown): ReviewWorkspace {
  const envelope = asRecord(value)
  const timeline = envelope.timeline ? mapTimelineSummaryRecord(envelope.timeline) : null
  const subject = envelope.subject ? mapTimelineRevisionRecord(envelope.subject) : null
  const profile = envelope.media_profile_revision ?? envelope.mediaProfileRevision
  return {
    review: envelope.review ? mapReviewSessionRecord(envelope.review) : envelope.session ? mapReviewSessionRecord(envelope.session) : null,
    subject,
    timeline,
    mediaProfileRevision: profile ? mapMediaProfileRevisionRecord(profile) : null,
    snapshot: envelope.snapshot && typeof envelope.snapshot === 'object' && !Array.isArray(envelope.snapshot)
      ? {
          hash: stringValue(asRecord(envelope.snapshot).hash),
          currentHash: stringValue(asRecord(envelope.snapshot).current_hash ?? asRecord(envelope.snapshot).currentHash),
          stale: Boolean(asRecord(envelope.snapshot).stale),
        }
      : null,
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0),
    generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
  }
}

function mapHandoffCompatibilityRecord(value: unknown) {
  const source = asRecord(value)
  return {
    profileVersion: stringValue(source.profile_version ?? source.profileVersion),
    targetEditor: stringValue(source.target_editor ?? source.targetEditor),
    targetVersion: stringValue(source.target_version ?? source.targetVersion),
    editableClaim: source.editable_claim === true || source.editableClaim === true,
    entries: arrayValue(source.entries).map((entry) => {
      const item = asRecord(entry)
      const status = stringValue(item.status) ?? 'UNKNOWN'
      return { feature: stringValue(item.feature) ?? 'unknown', status: status as 'NATIVE' | 'APPROXIMATED' | 'UNSUPPORTED' | 'UNKNOWN', detail: stringValue(item.detail) ?? '' }
    }),
    counts: asRecord(source.counts) as Record<string, number>,
    nextStep: stringValue(source.next_step ?? source.nextStep),
  }
}

function mapHandoffSanitizationRecord(value: unknown) {
  const source = asRecord(value)
  return {
    policy: stringValue(source.policy),
    recorded: source.recorded === true,
    removedFields: arrayValue(source.removed_fields ?? source.removedFields).filter((item): item is string => typeof item === 'string'),
    nextStep: stringValue(source.next_step ?? source.nextStep),
  }
}

function mapHandoffManifestRecord(value: unknown) {
  const envelope = asRecord(value)
  const source = asRecord(envelope.handoff_manifest ?? envelope.handoffManifest ?? envelope.manifest ?? value)
  const manifestDocument = asRecord(source.manifest)
  const manifestTarget = asRecord(manifestDocument.target)
  const compatibility = source.compatibility_report ?? source.compatibilityReport ?? source.compatibility
  const sanitization = source.sanitization_report ?? source.sanitizationReport ?? source.sanitization
  return {
    id: stringValue(source.id ?? source.handoff_manifest_id ?? source.handoffManifestId),
    exportSessionId: stringValue(source.export_session_id ?? source.exportSessionId),
    projectId: stringValue(source.project_id ?? source.projectId),
    targetEditor: stringValue(source.target_editor ?? source.targetEditor) ?? stringValue(manifestTarget.editor),
    targetVersion: stringValue(source.target_version ?? source.targetVersion) ?? stringValue(manifestTarget.version),
    compatibilityProfileVersion: stringValue(source.compatibility_profile_version ?? source.compatibilityProfileVersion),
    manifestHash: stringValue(source.manifest_hash ?? source.manifestHash),
    manifest: manifestDocument,
    artifactAllowlist: arrayValue(source.artifact_allowlist ?? source.artifactAllowlist).map((artifact) => {
      const item = asRecord(artifact)
      return {
        assetRevisionId: stringValue(item.asset_revision_id ?? item.assetRevisionId),
        assetId: stringValue(item.asset_id ?? item.assetId),
        semanticRole: stringValue(item.semantic_role ?? item.semanticRole),
        rebuildability: stringValue(item.rebuildability),
        hashAlgorithm: stringValue(item.hash_algorithm ?? item.hashAlgorithm),
        contentHash: stringValue(item.content_hash ?? item.contentHash),
        byteSize: numberValue(item.byte_size ?? item.byteSize, 0),
        availabilityState: stringValue(item.availability_state ?? item.availabilityState),
        reviewState: stringValue(item.review_state ?? item.reviewState),
        availabilityEvidenceState: stringValue(item.availability_evidence_state ?? item.availabilityEvidenceState),
      }
    }),
    compatibility: mapHandoffCompatibilityRecord(compatibility),
    sanitizationReport: mapHandoffSanitizationRecord(sanitization),
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapHandoffSessionRecord(value: unknown) {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.export_session_id ?? source.exportSessionId),
    projectId: stringValue(source.project_id ?? source.projectId),
    timelineRevisionId: stringValue(source.timeline_revision_id ?? source.timelineRevisionId),
    deliverableType: stringValue(source.deliverable_type ?? source.deliverableType) ?? 'TIMELINE_INTERCHANGE',
    targetProfile: stringValue(source.target_profile ?? source.targetProfile),
    targetEditor: stringValue(source.target_editor ?? source.targetEditor),
    targetVersion: stringValue(source.target_version ?? source.targetVersion),
    state: stringValue(source.state) ?? 'UNKNOWN',
    outputManifestId: stringValue(source.output_manifest_id ?? source.outputManifestId),
    commandId: stringValue(source.command_id ?? source.commandId),
    reviewSessionId: stringValue(source.review_session_id ?? source.reviewSessionId),
    dependencySnapshotHash: stringValue(source.dependency_snapshot_hash ?? source.dependencySnapshotHash),
    subjectContentHash: stringValue(source.subject_content_hash ?? source.subjectContentHash),
    mediaProfileRevisionId: stringValue(source.media_profile_revision_id ?? source.mediaProfileRevisionId),
    nextStep: stringValue(source.next_step ?? source.nextStep),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapHandoffWorkspaceRecord(value: unknown): HandoffWorkspace {
  const envelope = asRecord(value)
  const sessionSource = envelope.export_session ?? envelope.exportSession ?? envelope.session
  const manifestSource = envelope.handoff_manifest ?? envelope.handoffManifest ?? envelope.manifest
  const manifest = manifestSource ? mapHandoffManifestRecord(manifestSource) : null
  const compatibility = envelope.compatibility_report ?? envelope.compatibilityReport ?? manifest?.compatibility
  return {
    exportSession: sessionSource ? mapHandoffSessionRecord(sessionSource) : null,
    handoffManifest: manifest,
    manifestHash: stringValue(envelope.manifest_hash ?? envelope.manifestHash) ?? manifest?.manifestHash,
    compatibilityReport: mapHandoffCompatibilityRecord(compatibility),
    sanitizationReport: manifest?.sanitizationReport,
    nextStep: stringValue(envelope.next_step ?? envelope.nextStep) ?? (sessionSource ? stringValue(asRecord(sessionSource).next_step ?? asRecord(sessionSource).nextStep) : undefined),
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0),
    generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
  }
}

function mapHandoffListItemRecord(value: unknown): HandoffListItem {
  const source = asRecord(value)
  return {
    exportSession: mapHandoffSessionRecord(source.export_session ?? source.exportSession ?? source.session),
    handoffManifest: mapHandoffManifestRecord(source.handoff_manifest ?? source.handoffManifest ?? source.manifest),
  }
}

/** Injectable factory for Tauri, browser, and deterministic tests. */
export function createCoreClient(bridge?: CoreBridge): CoreClient {
  if (bridge) return bridge
  return new HttpCoreClient()
}
