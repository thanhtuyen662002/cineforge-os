export type Locale = 'vi' | 'en'
export type Theme = 'light' | 'dark'
export type WorkState = 'running' | 'needs_user' | 'complete' | 'blocked' | 'waiting'

export interface ProjectSummary {
  id: string
  name: string
  kind: string
  updatedAt: string
  stage: string
  stageDetail: string
  cover: string
  accent: string
  completion: { done: number; total: number }
  health: 'healthy' | 'attention' | 'blocked'
  nextAction: string
  nextActionLabel: string
  storage: string
  productionItems?: ProductionItem[]
}

export interface ProductionItem {
  id: string
  title: string
  detail: string
  state: 'todo' | 'in_progress' | 'blocked' | 'cancelled' | 'done'
}

export type TaskStatus = 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'
export type ShotLifecycleState = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'TRASHED'
export type WorkspaceNoteEntityType = 'PROJECT' | 'TASK' | 'SHOT'
export type DecisionState = 'OPEN' | 'RESOLVED' | 'DISMISSED' | 'EXPIRED' | 'OBSOLETE'

export interface DecisionChoice {
  id: string
  labelKey?: string
  label: string
  commandTemplate?: unknown
  consequenceSummary?: unknown
  recommended?: boolean
}

/** First-class planning records. A task is not a shot and a planning shot is
 * not evidence that media has been generated, reviewed, or approved. */
export interface TaskSummary {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  priority: number
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface ShotSummary {
  id: string
  projectId: string
  code: string
  title: string
  lifecycleState: ShotLifecycleState
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface NoteSummary {
  id: string
  projectId: string
  entityType: WorkspaceNoteEntityType
  entityId: string
  body: string
  createdAt?: string
}

export type CharacterRevisionKind = 'visual' | 'voice' | 'performance'

/** Revision metadata is intentionally separate from CharacterIdentity. A
 * character never owns a provider voice id, outfit, or image field directly. */
export interface CharacterRevision {
  id: string
  kind: CharacterRevisionKind
  revisionNumber?: number
  state: string
  approvalState?: string
  createdAt?: string
  updatedAt?: string
  semanticDescription?: string
  readinessState?: string
  nextStep?: string
  canonicalLanguage?: string
  rightsStatus?: string
  rights?: RightsSummary | null
  rightsIdentityId?: string
  bindingState?: string
  referenceCount?: number
  behaviorSummary?: string
}

export interface CharacterPackage {
  id?: string
  approvedRevision: CharacterRevision | null
  candidateRevisions: CharacterRevision[]
}

export interface CharacterSummary {
  id: string
  projectId?: string
  stableCode?: string
  displayName: string
  lifecycleState: string
  rowVersion: number
  createdAt?: string
  updatedAt?: string
  visualIdentityPackage: CharacterPackage | null
  voiceIdentityPackage: CharacterPackage | null
  performanceBible: CharacterPackage | null
  costumeState?: unknown
  propState?: unknown
  continuityState?: unknown
  rights?: Record<string, unknown> | null
  usage?: Record<string, unknown> | null
  needsYou: unknown[]
}

export interface CharacterWorkspace {
  character: CharacterSummary
  generatedAt?: string
  projectionSeq?: number
  usage?: Record<string, unknown> | null
  rights?: Record<string, unknown> | null
  needsYou: unknown[]
}

export interface CharacterRevisionInput {
  semanticDescription?: string
  canonicalLanguage?: string
  rightsIdentityId?: string
  fields?: Record<string, unknown>
}

/** Canonical media/timeline time is a checked rational. The UI keeps large
 * components as strings when Core cannot represent them as safe JS integers;
 * it never converts them to floating-point seconds. */
export interface RationalValue {
  num: number | string
  den: number | string
}

export type MediaProfileRevisionState = 'DRAFT' | 'CANDIDATE' | 'APPROVED' | 'SUPERSEDED' | 'REJECTED' | string

export interface MediaProfileRevision {
  id?: string
  profileId?: string
  projectId?: string
  revisionNumber?: number
  state: MediaProfileRevisionState
  rowVersion: number
  timelineRate: RationalValue
  timeBase: RationalValue
  dropFramePolicy: string
  width: number
  height: number
  pixelAspect: RationalValue
  workingColorSpace: string
  transferFunction: string
  hdrPolicy: string
  audioSampleRate: number
  audioChannelLayout: string
  createdAt?: string
}

export interface MediaProfileWorkspace {
  profile: { id?: string; projectId?: string }
  revisions: MediaProfileRevision[]
  approvedRevision: MediaProfileRevision | null
  candidateRevisions: MediaProfileRevision[]
  projectionSeq?: number
  generatedAt?: string
}

export interface MediaProfileInput {
  timelineRate: RationalValue
  timeBase: RationalValue
  pixelAspect: RationalValue
  width: number
  height: number
  dropFramePolicy?: string
  workingColorSpace: string
  transferFunction: string
  hdrPolicy: string
  audioSampleRate: number
  audioChannelLayout: string
  proxyProfile?: Record<string, unknown>
  masteringTargets?: Record<string, unknown>
}

export type TimelineRevisionState = 'DRAFT_CHECKPOINT' | 'CANDIDATE' | 'APPROVED' | 'SUPERSEDED' | string

export interface TimelineMarker {
  id?: string
  time: RationalValue
  markerType: string
  label: string
}

export interface TimelineClip {
  id?: string
  assetRevisionId?: string
  timelineIn: RationalValue
  timelineOut: RationalValue
  sourceIn?: RationalValue | null
  sourceOut?: RationalValue | null
  speed: RationalValue
  label?: string
}

export interface TimelineTrack {
  id?: string
  trackType: string
  orderIndex: number
  name: string
  enabled: boolean
  clips: TimelineClip[]
}

export interface TimelineRevision {
  id?: string
  timelineId?: string
  mediaProfileRevisionId?: string
  revisionNumber?: number
  state: TimelineRevisionState
  rowVersion: number
  duration: RationalValue
  editHash?: string
  tracks: TimelineTrack[]
  markers: TimelineMarker[]
  readinessState: string
  nextStep?: string
  createdAt?: string
}

export interface TimelineSummary {
  id?: string
  projectId?: string
  scopeType: string
  scopeId?: string
  code?: string
  title: string
  state: string
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface TimelineWorkspace {
  timeline: TimelineSummary
  mediaProfile: MediaProfileWorkspace | null
  revisions: TimelineRevision[]
  currentRevision: TimelineRevision | null
  needsYou: unknown[]
  projectionSeq?: number
  generatedAt?: string
}

export type ReviewSessionState = 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'STALE' | string
export type HumanReviewDecision = 'APPROVE' | 'REJECT' | 'REPAIR' | 'ABSTAIN' | string

export interface HumanReview {
  id?: string
  reviewSessionId?: string
  decision: HumanReviewDecision
  notes: string
  reasonCodes: string[]
  dependencySnapshotHash?: string
  subjectContentHash?: string
  reviewerActorId?: string
  reviewedAt?: string
}

export interface ReviewSession {
  id?: string
  projectId?: string
  subjectType: 'TIMELINE_REVISION' | string
  subjectId?: string
  subjectRevisionId?: string
  representationAssetRevisionId?: string | null
  dependencySnapshotHash?: string
  subjectContentHash?: string
  mediaProfileRevisionId?: string
  state: ReviewSessionState
  stale: boolean
  reviewerActorId?: string
  openedAt?: string
  submittedAt?: string
  rowVersion: number
  nextStep?: string | null
  humanReview?: HumanReview | null
}

export interface ReviewWorkspace {
  review: ReviewSession | null
  subject: TimelineRevision | null
  timeline: TimelineSummary | null
  mediaProfileRevision?: MediaProfileRevision | null
  snapshot: { hash?: string; currentHash?: string; stale: boolean } | null
  projectionSeq?: number
  generatedAt?: string
}

export interface TimelineInput {
  title: string
  code?: string
  scopeType?: 'PROJECT'
  scopeId?: string
  /** Approved media profile revision pinned by the timeline. */
  mediaProfileRevisionId: string
}

export interface TimelineSnapshotInput {
  mediaProfileRevisionId: string
  /** Positive checked rational duration for this immutable checkpoint. */
  duration: RationalValue
  tracks: Array<Partial<TimelineTrack> & { trackType: 'VIDEO'; clips: TimelineClip[] }>
  markers: TimelineMarker[]
}

export type RightsState = 'ALLOWED' | 'RESTRICTED' | 'UNKNOWN' | 'REVOKED' | 'EXPIRED'

export interface RightsSummary {
  status: RightsState
  state?: RightsState
  eligible: boolean
  rightsIdentityId?: string
  rightType?: string
  consentType?: string | null
  rightStatus?: RightsState
  consentStatus?: RightsState
  blockers: Array<Record<string, unknown>>
  evidence: Array<Record<string, unknown>>
  evaluatedAt?: string
  identity?: Record<string, unknown> | null
}

export interface DecisionRequest {
  id: string
  projectId: string
  projectName: string
  decisionType: string
  title: string
  titleKey?: string
  detail: string
  reason: string
  reasonKey?: string
  reasonArgs?: Record<string, unknown>
  blockingScopeType: string
  blockingScopeId?: string
  severity: 'HIGH' | 'NORMAL' | string
  state: DecisionState
  decisionVersion: number
  choices: DecisionChoice[]
  recommendedChoiceId?: string
  deadlineAt?: string
  defaultBehavior?: string
  requiredAuthority?: string
  evidence?: unknown[]
  resolvedChoiceId?: string
  createdAt?: string
  resolvedAt?: string
  age: string
  priority: 'high' | 'normal'
  actionLabel: string
}

export interface ActivityItem {
  id: string
  /** Stable Core project identity; projectName remains display-only. */
  projectId?: string
  projectName: string
  label: string
  detail: string
  state: WorkState
  milestone?: string
  updatedAt: string
  actionable?: boolean
}

export interface AssetSummary {
  id: string
  projectId?: string
  name: string
  assetType: string
  originType: string
  state: string
  availability: string
  readinessState: 'UNKNOWN' | 'READY' | 'REVIEW_REQUIRED'
  revisionId?: string
  hashAlgorithm?: string
  contentHash?: string
  byteSize: number
  storageUri?: string
  provenance?: { source_name?: string; [key: string]: unknown } | null
  importSessionId?: string
  importItemId?: string
  warnings: string[]
  rights?: RightsSummary
  latestRevision?: unknown
}

export interface StagedAsset {
  handle: string
  name: string
  mimeType?: string
  byteSize: number
}

export interface ImportAssetInput {
  sourcePath?: string
  sourceHandle?: string
  projectId?: string
  originalName?: string
  displayName?: string
  assetType?: string
  semanticRole?: string
  storageMode?: 'COPY' | 'REFERENCE'
  contentHash?: string
  mimeType?: string
  intentHint?: string
  idempotencyKey?: string
}

/**
 * A project workspace is a Core-owned read model. Tasks, planning shots, and
 * append-only notes remain separate canonical records; productionItems is a
 * compact compatibility projection for older dashboard surfaces.
 */
export interface ProjectWorkspace {
  projectId: string
  productionItems: ProductionItem[]
  tasks: TaskSummary[]
  shots: ShotSummary[]
  notes: NoteSummary[]
  shotsCount: number
  notesCount: number
  projectionSeq?: number
  generatedAt?: string
}

export interface DashboardSnapshot {
  generatedAt: string
  projects: ProjectSummary[]
  decisions: DecisionRequest[]
  activity: ActivityItem[]
  system: {
    connected: boolean
    offline: boolean
    storageUsed: string
    storageTotal: string
    storageAttention: boolean
    /** Latest local backup state reported by Core (MISSING when none exists). */
    backupState?: string
    /** RFC3339 timestamp for the latest local backup, when available. */
    backupAt?: string
    /** Admission probe indicates that the configured storage reserve is at risk. */
    storagePressure?: boolean
  }
}

export interface CoreClient {
  isLive?(): boolean
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
  /** Optional in older bridges; the HTTP Core implements both methods. */
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
  transitionTimelineRevision?(projectId: string, timelineId: string, revisionId: string, nextState: string, expectedVersion: number, idempotencyKey?: string, reviewSessionId?: string): Promise<TimelineWorkspace>
  getReviews?(projectId: string, state?: string, signal?: AbortSignal): Promise<ReviewSession[]>
  getReview?(projectId: string, reviewSessionId: string, signal?: AbortSignal): Promise<ReviewWorkspace>
  openReview?(projectId: string, subjectRevisionId: string, expectedVersion: number, idempotencyKey?: string): Promise<ReviewWorkspace>
  submitReview?(projectId: string, reviewSessionId: string, decision: HumanReviewDecision, expectedVersion: number, notes?: string, reasonCodes?: string[], idempotencyKey?: string): Promise<ReviewWorkspace>
}
