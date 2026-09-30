import type { ActivityItem, AssetSummary, AudioCueRevision, AudioCueRevisionInput, AudioCueSummary, AudioCueTiming, BackupCommandResult, BackupRestoreCheck, BackupRestoreEstimate, BackupRestoreWorkspace, BackupSummary, BackupVerification, BackupWorkspace, CharacterRevision, CharacterRevisionInput, CharacterRevisionKind, CharacterSummary, CharacterWorkspace, CoreClient, DashboardSnapshot, DecisionRequest, ExternalEdit, ExternalEditLineageConfidence, ExternalEditList, ExternalEditRegistrationInput, HandoffListItem, HandoffWorkspace, HumanReviewDecision, ImportAssetInput, ManagedAssetIntegrityJob, ManagedJobList, ManagedJobRetryPlan, MediaPreviewResolution, MediaProfileInput, MediaProfileRevision, MediaProfileWorkspace, NoteSummary, ProductionItem, ProjectSummary, ProjectWorkspace, RecoveryCheck, RecoveryStatus, ReleaseBuildPlan, ReleaseBuildPlanList, ReleaseCandidate, ReleaseCandidateList, ReleaseGate, ReleaseReadiness, ReviewSession, ReviewWorkspace, RightsState, RightsSummary, ShotLifecycleState, ShotSummary, StagedAsset, StagingEvidence, StagingWorkspace, StorageAdmission, StorageScrubHealth, SubtitleSegment, SubtitleTiming, SubtitleTrackRevision, SubtitleTrackRevisionInput, SubtitleTrackSummary, TaskStatus, TaskSummary, TimelineClip, TimelineInput, TimelineInterchangeDownload, TimelineMarker, TimelineRevision, TimelineSnapshotInput, TimelineSummary, TimelineTrack, TimelineTimingImpact, TimelineTimingLifecycleState, TimelineWorkspace, TimelineWorkingHistory, TimelineWorkingWorkspace, TimingDependencyInput, WorkspaceNoteEntityType, WorkState } from './types'

// Keep the bounded local adapter available for development and tests without
// shipping its demo project data in a production bundle. Vite replaces
// import.meta.env.PROD at build time, so the dynamic import is removed from a
// release build. The production client uses a loopback sentinel instead and
// therefore never calls the local path.
const localMockSnapshot: DashboardSnapshot | null = import.meta.env.PROD
  ? null
  : (await import('./data/mockSnapshot')).mockSnapshot

declare global {
  interface Window {
    /** Optional runtime override injected by the desktop bootstrapper. */
    __CINEFORGE_CORE_BASE_URL__?: string
  }
}

export interface CoreBridge {
  getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot>
  acknowledgeDecision(id: string, idempotencyKey?: string): Promise<void>
  resolveDecision?(id: string, choiceId: string, expectedVersion: number, idempotencyKey?: string): Promise<DecisionRequest>
  dismissDecision?(id: string, expectedVersion: number, idempotencyKey?: string): Promise<DecisionRequest>
  createProject(name: string, idempotencyKey?: string): Promise<ProjectSummary>
  addProductionItem(projectId: string, title: string, idempotencyKey?: string): Promise<ProductionItem>
  createTask?(projectId: string, title: string, options?: { description?: string; priority?: number; idempotencyKey?: string }): Promise<TaskSummary>
  updateTask?(taskId: string, patch: { title?: string; description?: string; priority?: number; status?: TaskStatus }, expectedVersion: number, idempotencyKey?: string): Promise<TaskSummary>
  createShot?(projectId: string, code: string, title: string, idempotencyKey?: string): Promise<ShotSummary>
  updateShot?(shotId: string, patch: { title?: string; lifecycleState?: ShotLifecycleState }, expectedVersion: number, idempotencyKey?: string): Promise<ShotSummary>
  addNote?(projectId: string, target: { entityType: WorkspaceNoteEntityType; entityId: string }, body: string, idempotencyKey?: string): Promise<NoteSummary>
  getProjectWorkspace?(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspace>
  getProjectActivity?(projectId: string, signal?: AbortSignal): Promise<ActivityItem[]>
  getAssets?(projectId?: string, signal?: AbortSignal): Promise<AssetSummary[]>
  getBackups?(signal?: AbortSignal): Promise<BackupSummary[]>
  getBackup?(backupId: string, signal?: AbortSignal): Promise<BackupWorkspace>
  getBackupRestoreEstimate?(backupId: string, signal?: AbortSignal): Promise<BackupRestoreWorkspace>
  getRecoveryStatus?(signal?: AbortSignal): Promise<RecoveryStatus>
  getStorageAdmission?(signal?: AbortSignal): Promise<StorageAdmission | null>
  createBackup?(input?: { durabilityClass?: string }, idempotencyKey?: string): Promise<BackupCommandResult>
  verifyBackup?(backupId: string, idempotencyKey?: string): Promise<BackupCommandResult>
  getJobs?(projectId?: string, state?: string, limit?: number, signal?: AbortSignal): Promise<ManagedJobList>
  getJob?(jobId: string, projectId?: string, signal?: AbortSignal): Promise<ManagedAssetIntegrityJob>
  getJobRetryPlan?(jobId: string, projectId?: string, signal?: AbortSignal): Promise<ManagedJobRetryPlan>
  runManagedAssetIntegrityProbe?(projectId: string, assetRevisionId: string, contentHash: string, maxBytes?: number, idempotencyKey?: string): Promise<ManagedAssetIntegrityJob>
  cancelManagedAssetIntegrityProbe?(jobId: string, expectedVersion: number, idempotencyKey?: string): Promise<ManagedAssetIntegrityJob>
  retryManagedAssetIntegrityProbe?(jobId: string, expectedVersion: number, idempotencyKey?: string): Promise<ManagedAssetIntegrityJob>
  getStaging?(state?: string, limit?: number, signal?: AbortSignal): Promise<StagingWorkspace>
  reconcileStaging?(stagingId?: string, idempotencyKey?: string): Promise<StagingWorkspace>
  getReleaseReadiness?(projectId: string, signal?: AbortSignal): Promise<ReleaseReadiness>
  getReleaseCandidates?(projectId: string, signal?: AbortSignal): Promise<ReleaseCandidateList>
  getReleaseCandidate?(projectId: string, candidateId: string, signal?: AbortSignal): Promise<ReleaseCandidate>
  createReleaseCandidateDraft?(projectId: string, idempotencyKey?: string): Promise<ReleaseCandidate>
  cancelReleaseCandidateDraft?(projectId: string, candidateId: string, expectedVersion: number, idempotencyKey?: string): Promise<ReleaseCandidate>
  getReleaseBuildPlans?(projectId: string, signal?: AbortSignal): Promise<ReleaseBuildPlanList>
  getReleaseBuildPlan?(projectId: string, planId: string, signal?: AbortSignal): Promise<ReleaseBuildPlan>
  createReleaseBuildPlan?(projectId: string, input: { releaseCandidateId: string; expectedVersion: number }, idempotencyKey?: string): Promise<ReleaseBuildPlan>
  resolveMediaPreview?(projectId: string, revisionId: string, purpose?: string, signal?: AbortSignal): Promise<MediaPreviewResolution>
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
  getTimelineWorkingSession?(projectId: string, timelineId: string, sessionId: string, signal?: AbortSignal): Promise<TimelineWorkingWorkspace>
  getTimelineWorkingHistory?(projectId: string, timelineId: string, sessionId: string, afterOpSeq?: number, limit?: number, signal?: AbortSignal): Promise<TimelineWorkingHistory>
  getTimelineAudioTiming?(projectId: string, timelineId: string, timelineRevisionId: string, signal?: AbortSignal): Promise<AudioCueTiming>
  getTimelineSubtitleTiming?(projectId: string, timelineId: string, timelineRevisionId: string, signal?: AbortSignal): Promise<SubtitleTiming>
  getTimelineTimingImpact?(projectId: string, timelineId: string, timelineRevisionId: string, signal?: AbortSignal): Promise<TimelineTimingImpact>
  createAudioCueRevision?(projectId: string, timelineId: string, input: AudioCueRevisionInput, idempotencyKey?: string): Promise<{ audioCue: AudioCueSummary | null; revision: AudioCueRevision | null }>
  transitionAudioCueRevision?(projectId: string, timelineId: string, audioCueId: string, revisionId: string, nextState: TimelineTimingLifecycleState, expectedVersion: number, timing: TimingDependencyInput, idempotencyKey?: string): Promise<{ audioCue: AudioCueSummary | null; revision: AudioCueRevision | null }>
  createSubtitleTrackRevision?(projectId: string, timelineId: string, input: SubtitleTrackRevisionInput, idempotencyKey?: string): Promise<{ subtitleTrack: SubtitleTrackSummary | null; revision: SubtitleTrackRevision | null }>
  transitionSubtitleTrackRevision?(projectId: string, timelineId: string, subtitleTrackId: string, revisionId: string, nextState: TimelineTimingLifecycleState, expectedVersion: number, timing: TimingDependencyInput, idempotencyKey?: string): Promise<{ subtitleTrack: SubtitleTrackSummary | null; revision: SubtitleTrackRevision | null }>
  beginTimelineWorkingSession?(projectId: string, timelineId: string, input: { baseRevisionId: string; baseRevisionRowVersion: number; baseContentHash: string; clientInstanceId: string; expectedTimelineVersion: number }, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  applyTimelineEditOps?(projectId: string, timelineId: string, sessionId: string, operations: Array<Record<string, unknown>>, expectedSessionVersion: number, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  undoTimelineEditOp?(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  redoTimelineEditOp?(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  autosaveTimelineWorkingSession?(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  checkpointTimelineWorkingSession?(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, expectedTimelineVersion: number, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  closeTimelineWorkingSession?(projectId: string, timelineId: string, sessionId: string, disposition: 'SAVE' | 'ABANDON', expectedSessionVersion: number, idempotencyKey?: string): Promise<TimelineWorkingWorkspace>
  createTimeline?(projectId: string, input: TimelineInput, idempotencyKey?: string): Promise<TimelineSummary>
  createTimelineRevision?(projectId: string, timelineId: string, input: TimelineSnapshotInput, expectedVersion: number, idempotencyKey?: string): Promise<TimelineWorkspace>
  transitionTimelineRevision?(projectId: string, timelineId: string, revisionId: string, nextState: string, expectedVersion: number, idempotencyKey?: string, reviewSessionId?: string, dependencySnapshotHash?: string): Promise<TimelineWorkspace>
  getReviews?(projectId: string, state?: string, signal?: AbortSignal): Promise<ReviewSession[]>
  getReview?(projectId: string, reviewSessionId: string, signal?: AbortSignal): Promise<ReviewWorkspace>
  openReview?(projectId: string, subjectRevisionId: string, expectedVersion: number, idempotencyKey?: string): Promise<ReviewWorkspace>
  submitReview?(projectId: string, reviewSessionId: string, decision: HumanReviewDecision, expectedVersion: number, notes?: string, reasonCodes?: string[], idempotencyKey?: string): Promise<ReviewWorkspace>
  getHandoffs?(projectId: string, state?: string, signal?: AbortSignal): Promise<HandoffListItem[]>
  getHandoff?(projectId: string, handoffId: string, signal?: AbortSignal): Promise<HandoffWorkspace>
  getExternalEdits?(projectId: string, state?: string, signal?: AbortSignal): Promise<ExternalEditList>
  getExternalEdit?(projectId: string, externalEditId: string, signal?: AbortSignal): Promise<ExternalEdit>
  registerExternalEdit?(projectId: string, input: ExternalEditRegistrationInput, idempotencyKey?: string): Promise<ExternalEdit>
  createHandoffManifest?(projectId: string, input: { timelineRevisionId: string; reviewSessionId: string; dependencySnapshotHash: string; targetEditor: string; targetVersion: string; targetProfile?: string; expectedVersion: number }, idempotencyKey?: string): Promise<HandoffWorkspace>
  buildTimelineInterchangeExport?(projectId: string, exportSessionId: string, dependencySnapshotHash: string, expectedVersion: number, idempotencyKey?: string): Promise<HandoffWorkspace>
  resolveTimelineInterchangeDownload?(projectId: string, exportSessionId: string, signal?: AbortSignal): Promise<TimelineInterchangeDownload>
}

const LOCAL_SNAPSHOT_KEY = 'cineforge-dashboard-v1'
const LOCAL_WORKSPACE_KEY = 'cineforge-workspaces-v1'
const LOCAL_IDEMPOTENCY_KEY = 'cineforge-idempotency-v1'
// The local snapshot/workspace adapter is intentionally available to Vite's
// development and test modes only.  A production bundle must never silently
// present or mutate demo data when the Core endpoint is missing.  Keeping a
// loopback-only sentinel as the effective URL makes every existing HTTP path
// fail closed without duplicating a production guard across dozens of
// capability methods; it also avoids an accidental cloud/network fallback.
const PRODUCTION_MISSING_CORE_BASE_URL = 'http://127.0.0.1:1'

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
    if (!localMockSnapshot) throw new CoreClientError('Local demo data is unavailable in a production build.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', needsUser: true })
    const snapshot = structuredClone(localMockSnapshot)
    snapshot.decisions = snapshot.decisions.map(mapDecisionRecord)
    return snapshot
  }
  try {
    const snapshot = JSON.parse(stored) as DashboardSnapshot
    snapshot.decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions.map(mapDecisionRecord) : []
    return snapshot
  } catch {
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY)
    if (!localMockSnapshot) throw new CoreClientError('Local demo data is unavailable in a production build.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', needsUser: true })
    const snapshot = structuredClone(localMockSnapshot)
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
 * the UI. A bounded local snapshot is available only to development/test
 * builds; production builds fail closed if the packaged Core endpoint is not
 * configured, so a release can never look healthy while mutating demo data.
 */
export class HttpCoreClient implements CoreClient {
  private readonly timelineWorkingClientInstances = new Map<string, string>()
  private readonly previewSessionId = globalThis.crypto?.randomUUID?.() ?? `preview-${Math.random().toString(36).slice(2)}-${Date.now()}`

  private readonly baseUrl: string

  constructor(configuredBaseUrl = import.meta.env.VITE_CORE_BASE_URL ?? globalThis.window?.__CINEFORGE_CORE_BASE_URL__ ?? '') {
    const normalized = typeof configuredBaseUrl === 'string' ? configuredBaseUrl.trim() : ''
    // Vite's test mode is deliberately non-production, so existing adapter
    // tests continue to exercise the bounded local path.  `PROD` is static at
    // build time and therefore cannot be changed by a page query parameter or
    // localStorage value in the shipped bundle.
    this.baseUrl = normalized || (import.meta.env.PROD ? PRODUCTION_MISSING_CORE_BASE_URL : '')
  }

  isLive(): boolean {
    return this.baseUrl.length > 0 && this.baseUrl !== PRODUCTION_MISSING_CORE_BASE_URL
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

  async acknowledgeDecision(id: string, idempotencyKey = crypto.randomUUID()): Promise<void> {
    if (!this.baseUrl) {
      const snapshot = localSnapshot()
      snapshot.decisions = snapshot.decisions.filter((decision) => decision.id !== id)
      saveLocalSnapshot(snapshot)
      return
    }
    const response = await fetch(`${this.baseUrl}/v1/decisions/${encodeURIComponent(id)}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ source: 'desktop-ui' }),
    })
    await readCorePayload(response, 'decision acknowledgement')
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

  async createProject(name: string, idempotencyKey = crypto.randomUUID()): Promise<ProjectSummary> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ name }),
      })
      return mapProjectSummary(await readCorePayload(response, 'project creation'))
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

  async addProductionItem(projectId: string, title: string, idempotencyKey = crypto.randomUUID()): Promise<ProductionItem> {
    if (this.baseUrl) {
      const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/production-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ title }),
      })
      return mapProductionItemRecord(await readCorePayload(response, 'production item creation'), 0)
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

  async getBackups(signal?: AbortSignal): Promise<BackupSummary[]> {
    if (!this.baseUrl) return []
    const response = await fetch(`${this.baseUrl}/v1/backups`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'backups'))
    return arrayValue(payload.backups ?? payload.items ?? payload).map(mapBackupSummaryRecord)
  }

  async getBackup(backupId: string, signal?: AbortSignal): Promise<BackupWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Backup details require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!backupId.trim()) throw new CoreClientError('A backup id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/backups/${encodeURIComponent(backupId)}`, { signal, headers: { Accept: 'application/json' } })
    return mapBackupWorkspaceRecord(await readCorePayload(response, 'backup details'))
  }

  async getBackupRestoreEstimate(backupId: string, signal?: AbortSignal): Promise<BackupRestoreWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Restore preflight requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!backupId.trim()) throw new CoreClientError('A backup id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/backups/${encodeURIComponent(backupId)}/restore-estimate`, { signal, headers: { Accept: 'application/json' } })
    return mapBackupRestoreWorkspaceRecord(await readCorePayload(response, 'restore preflight'))
  }

  async getRecoveryStatus(signal?: AbortSignal): Promise<RecoveryStatus> {
    if (!this.baseUrl) throw new CoreClientError('Recovery status requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/recovery/status`, { signal, headers: { Accept: 'application/json' } })
    return mapRecoveryStatusRecord(await readCorePayload(response, 'recovery status'))
  }

  async getStorageAdmission(signal?: AbortSignal): Promise<StorageAdmission | null> {
    if (!this.baseUrl) return null
    const response = await fetch(`${this.baseUrl}/v1/storage/admission`, { signal, headers: { Accept: 'application/json' } })
    return mapStorageAdmissionRecord(await readCorePayload(response, 'storage admission'))
  }

  async getStorageScrubHealth(options: { limit?: number; maxBytes?: number; after?: string } = {}, signal?: AbortSignal): Promise<StorageScrubHealth> {
    if (!this.baseUrl) throw new CoreClientError('Storage integrity evidence requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(integerValue(options.limit, 100, 1, 200)))
    if (options.maxBytes !== undefined) query.set('max_bytes', String(integerValue(options.maxBytes, 256 * 1024 * 1024, 1, 4 * 1024 * 1024 * 1024)))
    const after = options.after?.trim()
    if (after) query.set('after', after)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    const response = await fetch(`${this.baseUrl}/v1/storage/scrub-health${suffix}`, { signal, headers: { Accept: 'application/json' } })
    return mapStorageScrubHealthRecord(await readCorePayload(response, 'storage integrity evidence'))
  }

  async getJobs(projectId?: string, state?: string, limit = 100, signal?: AbortSignal): Promise<ManagedJobList> {
    if (!this.baseUrl) throw new CoreClientError('The integrity job queue requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const query = new URLSearchParams({ limit: String(integerValue(limit, 100, 1, 200)) })
    if (projectId?.trim()) query.set('project_id', projectId.trim())
    if (state?.trim()) query.set('state', state.trim().toUpperCase())
    const response = await fetch(`${this.baseUrl}/v1/jobs?${query.toString()}`, { signal, headers: { Accept: 'application/json' } })
    return mapManagedJobListRecord(await readCorePayload(response, 'jobs'))
  }

  async getJob(jobId: string, projectId?: string, signal?: AbortSignal): Promise<ManagedAssetIntegrityJob> {
    if (!this.baseUrl) throw new CoreClientError('Job details require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!jobId.trim()) throw new CoreClientError('A job id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const suffix = projectId?.trim() ? `?project_id=${encodeURIComponent(projectId.trim())}` : ''
    const response = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}${suffix}`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'job'))
    return mapManagedJobRecord(payload.job ?? payload)
  }

  async getJobRetryPlan(jobId: string, projectId?: string, signal?: AbortSignal): Promise<ManagedJobRetryPlan> {
    if (!this.baseUrl) throw new CoreClientError('Job retry planning requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!jobId.trim()) throw new CoreClientError('A job id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const suffix = projectId?.trim() ? `?project_id=${encodeURIComponent(projectId.trim())}` : ''
    const response = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/retry-plan${suffix}`, { signal, headers: { Accept: 'application/json' } })
    return mapManagedJobRetryPlanRecord(await readCorePayload(response, 'job retry plan'))
  }

  async runManagedAssetIntegrityProbe(projectId: string, assetRevisionId: string, contentHash: string, maxBytes = 256 * 1024 * 1024, idempotencyKey = crypto.randomUUID()): Promise<ManagedAssetIntegrityJob> {
    if (!this.baseUrl) throw new CoreClientError('Asset integrity probing requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !assetRevisionId.trim() || !/^[a-f0-9]{64}$/i.test(contentHash.trim())) throw new CoreClientError('A project, revision and SHA-256 content hash are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const boundedMaxBytes = integerValue(maxBytes, 256 * 1024 * 1024, 1, 4 * 1024 * 1024 * 1024)
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetRevisionId)}/integrity-probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ content_hash: contentHash.trim().toLowerCase(), max_bytes: boundedMaxBytes }),
    })
    const payload = asRecord(await readCorePayload(response, 'asset integrity probe'))
    return mapManagedJobRecord(payload.job ?? asRecord(payload.result).job ?? payload.result ?? payload)
  }

  async cancelManagedAssetIntegrityProbe(jobId: string, expectedVersion: number, idempotencyKey = crypto.randomUUID()): Promise<ManagedAssetIntegrityJob> {
    if (!this.baseUrl) throw new CoreClientError('Cancelling a job requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ expected_version: expectedVersion }),
    })
    const payload = asRecord(await readCorePayload(response, 'job cancellation'))
    return mapManagedJobRecord(payload.job ?? asRecord(payload.result).job ?? payload.result ?? payload)
  }

  async retryManagedAssetIntegrityProbe(jobId: string, expectedVersion: number, idempotencyKey = crypto.randomUUID()): Promise<ManagedAssetIntegrityJob> {
    if (!this.baseUrl) throw new CoreClientError('Retrying a job requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ expected_version: expectedVersion }),
    })
    const payload = asRecord(await readCorePayload(response, 'job retry'))
    return mapManagedJobRecord(payload.job ?? asRecord(payload.result).job ?? payload.result ?? payload)
  }

  async createBackup(input: { durabilityClass?: string } = {}, idempotencyKey: string = crypto.randomUUID()): Promise<BackupCommandResult> {
    if (!this.baseUrl) throw new CoreClientError('Creating a backup requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const durabilityClass = (input.durabilityClass?.trim() || 'LOCAL_WRITABLE').toUpperCase()
    if (durabilityClass !== 'LOCAL_WRITABLE') throw new CoreClientError('Only the local writable backup policy is available.', { code: 'DURABILITY_PROFILE_UNAVAILABLE', category: 'CONFLICT', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ durability_class: durabilityClass }),
    })
    return mapBackupCommandResultRecord(await readCorePayload(response, 'backup creation'))
  }

  async verifyBackup(backupId: string, idempotencyKey: string = crypto.randomUUID()): Promise<BackupCommandResult> {
    if (!this.baseUrl) throw new CoreClientError('Verifying a backup requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!backupId.trim()) throw new CoreClientError('A backup id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/backups/${encodeURIComponent(backupId)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({}),
    })
    return mapBackupCommandResultRecord(await readCorePayload(response, 'backup verification'))
  }

  async getStaging(state?: string, limit = 100, signal?: AbortSignal): Promise<StagingWorkspace> {
    if (!this.baseUrl) return { items: [] }
    const boundedLimit = integerValue(limit, 100, 1, 200)
    const query = new URLSearchParams({ limit: String(boundedLimit) })
    const normalizedState = state?.trim().toUpperCase()
    if (normalizedState) query.set('state', normalizedState)
    const response = await fetch(`${this.baseUrl}/v1/storage/staging?${query.toString()}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    return mapStagingWorkspaceRecord(await readCorePayload(response, 'staging evidence'))
  }

  async reconcileStaging(stagingId?: string, idempotencyKey: string = crypto.randomUUID()): Promise<StagingWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Staging reconciliation requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const normalizedId = stagingId?.trim()
    if (stagingId !== undefined && !normalizedId) throw new CoreClientError('A staging id is required when a staging scope is supplied.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    if (!idempotencyKey.trim()) throw new CoreClientError('An idempotency key is required for staging reconciliation.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const body = normalizedId ? { staging_id: normalizedId } : {}
    const response = await fetch(`${this.baseUrl}/v1/storage/staging/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    })
    return mapStagingCommandResultRecord(await readCorePayload(response, 'staging reconciliation'))
  }

  async getReleaseReadiness(projectId: string, signal?: AbortSignal): Promise<ReleaseReadiness> {
    if (!this.baseUrl) throw new CoreClientError('Release readiness requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim()) throw new CoreClientError('A project id is required to read release readiness.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/readiness`, { signal, headers: { Accept: 'application/json' } })
    return mapReleaseReadinessRecord(await readCorePayload(response, 'release readiness'))
  }

  async getReleaseCandidates(projectId: string, signal?: AbortSignal): Promise<ReleaseCandidateList> {
    if (!this.baseUrl) throw new CoreClientError('Release candidates require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim()) throw new CoreClientError('A project id is required to read release candidates.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/candidates`, { signal, headers: { Accept: 'application/json' } })
    return mapReleaseCandidateListRecord(await readCorePayload(response, 'release candidates'))
  }

  async getReleaseCandidate(projectId: string, candidateId: string, signal?: AbortSignal): Promise<ReleaseCandidate> {
    if (!this.baseUrl) throw new CoreClientError('Release candidate requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !candidateId.trim()) throw new CoreClientError('A project and candidate id are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/candidates/${encodeURIComponent(candidateId)}`, { signal, headers: { Accept: 'application/json' } })
    return mapReleaseCandidateWorkspaceRecord(await readCorePayload(response, 'release candidate'))
  }

  async createReleaseCandidateDraft(projectId: string, idempotencyKey: string = crypto.randomUUID()): Promise<ReleaseCandidate> {
    if (!this.baseUrl) throw new CoreClientError('Release candidate creation requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim()) throw new CoreClientError('A project id is required to create a release candidate.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    if (!idempotencyKey.trim()) throw new CoreClientError('An idempotency key is required to create a release candidate.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/candidates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: '{}',
    })
    return mapReleaseCandidateRecord(await readCorePayload(response, 'release candidate creation'))
  }

  async cancelReleaseCandidateDraft(projectId: string, candidateId: string, expectedVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<ReleaseCandidate> {
    if (!this.baseUrl) throw new CoreClientError('Release candidate cancellation requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !candidateId.trim()) throw new CoreClientError('A project and candidate id are required to cancel a release candidate.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new CoreClientError('A valid candidate row version is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    if (!idempotencyKey.trim()) throw new CoreClientError('An idempotency key is required to cancel a release candidate.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/candidates/${encodeURIComponent(candidateId)}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expected_version: expectedVersion }),
    })
    return mapReleaseCandidateRecord(await readCorePayload(response, 'release candidate cancellation'))
  }

  async getReleaseBuildPlans(projectId: string, signal?: AbortSignal): Promise<ReleaseBuildPlanList> {
    if (!this.baseUrl) throw new CoreClientError('Release build plans require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim()) throw new CoreClientError('A project id is required to read release build plans.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/build-plans`, { signal, headers: { Accept: 'application/json' } })
    return mapReleaseBuildPlanListRecord(await readCorePayload(response, 'release build plans'))
  }

  async getReleaseBuildPlan(projectId: string, planId: string, signal?: AbortSignal): Promise<ReleaseBuildPlan> {
    if (!this.baseUrl) throw new CoreClientError('Release build plan requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !planId.trim()) throw new CoreClientError('A project and build plan id are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/build-plans/${encodeURIComponent(planId)}`, { signal, headers: { Accept: 'application/json' } })
    return mapReleaseBuildPlanRecord(await readCorePayload(response, 'release build plan'))
  }

  async createReleaseBuildPlan(projectId: string, input: { releaseCandidateId: string; expectedVersion: number }, idempotencyKey: string = crypto.randomUUID()): Promise<ReleaseBuildPlan> {
    if (!this.baseUrl) throw new CoreClientError('Release build plan creation requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !input?.releaseCandidateId?.trim()) throw new CoreClientError('A project and release candidate id are required to plan a release build.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new CoreClientError('A valid release candidate row version is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    if (!idempotencyKey.trim()) throw new CoreClientError('An idempotency key is required to plan a release build.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/release/build-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ release_candidate_id: input.releaseCandidateId.trim(), expected_version: input.expectedVersion }),
    })
    return mapReleaseBuildPlanRecord(await readCorePayload(response, 'release build plan creation'))
  }

  async resolveMediaPreview(projectId: string, revisionId: string, purpose = 'LIBRARY_PREVIEW', signal?: AbortSignal): Promise<MediaPreviewResolution> {
    if (!this.baseUrl) throw new CoreClientError('Media preview requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const query = new URLSearchParams({ purpose, session_id: this.previewSessionId })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(revisionId)}/preview?${query.toString()}`, {
      signal,
      headers: { Accept: 'application/json', 'X-CineForge-Session': this.previewSessionId },
    })
    const source = asRecord(await readCorePayload(response, 'media preview'))
    const rawUrl = stringValue(source.preview_url ?? source.previewUrl)
    if (!rawUrl) throw new CoreClientError('Core did not return a media preview capability.', { code: 'PREVIEW_CAPABILITY_MISSING', category: 'INTERNAL', needsUser: false })
    return {
      projectId: stringValue(source.project_id ?? source.projectId) ?? projectId,
      revisionId: stringValue(source.asset_revision_id ?? source.assetRevisionId) ?? revisionId,
      purpose: stringValue(source.purpose) ?? purpose,
      url: rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `${this.baseUrl}${rawUrl}`,
      mimeType: stringValue(source.mime_type ?? source.mimeType) ?? 'application/octet-stream',
      byteSize: numberValue(source.byte_size ?? source.byteSize, 0),
      contentHash: stringValue(source.content_hash ?? source.contentHash),
      expiresAt: stringValue(source.expires_at ?? source.expiresAt),
      readinessState: stringValue(source.readiness_state ?? source.readinessState),
      rightsStatus: stringValue(source.rights_status ?? source.rightsStatus),
    }
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

  async getTimelineAudioTiming(projectId: string, timelineId: string, timelineRevisionId: string, signal?: AbortSignal): Promise<AudioCueTiming> {
    if (!this.baseUrl) throw new CoreClientError('Audio cue timing requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !timelineRevisionId.trim()) throw new CoreClientError('An exact timeline and revision are required to read audio timing.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/revisions/${encodeURIComponent(timelineRevisionId)}/audio-cues`, { signal, headers: { Accept: 'application/json' } })
    return mapAudioTimingRecord(await readCorePayload(response, 'audio cue timing'))
  }

  async getTimelineSubtitleTiming(projectId: string, timelineId: string, timelineRevisionId: string, signal?: AbortSignal): Promise<SubtitleTiming> {
    if (!this.baseUrl) throw new CoreClientError('Subtitle timing requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !timelineRevisionId.trim()) throw new CoreClientError('An exact timeline and revision are required to read subtitle timing.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/revisions/${encodeURIComponent(timelineRevisionId)}/subtitle-tracks`, { signal, headers: { Accept: 'application/json' } })
    return mapSubtitleTimingRecord(await readCorePayload(response, 'subtitle timing'))
  }

  async getTimelineTimingImpact(projectId: string, timelineId: string, timelineRevisionId: string, signal?: AbortSignal): Promise<TimelineTimingImpact> {
    if (!this.baseUrl) throw new CoreClientError('Timeline timing impact requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !timelineRevisionId.trim()) throw new CoreClientError('An exact timeline and revision are required to read timing impact.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/revisions/${encodeURIComponent(timelineRevisionId)}/timing-impact`, { signal, headers: { Accept: 'application/json' } })
    return mapTimelineTimingImpactRecord(await readCorePayload(response, 'timeline timing impact'))
  }

  async createAudioCueRevision(projectId: string, timelineId: string, input: AudioCueRevisionInput, idempotencyKey: string = crypto.randomUUID()): Promise<{ audioCue: AudioCueSummary | null; revision: AudioCueRevision | null }> {
    if (!this.baseUrl) throw new CoreClientError('Creating an audio cue requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !input.timelineRevisionId.trim() || !/^[0-9a-f]{64}$/i.test(input.timelineContentHash)) throw new CoreClientError('Audio timing needs an exact timeline revision and SHA-256 content hash.', { code: 'TIMING_DEPENDENCY_HASH_REQUIRED', category: 'VALIDATION', needsUser: true })
    if (!input.title.trim() || input.title.trim().length > 200 || !input.cueType.trim() || !input.start || !input.end) throw new CoreClientError('Audio cue type, title and rational timing are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const body: Record<string, unknown> = {
      timeline_id: timelineId,
      timing_dependency_revision_id: input.timelineRevisionId,
      timing_dependency_content_hash: input.timelineContentHash.toLowerCase(),
      cue_type: input.cueType.trim().toUpperCase(),
      title: input.title.trim(),
      start: input.start,
      end: input.end,
      intent_text: input.intentText?.trim() ?? '',
      ...(input.selectedAssetRevisionId?.trim() ? { selected_asset_revision_id: input.selectedAssetRevisionId.trim() } : {}),
      ...(input.audioCueId?.trim() ? { audio_cue_id: input.audioCueId.trim() } : {}),
      ...(input.expectedCueVersion !== undefined ? { expected_version: input.expectedCueVersion } : {}),
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/audio-cues${input.audioCueId?.trim() ? `/${encodeURIComponent(input.audioCueId.trim())}/revisions` : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body),
    })
    return mapAudioCueResultRecord(await readCorePayload(response, 'audio cue revision creation'))
  }

  async transitionAudioCueRevision(projectId: string, timelineId: string, audioCueId: string, revisionId: string, nextState: TimelineTimingLifecycleState, expectedVersion: number, timing: TimingDependencyInput, idempotencyKey: string = crypto.randomUUID()): Promise<{ audioCue: AudioCueSummary | null; revision: AudioCueRevision | null }> {
    if (!this.baseUrl) throw new CoreClientError('Audio cue transitions require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !audioCueId.trim() || !revisionId.trim() || !nextState.trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !timing?.timelineRevisionId?.trim() || !/^[0-9a-f]{64}$/i.test(timing.timelineContentHash)) throw new CoreClientError('An exact audio cue revision, timeline pin and current version are required.', { code: 'TIMING_DEPENDENCY_HASH_REQUIRED', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/audio-cues/${encodeURIComponent(audioCueId)}/revisions/${encodeURIComponent(revisionId)}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ timeline_id: timelineId, timing_dependency_revision_id: timing.timelineRevisionId, timing_dependency_content_hash: timing.timelineContentHash.toLowerCase(), next_state: nextState.trim().toUpperCase(), expected_version: expectedVersion }),
    })
    return mapAudioCueResultRecord(await readCorePayload(response, 'audio cue revision transition'))
  }

  async createSubtitleTrackRevision(projectId: string, timelineId: string, input: SubtitleTrackRevisionInput, idempotencyKey: string = crypto.randomUUID()): Promise<{ subtitleTrack: SubtitleTrackSummary | null; revision: SubtitleTrackRevision | null }> {
    if (!this.baseUrl) throw new CoreClientError('Creating subtitles requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !input.timelineRevisionId.trim() || !/^[0-9a-f]{64}$/i.test(input.timelineContentHash)) throw new CoreClientError('Subtitle timing needs an exact timeline revision and SHA-256 content hash.', { code: 'TIMING_DEPENDENCY_HASH_REQUIRED', category: 'VALIDATION', needsUser: true })
    if (!input.locale.trim() || input.locale.trim().length > 32 || !input.title.trim() || input.title.trim().length > 200 || !Array.isArray(input.segments) || input.segments.length > 2000) throw new CoreClientError('Subtitle locale, title and a bounded segment list are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const segments = input.segments.map((segment) => ({
      start: segment.start, end: segment.end, locale: segment.locale.trim() || input.locale.trim(), text: segment.text.trim(), ...(segment.segmentIndex === undefined ? {} : { segment_index: segment.segmentIndex }),
    }))
    if (segments.some((segment) => !segment.start || !segment.end || !segment.locale || !segment.text || segment.text.length > 2000)) throw new CoreClientError('Each subtitle segment needs rational timing, locale and text.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const body: Record<string, unknown> = {
      timeline_id: timelineId,
      timing_dependency_revision_id: input.timelineRevisionId,
      timing_dependency_content_hash: input.timelineContentHash.toLowerCase(),
      locale: input.locale.trim(), title: input.title.trim(), format_profile: input.formatProfile?.trim() || 'TEXT', segments,
      ...(input.subtitleTrackId?.trim() ? { subtitle_track_id: input.subtitleTrackId.trim() } : {}),
      ...(input.expectedTrackVersion !== undefined ? { expected_version: input.expectedTrackVersion } : {}),
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/subtitle-tracks${input.subtitleTrackId?.trim() ? `/${encodeURIComponent(input.subtitleTrackId.trim())}/revisions` : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body),
    })
    return mapSubtitleTrackResultRecord(await readCorePayload(response, 'subtitle track revision creation'))
  }

  async transitionSubtitleTrackRevision(projectId: string, timelineId: string, subtitleTrackId: string, revisionId: string, nextState: TimelineTimingLifecycleState, expectedVersion: number, timing: TimingDependencyInput, idempotencyKey: string = crypto.randomUUID()): Promise<{ subtitleTrack: SubtitleTrackSummary | null; revision: SubtitleTrackRevision | null }> {
    if (!this.baseUrl) throw new CoreClientError('Subtitle transitions require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!projectId.trim() || !timelineId.trim() || !subtitleTrackId.trim() || !revisionId.trim() || !nextState.trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !timing?.timelineRevisionId?.trim() || !/^[0-9a-f]{64}$/i.test(timing.timelineContentHash)) throw new CoreClientError('An exact subtitle revision, timeline pin and current version are required.', { code: 'TIMING_DEPENDENCY_HASH_REQUIRED', category: 'VALIDATION', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/subtitle-tracks/${encodeURIComponent(subtitleTrackId)}/revisions/${encodeURIComponent(revisionId)}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ timeline_id: timelineId, timing_dependency_revision_id: timing.timelineRevisionId, timing_dependency_content_hash: timing.timelineContentHash.toLowerCase(), next_state: nextState.trim().toUpperCase(), expected_version: expectedVersion }),
    })
    return mapSubtitleTrackResultRecord(await readCorePayload(response, 'subtitle track revision transition'))
  }

  async getTimelineWorkingSession(projectId: string, timelineId: string, sessionId: string, signal?: AbortSignal): Promise<TimelineWorkingWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Timeline working sessions require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/working-sessions/${encodeURIComponent(sessionId)}`, { signal, headers: { Accept: 'application/json' } })
    const result = mapTimelineWorkingWorkspaceRecord(await readCorePayload(response, 'timeline working session'))
    if (result.session?.id && result.session.clientInstanceId) this.timelineWorkingClientInstances.set(result.session.id, result.session.clientInstanceId)
    return result
  }

  async getTimelineWorkingHistory(projectId: string, timelineId: string, sessionId: string, afterOpSeq = 0, limit = 100, signal?: AbortSignal): Promise<TimelineWorkingHistory> {
    if (!this.baseUrl) throw new CoreClientError('Timeline working history requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!sessionId.trim() || !Number.isSafeInteger(afterOpSeq) || afterOpSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new CoreClientError('A valid history cursor and bounded page size are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const query = new URLSearchParams({ after_op_seq: String(afterOpSeq), limit: String(limit) })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/working-sessions/${encodeURIComponent(sessionId)}/history?${query.toString()}`, { signal, headers: { Accept: 'application/json' } })
    return mapTimelineWorkingHistoryRecord(await readCorePayload(response, 'timeline working history'))
  }

  async beginTimelineWorkingSession(projectId: string, timelineId: string, input: { baseRevisionId: string; baseRevisionRowVersion: number; baseContentHash: string; clientInstanceId: string; expectedTimelineVersion: number }, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Opening a timeline working session requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!input.baseRevisionId.trim() || !/^[0-9a-f]{64}$/i.test(input.baseContentHash) || !input.clientInstanceId.trim() || !Number.isSafeInteger(input.baseRevisionRowVersion) || input.baseRevisionRowVersion < 1 || !Number.isSafeInteger(input.expectedTimelineVersion) || input.expectedTimelineVersion < 1) {
      throw new CoreClientError('The exact base revision, content hash, versions and client identity are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/working-sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ base_revision_id: input.baseRevisionId, base_revision_row_version: input.baseRevisionRowVersion, base_content_hash: input.baseContentHash.toLowerCase(), client_instance_id: input.clientInstanceId, expected_timeline_version: input.expectedTimelineVersion }),
    })
    const result = mapTimelineWorkingWorkspaceRecord(await readCorePayload(response, 'timeline working session opening'))
    if (result.session?.id && result.session.clientInstanceId) this.timelineWorkingClientInstances.set(result.session.id, result.session.clientInstanceId)
    return result
  }

  async applyTimelineEditOps(projectId: string, timelineId: string, sessionId: string, operations: Array<Record<string, unknown>>, expectedSessionVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Applying timeline edits requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!sessionId.trim() || !Array.isArray(operations) || operations.length < 1 || operations.length > 32 || !Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1) throw new CoreClientError('A bounded operation batch and current working-session version are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const clientInstanceId = this.timelineWorkingClientInstances.get(sessionId)
    if (!clientInstanceId) throw new CoreClientError('The exact working-session client identity is unavailable; reload the session before editing.', { code: 'TIMELINE_WORKING_CLIENT_REQUIRED', category: 'AUTH_REQUIRED', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/working-sessions/${encodeURIComponent(sessionId)}/ops`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ operations, client_instance_id: clientInstanceId, expected_version: expectedSessionVersion }),
    })
    return mapTimelineWorkingWorkspaceRecord(await readCorePayload(response, 'timeline edit operations'))
  }

  private async timelineWorkingCommand(projectId: string, timelineId: string, sessionId: string, path: string, body: Record<string, unknown>, label: string, idempotencyKey: string): Promise<TimelineWorkingWorkspace> {
    if (!this.baseUrl) throw new CoreClientError(`${label} requires a connected Core.`, { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const clientInstanceId = this.timelineWorkingClientInstances.get(sessionId)
    if (!clientInstanceId) throw new CoreClientError('The exact working-session client identity is unavailable; reload the session before continuing.', { code: 'TIMELINE_WORKING_CLIENT_REQUIRED', category: 'AUTH_REQUIRED', needsUser: true })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/working-sessions/${encodeURIComponent(sessionId)}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ ...body, client_instance_id: clientInstanceId }),
    })
    const result = mapTimelineWorkingWorkspaceRecord(await readCorePayload(response, label))
    if (['CLOSED', 'ABANDONED'].includes(result.session?.state ?? '')) this.timelineWorkingClientInstances.delete(sessionId)
    return result
  }

  async undoTimelineEditOp(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1) throw new CoreClientError('A current working-session version is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    return this.timelineWorkingCommand(projectId, timelineId, sessionId, 'undo', { expected_version: expectedSessionVersion }, 'timeline undo', idempotencyKey)
  }

  async redoTimelineEditOp(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1) throw new CoreClientError('A current working-session version is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    return this.timelineWorkingCommand(projectId, timelineId, sessionId, 'redo', { expected_version: expectedSessionVersion }, 'timeline redo', idempotencyKey)
  }

  async autosaveTimelineWorkingSession(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1) throw new CoreClientError('A current working-session version is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    return this.timelineWorkingCommand(projectId, timelineId, sessionId, 'autosave', { expected_version: expectedSessionVersion }, 'timeline draft autosave', idempotencyKey)
  }

  async checkpointTimelineWorkingSession(projectId: string, timelineId: string, sessionId: string, expectedSessionVersion: number, expectedTimelineVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1 || !Number.isSafeInteger(expectedTimelineVersion) || expectedTimelineVersion < 1) throw new CoreClientError('Current session and timeline versions are required before checkpoint.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    return this.timelineWorkingCommand(projectId, timelineId, sessionId, 'checkpoint', { expected_version: expectedSessionVersion, expected_timeline_version: expectedTimelineVersion }, 'timeline checkpoint', idempotencyKey)
  }

  async closeTimelineWorkingSession(projectId: string, timelineId: string, sessionId: string, disposition: 'SAVE' | 'ABANDON', expectedSessionVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<TimelineWorkingWorkspace> {
    if (!Number.isSafeInteger(expectedSessionVersion) || expectedSessionVersion < 1) throw new CoreClientError('A current working-session version is required before close.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    return this.timelineWorkingCommand(projectId, timelineId, sessionId, 'close', { disposition, expected_version: expectedSessionVersion }, 'timeline session close', idempotencyKey)
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

  async getExternalEdits(projectId: string, state?: string, signal?: AbortSignal): Promise<ExternalEditList> {
    if (!this.baseUrl) throw new CoreClientError('Returned interchange registration requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const query = state ? `?validation_state=${encodeURIComponent(state)}` : ''
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/external-edits${query}`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'returned interchanges'))
    return mapExternalEditListRecord(payload.result ?? payload)
  }

  async getExternalEdit(projectId: string, externalEditId: string, signal?: AbortSignal): Promise<ExternalEdit> {
    if (!this.baseUrl) throw new CoreClientError('Returned interchange details require a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!externalEditId.trim()) throw new CoreClientError('An external edit id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/external-edits/${encodeURIComponent(externalEditId)}`, { signal, headers: { Accept: 'application/json' } })
    const payload = asRecord(await readCorePayload(response, 'returned interchange details'))
    const result = asRecord(payload.result ?? payload)
    return mapExternalEditRecord(result.external_edit ?? result.externalEdit ?? result)
  }

  async registerExternalEdit(projectId: string, input: ExternalEditRegistrationInput, idempotencyKey: string = crypto.randomUUID()): Promise<ExternalEdit> {
    if (!this.baseUrl) throw new CoreClientError('Registering a returned interchange requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    const handoffManifestId = input.handoffManifestId?.trim() ?? ''
    const exportSessionId = input.exportSessionId?.trim() ?? ''
    if ((!handoffManifestId && !exportSessionId) || !input.returnedAssetRevisionId.trim() || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new CoreClientError('An exact handoff or export identity, returned asset and current export version are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    if (input.lineageConfidence && !['EXACT', 'PARTIAL', 'FLATTENED', 'UNKNOWN'].includes(input.lineageConfidence)) throw new CoreClientError('The lineage confidence is invalid.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/external-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        ...(handoffManifestId ? { handoff_manifest_id: handoffManifestId } : {}),
        ...(exportSessionId ? { export_session_id: exportSessionId } : {}),
        returned_asset_revision_id: input.returnedAssetRevisionId,
        expected_version: input.expectedVersion,
        ...(input.lineageConfidence ? { lineage_confidence: input.lineageConfidence } : {}),
      }),
    })
    const payload = asRecord(await readCorePayload(response, 'returned interchange registration'))
    const result = asRecord(payload.result ?? payload)
    return mapExternalEditRecord(result.external_edit ?? result.externalEdit ?? result)
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

  async buildTimelineInterchangeExport(projectId: string, exportSessionId: string, dependencySnapshotHash: string, expectedVersion: number, idempotencyKey: string = crypto.randomUUID()): Promise<HandoffWorkspace> {
    if (!this.baseUrl) throw new CoreClientError('Building the timeline interchange requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!exportSessionId.trim() || !/^[0-9a-f]{64}$/i.test(dependencySnapshotHash) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new CoreClientError('The exact export session, dependency snapshot, and current export version are required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportSessionId)}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ dependency_snapshot_hash: dependencySnapshotHash, expected_version: expectedVersion }),
    })
    return mapHandoffWorkspaceRecord(await readCorePayload(response, 'timeline interchange export'))
  }

  async resolveTimelineInterchangeDownload(projectId: string, exportSessionId: string, signal?: AbortSignal): Promise<TimelineInterchangeDownload> {
    if (!this.baseUrl) throw new CoreClientError('Downloading a timeline interchange requires a connected Core.', { code: 'CORE_OFFLINE', category: 'EXTERNAL_UNAVAILABLE', retryable: true, needsUser: true })
    if (!exportSessionId.trim()) throw new CoreClientError('An export session id is required.', { code: 'INVALID_ARGUMENT', category: 'VALIDATION' })
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportSessionId)}/download`, {
      signal,
      headers: { Accept: 'application/json', 'x-cineforge-session': this.previewSessionId },
    })
    const value = asRecord(await readCorePayload(response, 'timeline interchange download'))
    const downloadUrl = stringValue(value.download_url ?? value.downloadUrl)
    if (!downloadUrl) throw new CoreClientError('Core did not return a bounded download capability.', { code: 'INVALID_RESPONSE', category: 'INTERNAL', needsUser: true })
    const absoluteDownloadUrl = /^https?:\/\//i.test(downloadUrl) ? downloadUrl : `${this.baseUrl.replace(/\/$/, '')}/${downloadUrl.replace(/^\//, '')}`
    return {
      projectId: stringValue(value.project_id ?? value.projectId) ?? projectId,
      exportSessionId: stringValue(value.export_session_id ?? value.exportSessionId) ?? exportSessionId,
      downloadUrl: absoluteDownloadUrl,
      expiresAt: stringValue(value.expires_at ?? value.expiresAt),
      mimeType: stringValue(value.mime_type ?? value.mimeType),
      byteSize: numberValue(value.byte_size ?? value.byteSize, 0),
      contentHash: stringValue(value.content_hash ?? value.contentHash),
      maxRangeBytes: numberValue(value.max_range_bytes ?? value.maxRangeBytes, 0),
    }
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
        'Idempotency-Key': crypto.randomUUID(),
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
        // The packaged bootstrap owns the browser intake lease under the
        // public source_handle contract. Core also accepts this alias and
        // resolves it to its durable staging boundary for direct/dev mode.
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

function optionalNumberValue(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : fallback
}

function mapProjectSummary(value: unknown): ProjectSummary {
  const source = asRecord(value)
  const completionSource = asRecord(source.completion)
  const rawProductionItems = source.production_items ?? source.productionItems
  const productionItems = Array.isArray(rawProductionItems)
    ? rawProductionItems.map((item, index) => mapProductionItemRecord(item, index))
    : []
  const done = integerValue(completionSource.done, productionItems.filter((item) => item.state === 'done').length, 0, Number.MAX_SAFE_INTEGER)
  const total = integerValue(completionSource.total, productionItems.length, 0, Number.MAX_SAFE_INTEGER)
  const rawHealth = stringValue(source.health ?? source.health_state ?? source.healthState)?.toLowerCase()
  const health: ProjectSummary['health'] = rawHealth === 'blocked' ? 'blocked' : rawHealth === 'attention' || rawHealth === 'at_risk' ? 'attention' : 'healthy'
  return {
    id: stringValue(source.id ?? source.project_id ?? source.projectId) ?? `project-${crypto.randomUUID()}`,
    name: stringValue(source.name ?? source.title) ?? 'CineForge project',
    kind: stringValue(source.kind ?? source.project_type ?? source.projectType) ?? 'Project',
    updatedAt: stringValue(source.updated_at ?? source.updatedAt) ?? new Date().toISOString(),
    stage: stringValue(source.stage ?? source.lifecycle_state ?? source.lifecycleState) ?? 'ACTIVE',
    stageDetail: stringValue(source.stage_detail ?? source.stageDetail ?? source.code) ?? '',
    cover: stringValue(source.cover) ?? 'linear-gradient(145deg, #7664a9 0%, #35446a 56%, #171c2a 100%)',
    accent: stringValue(source.accent) ?? '#b9a0ff',
    completion: { done, total },
    health,
    nextAction: stringValue(source.next_action ?? source.nextAction) ?? 'Mở dự án',
    nextActionLabel: stringValue(source.next_action_label ?? source.nextActionLabel) ?? 'Mở',
    storage: stringValue(source.storage) ?? '—',
    productionItems,
  }
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

function mapBackupSummaryRecord(value: unknown): BackupSummary {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.backup_id ?? source.backupId),
    backupType: stringValue(source.backup_type ?? source.backupType),
    durabilityClass: stringValue(source.durability_class ?? source.durabilityClass),
    failureDomain: stringValue(source.failure_domain ?? source.failureDomain),
    destinationName: stringValue(source.destination_name ?? source.destinationName),
    manifestName: stringValue(source.manifest_name ?? source.manifestName),
    snapshotName: stringValue(source.snapshot_name ?? source.snapshotName),
    installationId: stringValue(source.installation_id ?? source.installationId),
    schemaVersion: optionalNumberValue(source.schema_version ?? source.schemaVersion),
    eventSeqCheckpoint: optionalNumberValue(source.event_seq_checkpoint ?? source.eventSeqCheckpoint),
    state: stringValue(source.state ?? source.status) ?? 'UNKNOWN',
    dbSha256: stringValue(source.db_sha256 ?? source.dbSha256),
    manifestSha256: stringValue(source.manifest_sha256 ?? source.manifestSha256),
    byteSize: optionalNumberValue(source.byte_size ?? source.byteSize),
    objectCount: optionalNumberValue(source.object_count ?? source.objectCount),
    externalObjectCount: optionalNumberValue(source.external_object_count ?? source.externalObjectCount),
    errorCode: stringValue(source.error_code ?? source.errorCode),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    completedAt: stringValue(source.completed_at ?? source.completedAt),
  }
}

function mapBackupVerificationRecord(value: unknown): BackupVerification {
  const source = asRecord(value)
  const details = source.details && typeof source.details === 'object' && !Array.isArray(source.details) ? source.details as Record<string, unknown> : undefined
  return {
    id: stringValue(source.id ?? source.verification_id ?? source.verificationId),
    backupId: stringValue(source.backup_id ?? source.backupId),
    outcome: stringValue(source.outcome) ?? 'UNKNOWN',
    integrityState: stringValue(source.integrity_state ?? source.integrityState) ?? 'UNKNOWN',
    manifestSha256: stringValue(source.manifest_sha256 ?? source.manifestSha256),
    objectCount: optionalNumberValue(source.object_count ?? source.objectCount),
    byteSize: optionalNumberValue(source.byte_size ?? source.byteSize),
    details,
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapBackupWorkspaceRecord(value: unknown): BackupWorkspace {
  const source = asRecord(value)
  const backupSource = source.backup ?? source.backup_record
  return {
    backup: backupSource ? mapBackupSummaryRecord(backupSource) : null,
    verifications: arrayValue(source.verifications ?? source.verification_history).map(mapBackupVerificationRecord),
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapBackupRestoreCheckRecord(value: unknown): BackupRestoreCheck {
  const source = asRecord(value)
  return {
    id: stringValue(source.id) ?? 'UNKNOWN_CHECK',
    state: stringValue(source.state) ?? 'UNKNOWN',
    code: stringValue(source.code),
    details: source.details && typeof source.details === 'object' && !Array.isArray(source.details) ? source.details as Record<string, unknown> : undefined,
  }
}

function mapBackupRestoreEstimateRecord(value: unknown): BackupRestoreEstimate {
  const source = asRecord(value)
  const artifact = asRecord(source.artifact)
  const target = asRecord(source.target)
  return {
    schemaVersion: optionalNumberValue(source.schema_version ?? source.schemaVersion),
    preflightState: stringValue(source.preflight_state ?? source.preflightState) ?? 'UNKNOWN',
    restoreAllowed: source.restore_allowed === true || source.restoreAllowed === true,
    activationState: stringValue(source.activation_state ?? source.activationState),
    recoveryEpochState: stringValue(source.recovery_epoch_state ?? source.recoveryEpochState),
    forwardPolicyReconciliationState: stringValue(source.forward_policy_reconciliation_state ?? source.forwardPolicyReconciliationState),
    nextStepCode: stringValue(source.next_step_code ?? source.nextStepCode),
    checks: arrayValue(source.checks).map(mapBackupRestoreCheckRecord),
    artifact: {
      formatVersion: optionalNumberValue(artifact.format_version ?? artifact.formatVersion),
      backupType: stringValue(artifact.backup_type ?? artifact.backupType),
      durabilityClass: stringValue(artifact.durability_class ?? artifact.durabilityClass),
      failureDomain: stringValue(artifact.failure_domain ?? artifact.failureDomain),
      schemaVersion: optionalNumberValue(artifact.schema_version ?? artifact.schemaVersion),
      eventSeqCheckpoint: optionalNumberValue(artifact.event_seq_checkpoint ?? artifact.eventSeqCheckpoint),
      databaseBytes: optionalNumberValue(artifact.database_bytes ?? artifact.databaseBytes),
      copiedObjectBytes: optionalNumberValue(artifact.copied_object_bytes ?? artifact.copiedObjectBytes),
      copiedObjectCount: optionalNumberValue(artifact.copied_object_count ?? artifact.copiedObjectCount),
      externalObjectCount: optionalNumberValue(artifact.external_object_count ?? artifact.externalObjectCount),
      objectCount: optionalNumberValue(artifact.object_count ?? artifact.objectCount),
      byteSize: optionalNumberValue(artifact.byte_size ?? artifact.byteSize),
      manifestSha256: stringValue(artifact.manifest_sha256 ?? artifact.manifestSha256),
      databaseSha256: stringValue(artifact.database_sha256 ?? artifact.databaseSha256),
    },
    target: {
      currentSchemaVersion: optionalNumberValue(target.current_schema_version ?? target.currentSchemaVersion),
      currentEventSeq: optionalNumberValue(target.current_event_seq ?? target.currentEventSeq),
      installationState: stringValue(target.installation_state ?? target.installationState),
      schemaState: stringValue(target.schema_state ?? target.schemaState),
      checkpointState: stringValue(target.checkpoint_state ?? target.checkpointState),
      forwardEventCount: optionalNumberValue(target.forward_event_count ?? target.forwardEventCount),
    },
    estimatedRestoreBytes: optionalNumberValue(source.estimated_restore_bytes ?? source.estimatedRestoreBytes),
    estimatedRestoreDurationMs: optionalNumberValue(source.estimated_restore_duration_ms ?? source.estimatedRestoreDurationMs),
    durationEstimateMethod: stringValue(source.duration_estimate_method ?? source.durationEstimateMethod),
    observedRestoreDurationMs: optionalNumberValue(source.observed_restore_duration_ms ?? source.observedRestoreDurationMs),
    verificationErrorCode: stringValue(source.verification_error_code ?? source.verificationErrorCode),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapBackupRestoreWorkspaceRecord(value: unknown): BackupRestoreWorkspace {
  const source = asRecord(value)
  const backupSource = source.backup ?? source.backup_record
  const estimateSource = source.restore_estimate ?? source.restoreEstimate
  return {
    backup: backupSource ? mapBackupSummaryRecord(backupSource) : null,
    restoreEstimate: estimateSource ? mapBackupRestoreEstimateRecord(estimateSource) : null,
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapRecoveryStatusRecord(value: unknown): RecoveryStatus {
  const source = asRecord(value)
  return {
    schemaVersion: optionalNumberValue(source.schema_version ?? source.schemaVersion),
    readinessState: stringValue(source.readiness_state ?? source.readinessState) ?? 'UNKNOWN',
    recoveryState: stringValue(source.recovery_state ?? source.recoveryState),
    coreHealthState: stringValue(source.core_health_state ?? source.coreHealthState),
    recoveryEpochState: stringValue(source.recovery_epoch_state ?? source.recoveryEpochState),
    externalRealityState: stringValue(source.external_reality_state ?? source.externalRealityState),
    restoreActivationState: stringValue(source.restore_activation_state ?? source.restoreActivationState),
    dispatchPolicyState: stringValue(source.dispatch_policy_state ?? source.dispatchPolicyState),
    readOnly: source.read_only === true || source.readOnly === true,
    nextStepCode: stringValue(source.next_step_code ?? source.nextStepCode),
    checks: arrayValue(source.checks).map((value): RecoveryCheck => {
      const check = asRecord(value)
      return {
        id: stringValue(check.id) ?? 'UNKNOWN_CHECK',
        state: stringValue(check.state) ?? 'UNKNOWN',
        code: stringValue(check.code),
        details: check.details && typeof check.details === 'object' && !Array.isArray(check.details) ? check.details as Record<string, unknown> : undefined,
      }
    }),
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapBackupCommandResultRecord(value: unknown): BackupCommandResult {
  const source = asRecord(value)
  return {
    backup: source.backup ? mapBackupSummaryRecord(source.backup) : null,
    verification: source.verification ? mapBackupVerificationRecord(source.verification) : null,
    idempotentReplay: source.idempotent_replay === true || source.idempotentReplay === true,
  }
}

function mapStorageAdmissionRecord(value: unknown): StorageAdmission {
  const source = asRecord(value)
  return {
    destinationName: stringValue(source.destination_name ?? source.destinationName),
    durabilityClass: stringValue(source.durability_class ?? source.durabilityClass),
    failureDomain: stringValue(source.failure_domain ?? source.failureDomain),
    databaseBytes: optionalNumberValue(source.database_bytes ?? source.databaseBytes),
    objectBytes: optionalNumberValue(source.object_bytes ?? source.objectBytes),
    estimatedBytes: optionalNumberValue(source.estimated_bytes ?? source.estimatedBytes),
    availableBytes: optionalNumberValue(source.available_bytes ?? source.availableBytes),
    reserveBytes: optionalNumberValue(source.reserve_bytes ?? source.reserveBytes),
    objectCount: optionalNumberValue(source.object_count ?? source.objectCount),
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapStorageScrubHealthRecord(value: unknown): StorageScrubHealth {
  const source = asRecord(value)
  const limits = asRecord(source.limits)
  const scan = asRecord(source.scan)
  const cursor = asRecord(source.cursor)
  return {
    schemaVersion: optionalNumberValue(source.schema_version ?? source.schemaVersion),
    status: stringValue(source.status) ?? 'UNKNOWN',
    readOnly: source.read_only === true || source.readOnly === true,
    storageClass: stringValue(source.storage_class ?? source.storageClass),
    limits: {
      maxObjects: numberValue(limits.max_objects ?? limits.maxObjects, 0),
      maxBytes: numberValue(limits.max_bytes ?? limits.maxBytes, 0),
    },
    scan: {
      managedObjectCount: numberValue(scan.managed_object_count ?? scan.managedObjectCount, 0),
      checkedCount: numberValue(scan.checked_count ?? scan.checkedCount, 0),
      checkedBytes: numberValue(scan.checked_bytes ?? scan.checkedBytes, 0),
      failedCount: numberValue(scan.failed_count ?? scan.failedCount, 0),
      unknownCount: numberValue(scan.unknown_count ?? scan.unknownCount, 0),
      complete: scan.complete === true,
      truncated: scan.truncated === true,
      truncationReason: stringValue(scan.truncation_reason ?? scan.truncationReason),
      remainingCount: numberValue(scan.remaining_count ?? scan.remainingCount, 0),
    },
    objects: arrayValue(source.objects).map((value): StorageScrubHealth['objects'][number] => {
      const item = asRecord(value)
      return {
        id: stringValue(item.id),
        hashAlgorithm: stringValue(item.hash_algorithm ?? item.hashAlgorithm),
        contentHash: stringValue(item.content_hash ?? item.contentHash),
        expectedByteSize: optionalNumberValue(item.expected_byte_size ?? item.expectedByteSize),
        observedHash: stringValue(item.observed_hash ?? item.observedHash),
        observedByteSize: optionalNumberValue(item.observed_byte_size ?? item.observedByteSize),
        locationState: stringValue(item.location_state ?? item.locationState),
        state: stringValue(item.state) ?? 'UNKNOWN',
        code: stringValue(item.code),
        registeredVerifiedAt: stringValue(item.registered_verified_at ?? item.registeredVerifiedAt),
      }
    }),
    cursor: {
      requestedAfter: stringValue(cursor.requested_after ?? cursor.requestedAfter),
      nextAfter: stringValue(cursor.next_after ?? cursor.nextAfter),
    },
    blockedObject: source.blocked_object && typeof source.blocked_object === 'object' && !Array.isArray(source.blocked_object)
      ? {
          id: stringValue((source.blocked_object as Record<string, unknown>).id),
          contentHash: stringValue((source.blocked_object as Record<string, unknown>).content_hash ?? (source.blocked_object as Record<string, unknown>).contentHash),
          expectedByteSize: optionalNumberValue((source.blocked_object as Record<string, unknown>).expected_byte_size ?? (source.blocked_object as Record<string, unknown>).expectedByteSize),
        }
      : undefined,
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    checkedAt: stringValue(source.checked_at ?? source.checkedAt),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapManagedJobAttemptRecord(value: unknown): ManagedAssetIntegrityJob['latestAttempt'] {
  const source = asRecord(value)
  if (Object.keys(source).length === 0) return null
  return {
    id: stringValue(source.id),
    jobId: stringValue(source.job_id ?? source.jobId),
    attemptNo: numberValue(source.attempt_no ?? source.attemptNo, 0),
    retryKind: stringValue(source.retry_kind ?? source.retryKind),
    state: stringValue(source.state) ?? 'UNKNOWN',
    startedAt: stringValue(source.started_at ?? source.startedAt),
    finishedAt: stringValue(source.finished_at ?? source.finishedAt),
    bytesRead: optionalNumberValue(source.bytes_read ?? source.bytesRead),
    errorCode: stringValue(source.error_code ?? source.errorCode),
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapManagedJobEvidenceRecord(value: unknown): ManagedAssetIntegrityJob['evidence'] {
  const source = asRecord(value)
  if (Object.keys(source).length === 0) return null
  const rawEvidence = source.evidence
  const safeEvidence: Record<string, unknown> = {}
  if (rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)) {
    const evidenceRecord = rawEvidence as Record<string, unknown>
    if (typeof evidenceRecord.late_after_cancel === 'boolean') safeEvidence.late_after_cancel = evidenceRecord.late_after_cancel
    if (typeof evidenceRecord.connector_version === 'string' && evidenceRecord.connector_version.length <= 120) safeEvidence.connector_version = evidenceRecord.connector_version
  }
  return {
    id: stringValue(source.id),
    jobAttemptId: stringValue(source.job_attempt_id ?? source.jobAttemptId),
    projectId: stringValue(source.project_id ?? source.projectId),
    assetRevisionId: stringValue(source.asset_revision_id ?? source.assetRevisionId),
    state: stringValue(source.state) ?? 'UNKNOWN',
    code: stringValue(source.code),
    contentHash: stringValue(source.content_hash ?? source.contentHash),
    expectedByteSize: optionalNumberValue(source.expected_byte_size ?? source.expectedByteSize),
    observedHash: stringValue(source.observed_hash ?? source.observedHash),
    observedByteSize: optionalNumberValue(source.observed_byte_size ?? source.observedByteSize),
    bytesRead: optionalNumberValue(source.bytes_read ?? source.bytesRead),
    evidence: safeEvidence,
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapManagedJobRecord(value: unknown): ManagedAssetIntegrityJob {
  const source = asRecord(value)
  const attempt = source.latest_attempt ?? source.latestAttempt
  const evidence = source.evidence
  const usage = source.usage && typeof source.usage === 'object' && !Array.isArray(source.usage) ? asRecord(source.usage) : null
  const id = stringValue(source.id ?? source.job_id ?? source.jobId)
  if (!id) throw new CoreClientError('Core returned a job projection without a stable id.', { code: 'CORE_INVALID_RESPONSE', category: 'INTERNAL', needsUser: true })
  return {
    id,
    projectId: stringValue(source.project_id ?? source.projectId),
    jobType: stringValue(source.job_type ?? source.jobType) ?? 'STORAGE_OBJECT_INTEGRITY_PROBE',
    semanticCapability: stringValue(source.semantic_capability ?? source.semanticCapability) ?? 'STORAGE_OBJECT_INTEGRITY_PROBE',
    priority: numberValue(source.priority, 50),
    state: stringValue(source.state) ?? 'UNKNOWN',
    subjectAssetRevisionId: stringValue(source.subject_asset_revision_id ?? source.subjectAssetRevisionId) ?? '',
    subjectContentHash: stringValue(source.subject_content_hash ?? source.subjectContentHash) ?? '',
    requestedMaxBytes: numberValue(source.requested_max_bytes ?? source.requestedMaxBytes, 0),
    pinnedManifestHash: stringValue(source.pinned_manifest_hash ?? source.pinnedManifestHash) ?? '',
    connectorVersion: stringValue(source.connector_version ?? source.connectorVersion) ?? 'UNKNOWN',
    needsUser: source.needs_user === true || source.needsUser === true,
    nextStep: stringValue(source.next_step ?? source.nextStep),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    cancelable: source.cancelable === true,
    retryable: source.retryable === true,
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
    latestAttempt: attempt ? mapManagedJobAttemptRecord(attempt) : null,
    evidence: evidence ? mapManagedJobEvidenceRecord(evidence) : null,
    usage: usage ? {
      resourceType: stringValue(usage.resource_type ?? usage.resourceType),
      reservedAmount: optionalNumberValue(usage.reserved_amount ?? usage.reservedAmount),
      actualAmount: optionalNumberValue(usage.actual_amount ?? usage.actualAmount),
      state: stringValue(usage.state),
    } : null,
  }
}

function mapManagedJobListRecord(value: unknown): ManagedJobList {
  const source = asRecord(value)
  return {
    jobs: arrayValue(source.jobs ?? source.items ?? value).map(mapManagedJobRecord),
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapManagedJobRetryPlanRecord(value: unknown): ManagedJobRetryPlan {
  const source = asRecord(value)
  return {
    jobId: stringValue(source.job_id ?? source.jobId) ?? '',
    allowed: source.allowed === true,
    retryKind: stringValue(source.retry_kind ?? source.retryKind) ?? 'EXACT',
    nextAttemptNo: numberValue(source.next_attempt_no ?? source.nextAttemptNo, 0),
    maxAttempts: numberValue(source.max_attempts ?? source.maxAttempts, 0),
    reasonCode: stringValue(source.reason_code ?? source.reasonCode),
    nextStep: stringValue(source.next_step ?? source.nextStep),
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function safeBasename(value: unknown): string | undefined {
  const candidate = stringValue(value)?.trim()
  if (!candidate || candidate === '.' || candidate === '..') return undefined
  const basename = candidate.split(/[\\/]/).at(-1)?.trim()
  return basename && basename !== '.' && basename !== '..' ? basename.slice(0, 255) : undefined
}

function safeEvidenceState(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim().slice(0, 80) || undefined
  const source = asRecord(value)
  const state = stringValue(source.state ?? source.status ?? source.outcome ?? source.evidence_state ?? source.evidenceState)
  if (state) return state.slice(0, 80)
  return Object.keys(source).length > 0 ? 'PRESENT' : 'UNKNOWN'
}

function mapStagingEvidenceRecord(value: unknown): StagingEvidence {
  const source = asRecord(value)
  const state = stringValue(source.state ?? source.lifecycle_state ?? source.lifecycleState)?.trim().toUpperCase() || 'UNKNOWN'
  return {
    id: stringValue(source.id ?? source.staging_id ?? source.stagingId),
    importItemId: stringValue(source.import_item_id ?? source.importItemId),
    state,
    tempName: safeBasename(source.temp_name ?? source.tempName),
    expectedSize: optionalNumberValue(source.expected_size ?? source.expectedSize),
    currentSize: optionalNumberValue(source.current_size ?? source.currentSize),
    hashAlgorithm: stringValue(source.hash_algorithm ?? source.hashAlgorithm),
    sha256: stringValue(source.sha256 ?? source.content_hash ?? source.contentHash),
    sourcePathFingerprint: stringValue(source.source_path_fingerprint ?? source.sourcePathFingerprint),
    reparseState: stringValue(source.reparse_state ?? source.reparseState)?.trim().toUpperCase(),
    sourceFileIdentityState: safeEvidenceState(source.source_file_identity ?? source.sourceFileIdentity),
    osFileIdentityState: safeEvidenceState(source.os_file_identity ?? source.osFileIdentity),
    finalizationIdentityState: safeEvidenceState(source.finalization_identity ?? source.finalizationIdentity),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapStagingWorkspaceRecord(value: unknown): StagingWorkspace {
  const source = asRecord(value)
  return {
    items: arrayValue(source.items ?? source.staging_items ?? source.stagingItems).map(mapStagingEvidenceRecord),
    checkedCount: optionalNumberValue(source.checked_count ?? source.checkedCount),
    projectionSeq: optionalNumberValue(source.projection_seq ?? source.projectionSeq),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapStagingCommandResultRecord(value: unknown): StagingWorkspace {
  const source = asRecord(value)
  const staging = source.staging && typeof source.staging === 'object' && !Array.isArray(source.staging) ? source.staging : source
  return mapStagingWorkspaceRecord(staging)
}

const RELEASE_GATE_KEYS = new Set(['PICTURE', 'AUDIO', 'LOCALIZATION', 'TECHNICAL_MEDIA', 'QC', 'RIGHTS', 'MISSING_MEDIA', 'UNRESOLVED_DECISIONS'])
const RELEASE_GATE_STATES = new Set(['PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE'])
const RELEASE_EVIDENCE_KEYS = new Set([
  'asset_revision_id', 'asset_count', 'availability_state', 'availability_evidence_state', 'review_state',
  'asset_lifecycle_state', 'storage_class', 'location_state', 'rights_status', 'cue_count', 'track_count',
  'review_count', 'approved_candidate_count', 'clip_count', 'media_profile_revision_id', 'timeline_id',
  'timeline_revision_id', 'content_hash', 'state', 'width', 'height', 'audio_sample_rate', 'id', 'title',
  'severity', 'blocking_scope_type', 'stale', 'locale', 'segment_count', 'asset_state', 'review_session_id',
  'decision', 'count',
])

function mapReleaseEvidence(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (!RELEASE_EVIDENCE_KEYS.has(key)) continue
    if (Array.isArray(item)) {
      output[key] = item.slice(0, 200).map((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? mapReleaseEvidence(entry) : typeof entry === 'string' ? entry.slice(0, 512) : entry).filter((entry) => entry !== undefined)
    } else if (typeof item === 'object' && item !== null) {
      output[key] = mapReleaseEvidence(item)
    } else if (typeof item === 'string') {
      output[key] = item.slice(0, 512)
    } else if (typeof item === 'number' || typeof item === 'boolean' || item === null) {
      output[key] = item
    }
  }
  return output
}

function mapReleaseReadinessRecord(value: unknown): ReleaseReadiness {
  const source = asRecord(value)
  const rawGates = arrayValue(source.gates)
  const gates: ReleaseGate[] = rawGates.map((value) => {
    const item = asRecord(value)
    const key = String(item.key ?? '').trim().toUpperCase()
    const state = String(item.state ?? 'UNKNOWN').trim().toUpperCase()
    return {
      key,
      state: (RELEASE_GATE_STATES.has(state) ? state : 'UNKNOWN') as ReleaseGate['state'],
      blocking: item.blocking === true || state === 'FAIL' || state === 'UNKNOWN',
      reason: stringValue(item.reason),
      nextStep: stringValue(item.next_step ?? item.nextStep),
      evidence: mapReleaseEvidence(item.evidence),
    }
  }).filter((item) => RELEASE_GATE_KEYS.has(item.key))
  const policy = asRecord(source.policy)
  const overall = String(source.overall_state ?? source.overallState ?? 'NOT_CHECKED').trim().toUpperCase()
  const exactSource = mapReleaseEvidence(source.exact_source ?? source.exactSource)
  const rawBlocking = arrayValue(source.blocking_gate_keys ?? source.blockingGateKeys)
  const blockingGateKeys = rawBlocking.map((value) => String(value).trim().toUpperCase()).filter((value) => RELEASE_GATE_KEYS.has(value))
  return {
    projectId: stringValue(source.project_id ?? source.projectId),
    projectTitle: stringValue(source.project_title ?? source.projectTitle),
    overallState: (['READY', 'BLOCKED', 'NOT_CHECKED'].includes(overall) ? overall : 'NOT_CHECKED') as ReleaseReadiness['overallState'],
    policy: { purpose: stringValue(policy.purpose) ?? 'RELEASE', unknownBlocks: policy.unknown_blocks !== false && policy.unknownBlocks !== false },
    exactSource,
    gates,
    blockingGateKeys: blockingGateKeys.length > 0 ? blockingGateKeys : gates.filter((item) => item.blocking).map((item) => item.key),
    blockingCount: integerValue(source.blocking_count ?? source.blockingCount, 0, 0, 1000),
    unknownCount: integerValue(source.unknown_count ?? source.unknownCount, 0, 0, 1000),
    gateManifestHash: (() => {
      const hash = stringValue(source.gate_manifest_hash ?? source.gateManifestHash)
      return hash && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : undefined
    })(),
    nextStep: stringValue(source.next_step ?? source.nextStep),
    projectionSeq: integerValue(source.projection_seq ?? source.projectionSeq, 0, 0, Number.MAX_SAFE_INTEGER),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

const RELEASE_CANDIDATE_STATES = new Set(['DRAFT', 'CANCELLED'])
const RELEASE_CANDIDATE_HASH = /^[a-f0-9]{64}$/i

function safeReleaseCandidateText(value: unknown, maxLength = 512): string | undefined {
  const text = stringValue(value)
  if (!text) return undefined
  let safe = text.slice(0, maxLength).replace(/(?:[A-Za-z]:[\\/]|\\\\|(?:file|https?):\/\/)[^\s"'<>]*/gi, '[redacted]')
  safe = safe.replace(/(?:^|[\s(])\/(?:[^\/\s]+\/)+[^\/\s]*/g, (match) => match.startsWith('/') ? '[redacted]' : `${match[0]}[redacted]`)
  return safe
}

function mapReleaseCandidateRecord(value: unknown): ReleaseCandidate {
  const source = asRecord(value)
  const candidateSource = asRecord(source.candidate ?? source.release_candidate ?? source.releaseCandidate ?? source.result ?? source)
  const rawState = String(candidateSource.state ?? 'UNKNOWN').trim().toUpperCase()
  const rawVersion = Number(candidateSource.row_version ?? candidateSource.rowVersion)
  const hash = (key: string, camel: string) => {
    const candidate = stringValue(candidateSource[key] ?? candidateSource[camel])
    return candidate && RELEASE_CANDIDATE_HASH.test(candidate) ? candidate.toLowerCase() : undefined
  }
  return {
    id: stringValue(candidateSource.id ?? candidateSource.release_candidate_id ?? candidateSource.releaseCandidateId),
    projectId: stringValue(candidateSource.project_id ?? candidateSource.projectId),
    timelineRevisionId: stringValue(candidateSource.timeline_revision_id ?? candidateSource.timelineRevisionId),
    audioMasterAssetRevisionId: stringValue(candidateSource.audio_master_asset_revision_id ?? candidateSource.audioMasterAssetRevisionId),
    mediaProfileRevisionId: stringValue(candidateSource.media_profile_revision_id ?? candidateSource.mediaProfileRevisionId),
    reviewSessionId: stringValue(candidateSource.review_session_id ?? candidateSource.reviewSessionId),
    readinessDigest: hash('readiness_digest', 'readinessDigest'),
    rightsSnapshotHash: hash('rights_snapshot_hash', 'rightsSnapshotHash'),
    state: (RELEASE_CANDIDATE_STATES.has(rawState) ? rawState : 'UNKNOWN') as ReleaseCandidate['state'],
    nextStep: safeReleaseCandidateText(candidateSource.next_step ?? candidateSource.nextStep),
    rowVersion: Number.isSafeInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 0,
    snapshotSchemaVersion: integerValue(candidateSource.readiness_snapshot_schema_version ?? candidateSource.readinessSnapshotSchemaVersion, 1, 1, 100),
    createdAt: stringValue(candidateSource.created_at ?? candidateSource.createdAt),
    updatedAt: stringValue(candidateSource.updated_at ?? candidateSource.updatedAt),
    cancelledAt: stringValue(candidateSource.cancelled_at ?? candidateSource.cancelledAt),
    idempotentReplay: candidateSource.idempotent_replay === true || candidateSource.idempotentReplay === true,
  }
}

function mapReleaseCandidateListRecord(value: unknown): ReleaseCandidateList {
  const source = asRecord(value)
  const rows = Array.isArray(value) ? value : arrayValue(source.items ?? source.candidates ?? source.result)
  return {
    items: rows.map((item) => mapReleaseCandidateRecord(item)),
    projectionSeq: integerValue(source.projection_seq ?? source.projectionSeq, 0, 0, Number.MAX_SAFE_INTEGER),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapReleaseCandidateWorkspaceRecord(value: unknown): ReleaseCandidate {
  const source = asRecord(value)
  return mapReleaseCandidateRecord(source.candidate ?? source.release_candidate ?? source.releaseCandidate ?? source.result ?? source)
}

const RELEASE_BUILD_PLAN_STATES = new Set(['PLANNED'])

function mapReleaseBuildPlanRecord(value: unknown): ReleaseBuildPlan {
  const source = asRecord(value)
  const planSource = asRecord(source.build_plan ?? source.buildPlan ?? source.result ?? source)
  const rawState = String(planSource.state ?? 'UNKNOWN').trim().toUpperCase()
  const hash = (key: string, camel: string) => {
    const candidate = stringValue(planSource[key] ?? planSource[camel])
    return candidate && RELEASE_CANDIDATE_HASH.test(candidate) ? candidate.toLowerCase() : undefined
  }
  return {
    id: safeReleaseCandidateText(planSource.id ?? planSource.build_plan_id ?? planSource.buildPlanId, 160),
    projectId: safeReleaseCandidateText(planSource.project_id ?? planSource.projectId, 160),
    releaseCandidateId: safeReleaseCandidateText(planSource.release_candidate_id ?? planSource.releaseCandidateId, 160),
    timelineRevisionId: safeReleaseCandidateText(planSource.timeline_revision_id ?? planSource.timelineRevisionId, 160),
    mediaProfileRevisionId: safeReleaseCandidateText(planSource.media_profile_revision_id ?? planSource.mediaProfileRevisionId, 160),
    reviewSessionId: safeReleaseCandidateText(planSource.review_session_id ?? planSource.reviewSessionId, 160),
    readinessDigest: hash('readiness_digest', 'readinessDigest'),
    rightsSnapshotHash: hash('rights_snapshot_hash', 'rightsSnapshotHash'),
    planHash: hash('plan_hash', 'planHash'),
    state: (RELEASE_BUILD_PLAN_STATES.has(rawState) ? rawState : 'UNKNOWN') as ReleaseBuildPlan['state'],
    nextStep: safeReleaseCandidateText(planSource.next_step ?? planSource.nextStep),
    rowVersion: Number.isSafeInteger(Number(planSource.row_version ?? planSource.rowVersion)) && Number(planSource.row_version ?? planSource.rowVersion) >= 1 ? Number(planSource.row_version ?? planSource.rowVersion) : 0,
    snapshotSchemaVersion: integerValue(planSource.plan_snapshot_schema_version ?? planSource.planSnapshotSchemaVersion ?? planSource.snapshot_schema_version ?? planSource.snapshotSchemaVersion, 0, 1, 100),
    createdAt: safeReleaseCandidateText(planSource.created_at ?? planSource.createdAt, 80),
    updatedAt: safeReleaseCandidateText(planSource.updated_at ?? planSource.updatedAt, 80),
    idempotentReplay: planSource.idempotent_replay === true || planSource.idempotentReplay === true,
  }
}

function mapReleaseBuildPlanListRecord(value: unknown): ReleaseBuildPlanList {
  const source = asRecord(value)
  const resultValue = source.result
  const result = asRecord(resultValue)
  const rows = Array.isArray(value)
    ? value
    : arrayValue(source.items ?? source.build_plans ?? source.buildPlans ?? (Array.isArray(resultValue) ? resultValue : undefined) ?? result.items ?? result.build_plans ?? result.buildPlans)
  const metadata = Object.keys(result).length > 0 ? result : source
  return {
    items: rows.map((item) => mapReleaseBuildPlanRecord(item)),
    projectionSeq: integerValue(metadata.projection_seq ?? metadata.projectionSeq, 0, 0, Number.MAX_SAFE_INTEGER),
    generatedAt: stringValue(metadata.generated_at ?? metadata.generatedAt),
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

function mapAudioCueSummaryRecord(value: unknown): AudioCueSummary {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.audio_cue_id ?? source.audioCueId),
    projectId: stringValue(source.project_id ?? source.projectId),
    timelineId: stringValue(source.timeline_id ?? source.timelineId),
    cueType: stringValue(source.cue_type ?? source.cueType) ?? 'UNKNOWN',
    title: stringValue(source.title) ?? 'Audio cue',
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapAudioCueRevisionRecord(value: unknown): AudioCueRevision {
  const source = asRecord(value)
  const rational = (nestedKey: string, numKey: string, denKey: string): { num: number | string; den: number | string } => {
    const nested = source[nestedKey]
    return safeRationalRecord(nested ?? { num: source[numKey], den: source[denKey] })
  }
  return {
    id: stringValue(source.id ?? source.audio_cue_revision_id ?? source.audioCueRevisionId),
    audioCueId: stringValue(source.audio_cue_id ?? source.audioCueId),
    revisionNumber: numberValue(source.revision_number ?? source.revisionNumber, 0),
    state: stringValue(source.lifecycle_state ?? source.lifecycleState ?? source.state) ?? 'UNKNOWN',
    timelineRevisionId: stringValue(source.timing_dependency_revision_id ?? source.timingDependencyRevisionId ?? source.timeline_revision_id ?? source.timelineRevisionId),
    timelineContentHash: stringValue(source.timing_dependency_content_hash ?? source.timingDependencyContentHash ?? source.timeline_content_hash ?? source.timelineContentHash)?.toLowerCase(),
    timingDependencyRevisionId: stringValue(source.timing_dependency_revision_id ?? source.timingDependencyRevisionId ?? source.timeline_revision_id ?? source.timelineRevisionId),
    timingDependencyContentHash: stringValue(source.timing_dependency_content_hash ?? source.timingDependencyContentHash ?? source.timeline_content_hash ?? source.timelineContentHash)?.toLowerCase(),
    timingDependencyHash: stringValue(source.timing_dependency_hash ?? source.timingDependencyHash)?.toLowerCase(),
    start: rational('start', 'start_num', 'start_den'),
    end: rational('end', 'end_num', 'end_den'),
    intentText: stringValue(source.intent_text ?? source.intentText) ?? '',
    selectedAssetRevisionId: stringValue(source.selected_asset_revision_id ?? source.selectedAssetRevisionId) ?? null,
    assetSnapshotHash: stringValue(source.asset_snapshot_hash ?? source.assetSnapshotHash)?.toLowerCase() ?? null,
    assetGate: source.asset_gate || source.assetGate ? (() => {
      const gate = asRecord(source.asset_gate ?? source.assetGate)
      return {
        state: stringValue(gate.state) ?? 'UNKNOWN',
        rightsStatus: stringValue(gate.rights_status ?? gate.rightsStatus) ?? null,
        materializationState: stringValue(gate.materialization_state ?? gate.materializationState) ?? null,
        reason: stringValue(gate.reason) ?? null,
      }
    })() : null,
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    stale: Boolean(source.stale) || String(source.lifecycle_state ?? source.lifecycleState ?? source.state).toUpperCase() === 'STALE',
    staleReason: stringValue(source.stale_reason ?? source.staleReason) ?? null,
    nextStep: stringValue(source.next_step ?? source.nextStep) ?? null,
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapSubtitleTrackSummaryRecord(value: unknown): SubtitleTrackSummary {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.subtitle_track_id ?? source.subtitleTrackId),
    projectId: stringValue(source.project_id ?? source.projectId),
    timelineId: stringValue(source.timeline_id ?? source.timelineId),
    locale: stringValue(source.locale) ?? 'UNKNOWN',
    title: stringValue(source.title) ?? 'Subtitle track',
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    createdAt: stringValue(source.created_at ?? source.createdAt),
    updatedAt: stringValue(source.updated_at ?? source.updatedAt),
  }
}

function mapSubtitleSegmentRecord(value: unknown): SubtitleSegment {
  const source = asRecord(value)
  const rational = (nestedKey: string, numKey: string, denKey: string): { num: number | string; den: number | string } => {
    const nested = source[nestedKey]
    return safeRationalRecord(nested ?? { num: source[numKey], den: source[denKey] })
  }
  return {
    id: stringValue(source.id),
    segmentIndex: numberValue(source.segment_index ?? source.segmentIndex, 0),
    start: rational('start', 'start_num', 'start_den'),
    end: rational('end', 'end_num', 'end_den'),
    locale: stringValue(source.locale) ?? 'UNKNOWN',
    text: stringValue(source.text) ?? '',
  }
}

function mapSubtitleTrackRevisionRecord(value: unknown): SubtitleTrackRevision {
  const source = asRecord(value)
  return {
    id: stringValue(source.id ?? source.subtitle_track_revision_id ?? source.subtitleTrackRevisionId),
    subtitleTrackId: stringValue(source.subtitle_track_id ?? source.subtitleTrackId),
    revisionNumber: numberValue(source.revision_number ?? source.revisionNumber, 0),
    state: stringValue(source.lifecycle_state ?? source.lifecycleState ?? source.state) ?? 'UNKNOWN',
    timelineRevisionId: stringValue(source.timing_dependency_revision_id ?? source.timingDependencyRevisionId ?? source.timeline_revision_id ?? source.timelineRevisionId),
    timelineContentHash: stringValue(source.timing_dependency_content_hash ?? source.timingDependencyContentHash ?? source.timeline_content_hash ?? source.timelineContentHash)?.toLowerCase(),
    timingDependencyRevisionId: stringValue(source.timing_dependency_revision_id ?? source.timingDependencyRevisionId ?? source.timeline_revision_id ?? source.timelineRevisionId),
    timingDependencyContentHash: stringValue(source.timing_dependency_content_hash ?? source.timingDependencyContentHash ?? source.timeline_content_hash ?? source.timelineContentHash)?.toLowerCase(),
    timingDependencyHash: stringValue(source.timing_dependency_hash ?? source.timingDependencyHash)?.toLowerCase(),
    formatProfile: stringValue(source.format_profile ?? source.formatProfile) ?? 'TEXT',
    segments: arrayValue(source.segments).map(mapSubtitleSegmentRecord),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    stale: Boolean(source.stale) || String(source.lifecycle_state ?? source.lifecycleState ?? source.state).toUpperCase() === 'STALE',
    staleReason: stringValue(source.stale_reason ?? source.staleReason) ?? null,
    nextStep: stringValue(source.next_step ?? source.nextStep) ?? null,
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapAudioCueResultRecord(value: unknown): { audioCue: AudioCueSummary | null; revision: AudioCueRevision | null } {
  const envelope = asRecord(value)
  const source = asRecord(envelope.result ?? value)
  return {
    audioCue: source.audio_cue || source.audioCue ? mapAudioCueSummaryRecord(source.audio_cue ?? source.audioCue) : null,
    revision: source.revision ? mapAudioCueRevisionRecord(source.revision) : null,
  }
}

function mapSubtitleTrackResultRecord(value: unknown): { subtitleTrack: SubtitleTrackSummary | null; revision: SubtitleTrackRevision | null } {
  const envelope = asRecord(value)
  const source = asRecord(envelope.result ?? value)
  return {
    subtitleTrack: source.subtitle_track || source.subtitleTrack ? mapSubtitleTrackSummaryRecord(source.subtitle_track ?? source.subtitleTrack) : null,
    revision: source.revision ? mapSubtitleTrackRevisionRecord(source.revision) : null,
  }
}

function mapAudioTimingRecord(value: unknown): AudioCueTiming {
  const envelope = asRecord(value)
  const source = asRecord(envelope.result ?? value)
  return {
    timeline: source.timeline ? mapTimelineSummaryRecord(source.timeline) : null,
    timelineRevision: source.timeline_revision || source.timelineRevision ? mapTimelineRevisionRecord(source.timeline_revision ?? source.timelineRevision) : null,
    cues: arrayValue(source.cues).map((item) => {
      const row = asRecord(item)
      return {
        audioCue: row.audio_cue || row.audioCue ? mapAudioCueSummaryRecord(row.audio_cue ?? row.audioCue) : null,
        revision: row.revision ? mapAudioCueRevisionRecord(row.revision) : null,
      }
    }),
    projectionSeq: numberValue(source.projection_seq ?? source.projectionSeq, 0),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapSubtitleTimingRecord(value: unknown): SubtitleTiming {
  const envelope = asRecord(value)
  const source = asRecord(envelope.result ?? value)
  return {
    timeline: source.timeline ? mapTimelineSummaryRecord(source.timeline) : null,
    timelineRevision: source.timeline_revision || source.timelineRevision ? mapTimelineRevisionRecord(source.timeline_revision ?? source.timelineRevision) : null,
    tracks: arrayValue(source.tracks).map((item) => {
      const row = asRecord(item)
      return {
        subtitleTrack: row.subtitle_track || row.subtitleTrack ? mapSubtitleTrackSummaryRecord(row.subtitle_track ?? row.subtitleTrack) : null,
        revision: row.revision ? mapSubtitleTrackRevisionRecord(row.revision) : null,
      }
    }),
    projectionSeq: numberValue(source.projection_seq ?? source.projectionSeq, 0),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

function mapTimelineTimingImpactRecord(value: unknown): TimelineTimingImpact {
  const envelope = asRecord(value)
  const source = asRecord(envelope.result ?? value)
  const mapItem = (item: unknown) => {
    const row = asRecord(item)
    return {
      audioCueId: stringValue(row.audio_cue_id ?? row.audioCueId),
      audioCueRevisionId: stringValue(row.audio_cue_revision_id ?? row.audioCueRevisionId),
      subtitleTrackId: stringValue(row.subtitle_track_id ?? row.subtitleTrackId),
      subtitleTrackRevisionId: stringValue(row.subtitle_track_revision_id ?? row.subtitleTrackRevisionId),
      timelineRevisionId: stringValue(row.timeline_revision_id ?? row.timelineRevisionId),
      state: stringValue(row.lifecycle_state ?? row.lifecycleState ?? row.state) ?? 'UNKNOWN',
      stale: Boolean(row.stale),
      nextStep: stringValue(row.next_step ?? row.nextStep) ?? null,
    }
  }
  const counts = asRecord(source.counts)
  return {
    timeline: source.timeline ? mapTimelineSummaryRecord(source.timeline) : null,
    pinnedTimelineRevisionId: stringValue(source.pinned_timeline_revision_id ?? source.pinnedTimelineRevisionId),
    audioCues: arrayValue(source.audio_cues ?? source.audioCues).map(mapItem),
    subtitleTracks: arrayValue(source.subtitle_tracks ?? source.subtitleTracks).map(mapItem),
    counts: {
      audioCues: numberValue(counts.audio_cues ?? counts.audioCues, 0),
      subtitleTracks: numberValue(counts.subtitle_tracks ?? counts.subtitleTracks, 0),
      staleAudioCues: numberValue(counts.stale_audio_cues ?? counts.staleAudioCues, 0),
      staleSubtitleTracks: numberValue(counts.stale_subtitle_tracks ?? counts.staleSubtitleTracks, 0),
      staleTotal: numberValue(counts.stale_total ?? counts.staleTotal, 0),
    },
    projectionSeq: numberValue(source.projection_seq ?? source.projectionSeq, 0),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
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

function mapTimelineWorkingWorkspaceRecord(value: unknown): TimelineWorkingWorkspace {
  const envelope = asRecord(value)
  const timeline = envelope.timeline ? mapTimelineSummaryRecord(envelope.timeline) : null
  const sessionValue = envelope.session ? asRecord(envelope.session) : null
  const draftValue = sessionValue ? asRecord(sessionValue.draft) : {}
  const mapWorkingMarker = (item: unknown): TimelineMarker => {
    const source = asRecord(item)
    return {
      id: stringValue(source.id ?? source.marker_id ?? source.markerId),
      time: safeRationalRecord(source.time ?? source.position ?? { num: source.time_num ?? source.timeNum, den: source.time_den ?? source.timeDen }),
      markerType: stringValue(source.marker_type ?? source.markerType ?? source.type) ?? 'NOTE',
      label: stringValue(source.label ?? source.name) ?? '',
      payload: asRecord(source.payload),
    }
  }
  const draft = {
    schemaVersion: numberValue(draftValue.schema_version ?? draftValue.schemaVersion, 1),
    mediaProfileRevisionId: stringValue(draftValue.media_profile_revision_id ?? draftValue.mediaProfileRevisionId),
    duration: safeRationalRecord(draftValue.duration ?? { num: draftValue.duration_num ?? draftValue.durationNum, den: draftValue.duration_den ?? draftValue.durationDen }),
    tracks: arrayValue(draftValue.tracks ?? draftValue.timeline_tracks ?? draftValue.timelineTracks).map(mapTimelineTrackRecord),
    markers: arrayValue(draftValue.markers ?? draftValue.timeline_markers ?? draftValue.timelineMarkers).map(mapWorkingMarker),
  }
  const operations = sessionValue ? arrayValue(sessionValue.operations).map((item) => {
    const source = asRecord(item)
    return {
      id: stringValue(source.id), opSeq: numberValue(source.op_seq ?? source.opSeq, 0), opType: stringValue(source.op_type ?? source.opType) ?? 'UNKNOWN',
      historyState: stringValue(source.history_state ?? source.historyState) ?? 'ACTIVE', resultHash: stringValue(source.result_hash ?? source.resultHash),
      actorId: stringValue(source.actor_id ?? source.actorId), createdAt: stringValue(source.created_at ?? source.createdAt),
    }
  }) : []
  const historyActions = sessionValue ? arrayValue(sessionValue.history_actions ?? sessionValue.historyActions).map((item) => {
    const source = asRecord(item)
    return {
      id: stringValue(source.id), actionSeq: numberValue(source.action_seq ?? source.actionSeq, 0), actionType: stringValue(source.action_type ?? source.actionType) ?? 'UNKNOWN',
      targetOpSeq: (source.target_op_seq ?? source.targetOpSeq) === null || (source.target_op_seq ?? source.targetOpSeq) === undefined ? null : numberValue(source.target_op_seq ?? source.targetOpSeq, 0), targetOpId: stringValue(source.target_op_id ?? source.targetOpId),
      beforeHash: stringValue(source.before_hash ?? source.beforeHash), afterHash: stringValue(source.after_hash ?? source.afterHash),
      actorId: stringValue(source.actor_id ?? source.actorId), createdAt: stringValue(source.created_at ?? source.createdAt),
    }
  }) : []
  const session = sessionValue ? {
    id: stringValue(sessionValue.id ?? sessionValue.working_session_id ?? sessionValue.workingSessionId),
    timelineId: stringValue(sessionValue.timeline_id ?? sessionValue.timelineId),
    baseRevisionId: stringValue(sessionValue.base_revision_id ?? sessionValue.baseRevisionId),
    baseRevisionRowVersion: numberValue(sessionValue.base_revision_row_version ?? sessionValue.baseRevisionRowVersion, 0),
    baseContentHash: stringValue(sessionValue.base_content_hash ?? sessionValue.baseContentHash),
    actorId: stringValue(sessionValue.actor_id ?? sessionValue.actorId), clientInstanceId: stringValue(sessionValue.client_instance_id ?? sessionValue.clientInstanceId),
    mode: stringValue(sessionValue.mode) ?? 'EXCLUSIVE', state: stringValue(sessionValue.state) ?? 'UNKNOWN',
    draftHash: stringValue(sessionValue.draft_hash ?? sessionValue.draftHash), autosavedHash: stringValue(sessionValue.autosaved_hash ?? sessionValue.autosavedHash),
    draft, lastAcknowledgedOpSeq: numberValue(sessionValue.last_acknowledged_op_seq ?? sessionValue.lastAcknowledgedOpSeq, 0), historyCursorSeq: numberValue(sessionValue.history_cursor_seq ?? sessionValue.historyCursorSeq, 0), nextOpSeq: numberValue(sessionValue.next_op_seq ?? sessionValue.nextOpSeq, 1),
    lastCheckpointRevisionId: stringValue(sessionValue.last_checkpoint_revision_id ?? sessionValue.lastCheckpointRevisionId), nextStep: stringValue(sessionValue.next_step ?? sessionValue.nextStep), rowVersion: numberValue(sessionValue.row_version ?? sessionValue.rowVersion, 1),
    lastAutosaveAt: stringValue(sessionValue.last_autosave_at ?? sessionValue.lastAutosaveAt), createdAt: stringValue(sessionValue.created_at ?? sessionValue.createdAt), updatedAt: stringValue(sessionValue.updated_at ?? sessionValue.updatedAt), closedAt: stringValue(sessionValue.closed_at ?? sessionValue.closedAt),
    operations, historyActions,
  } : null
  const checkpoint = envelope.checkpoint_revision ?? envelope.checkpointRevision
  const mapOperationRef = (item: unknown) => {
    const source = asRecord(item)
    return Object.keys(source).length === 0 ? null : {
      id: stringValue(source.id), opSeq: numberValue(source.op_seq ?? source.opSeq, 0), opType: stringValue(source.op_type ?? source.opType) ?? 'UNKNOWN',
    }
  }
  return {
    timeline,
    session,
    checkpointRevision: checkpoint ? mapTimelineRevisionRecord(checkpoint) : null,
    checkpointRevisionId: stringValue(envelope.checkpoint_revision_id ?? envelope.checkpointRevisionId),
    acceptedOperations: arrayValue(envelope.accepted_operations ?? envelope.acceptedOperations).map((item) => {
      const source = asRecord(item)
      return { id: stringValue(source.id), opSeq: numberValue(source.op_seq ?? source.opSeq, 0), opType: stringValue(source.op_type ?? source.opType) ?? 'UNKNOWN', historyState: 'ACTIVE', resultHash: stringValue(source.result_hash ?? source.resultHash) }
    }),
    timelineRowVersion: numberValue(envelope.timeline_row_version ?? envelope.timelineRowVersion, 0),
    impactSummary: envelope.impact_summary ?? envelope.impactSummary,
    undoneOperation: mapOperationRef(envelope.undone_operation ?? envelope.undoneOperation),
    redoneOperation: mapOperationRef(envelope.redone_operation ?? envelope.redoneOperation),
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0), generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
    idempotentReplay: Boolean(envelope.idempotent_replay ?? envelope.idempotentReplay),
  }
}

function mapTimelineWorkingHistoryRecord(value: unknown): TimelineWorkingHistory {
  const envelope = asRecord(value)
  const mapOperation = (item: unknown) => {
    const source = asRecord(item)
    return {
      id: stringValue(source.id), opSeq: numberValue(source.op_seq ?? source.opSeq, 0), opType: stringValue(source.op_type ?? source.opType) ?? 'UNKNOWN',
      historyState: stringValue(source.history_state ?? source.historyState) ?? 'ACTIVE', resultHash: stringValue(source.result_hash ?? source.resultHash),
      actorId: stringValue(source.actor_id ?? source.actorId), createdAt: stringValue(source.created_at ?? source.createdAt),
    }
  }
  const mapAction = (item: unknown) => {
    const source = asRecord(item)
    return {
      id: stringValue(source.id), actionSeq: numberValue(source.action_seq ?? source.actionSeq, 0), actionType: stringValue(source.action_type ?? source.actionType) ?? 'UNKNOWN',
      targetOpSeq: (source.target_op_seq ?? source.targetOpSeq) === null || (source.target_op_seq ?? source.targetOpSeq) === undefined ? null : numberValue(source.target_op_seq ?? source.targetOpSeq, 0),
      targetOpId: stringValue(source.target_op_id ?? source.targetOpId), beforeHash: stringValue(source.before_hash ?? source.beforeHash), afterHash: stringValue(source.after_hash ?? source.afterHash),
      actorId: stringValue(source.actor_id ?? source.actorId), createdAt: stringValue(source.created_at ?? source.createdAt),
    }
  }
  const cursor = asRecord(envelope.cursor)
  return {
    timeline: envelope.timeline ? mapTimelineSummaryRecord(envelope.timeline) : null,
    workingSessionId: stringValue(envelope.working_session_id ?? envelope.workingSessionId),
    operations: arrayValue(envelope.operations).map(mapOperation), historyActions: arrayValue(envelope.history_actions ?? envelope.historyActions).map(mapAction),
    cursor: { afterOpSeq: numberValue(cursor.after_op_seq ?? cursor.afterOpSeq, 0), hasMore: Boolean(cursor.has_more ?? cursor.hasMore) },
    projectionSeq: numberValue(envelope.projection_seq ?? envelope.projectionSeq, 0), generatedAt: stringValue(envelope.generated_at ?? envelope.generatedAt),
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
  const validation = asRecord(source.validation_snapshot ?? source.validationSnapshot)
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
    outputAssetRevisionId: stringValue(source.output_asset_revision_id ?? source.outputAssetRevisionId),
    outputContentHash: stringValue(source.output_content_hash ?? source.outputContentHash),
    outputByteSize: numberValue(source.output_byte_size ?? source.outputByteSize, 0),
    validationSnapshot: Object.keys(validation).length > 0 ? {
      schemaVersion: numberValue(validation.schema_version ?? validation.schemaVersion, 0),
      exportProfile: stringValue(validation.export_profile ?? validation.exportProfile),
      artifactCount: numberValue(validation.artifact_count ?? validation.artifactCount, 0),
      clipCount: numberValue(validation.clip_count ?? validation.clipCount, 0),
      documentHash: stringValue(validation.document_hash ?? validation.documentHash),
      verifiedAt: stringValue(validation.verified_at ?? validation.verifiedAt),
      errorCode: stringValue(validation.error_code ?? validation.errorCode),
    } : undefined,
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

function mapExternalEditRecord(value: unknown): ExternalEdit {
  const source = asRecord(value)
  const diffs = arrayValue(source.contract_diffs ?? source.contractDiffs).map((raw) => {
    const item = asRecord(raw)
    return {
      id: stringValue(item.id),
      externalEditId: stringValue(item.external_edit_id ?? item.externalEditId),
      projectId: stringValue(item.project_id ?? item.projectId),
      diffType: stringValue(item.diff_type ?? item.diffType),
      severity: stringValue(item.severity),
      before: asRecord(item.before),
      after: asRecord(item.after),
      resolutionState: stringValue(item.resolution_state ?? item.resolutionState),
      createdByActorId: stringValue(item.created_by_actor_id ?? item.createdByActorId),
      createdAt: stringValue(item.created_at ?? item.createdAt),
    }
  })
  const rawConfidence = stringValue(source.lineage_confidence ?? source.lineageConfidence) ?? 'UNKNOWN'
  const lineageConfidence: ExternalEditLineageConfidence = ['EXACT', 'PARTIAL', 'FLATTENED', 'UNKNOWN'].includes(rawConfidence.toUpperCase()) ? rawConfidence.toUpperCase() as ExternalEditLineageConfidence : 'UNKNOWN'
  return {
    id: stringValue(source.id ?? source.external_edit_id ?? source.externalEditId),
    projectId: stringValue(source.project_id ?? source.projectId),
    handoffManifestId: stringValue(source.handoff_manifest_id ?? source.handoffManifestId),
    exportSessionId: stringValue(source.export_session_id ?? source.exportSessionId),
    timelineRevisionId: stringValue(source.timeline_revision_id ?? source.timelineRevisionId),
    returnedAssetRevisionId: stringValue(source.returned_asset_revision_id ?? source.returnedAssetRevisionId),
    returnedInterchangeAssetRevisionId: stringValue(source.returned_interchange_asset_revision_id ?? source.returnedInterchangeAssetRevisionId),
    lineageConfidence,
    validationState: stringValue(source.validation_state ?? source.validationState) ?? 'UNKNOWN',
    sourceDocumentHash: stringValue(source.source_document_hash ?? source.sourceDocumentHash),
    sourceDocumentByteSize: numberValue(source.source_document_byte_size ?? source.sourceDocumentByteSize, 0),
    sourceManifestHash: stringValue(source.source_manifest_hash ?? source.sourceManifestHash),
    sourceRevisionContentHash: stringValue(source.source_revision_content_hash ?? source.sourceRevisionContentHash),
    sourceDependencySnapshotHash: stringValue(source.source_dependency_snapshot_hash ?? source.sourceDependencySnapshotHash),
    sourceReviewSessionId: stringValue(source.source_review_session_id ?? source.sourceReviewSessionId),
    returnedRightsStatus: (stringValue(source.returned_rights_status ?? source.returnedRightsStatus) ?? 'UNKNOWN') as RightsState,
    validationSnapshot: asRecord(source.validation_snapshot ?? source.validationSnapshot),
    contractDiffCount: numberValue(source.contract_diff_count ?? source.contractDiffCount, diffs.length),
    contractDiffs: diffs,
    nextStep: stringValue(source.next_step ?? source.nextStep),
    rowVersion: numberValue(source.row_version ?? source.rowVersion, 1),
    commandId: stringValue(source.command_id ?? source.commandId),
    createdAt: stringValue(source.created_at ?? source.createdAt),
  }
}

function mapExternalEditListRecord(value: unknown): ExternalEditList {
  const source = asRecord(value)
  return {
    items: arrayValue(source.items ?? source.external_edits ?? source.externalEdits).map(mapExternalEditRecord),
    projectionSeq: numberValue(source.projection_seq ?? source.projectionSeq, 0),
    generatedAt: stringValue(source.generated_at ?? source.generatedAt),
  }
}

/** Injectable factory for Tauri, browser, and deterministic tests. */
export function createCoreClient(bridge?: CoreBridge): CoreClient {
  if (bridge) return bridge
  return new HttpCoreClient()
}
