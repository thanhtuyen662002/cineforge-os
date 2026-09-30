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
  payload?: Record<string, unknown>
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

export type TimelineWorkingSessionState = 'OPEN' | 'DIRTY' | 'AUTOSAVING' | 'CHECKPOINTING' | 'CLEAN' | 'CONFLICT' | 'RECOVERY_REQUIRED' | 'CLOSED' | 'ABANDONED' | string

export interface TimelineWorkingOperation {
  id?: string
  opSeq: number
  opType: string
  historyState: 'ACTIVE' | 'UNDONE' | 'DISCARDED' | string
  resultHash?: string
  actorId?: string
  createdAt?: string
}

export interface TimelineWorkingHistoryAction {
  id?: string
  actionSeq: number
  actionType: 'UNDO' | 'REDO' | 'DISCARD_REDO_BRANCH' | string
  targetOpSeq?: number | null
  targetOpId?: string | null
  beforeHash?: string
  afterHash?: string
  actorId?: string
  createdAt?: string
}

export interface TimelineWorkingDraft {
  schemaVersion: number
  mediaProfileRevisionId?: string
  duration: RationalValue
  tracks: TimelineTrack[]
  markers: TimelineMarker[]
}

export interface TimelineWorkingSession {
  id?: string
  timelineId?: string
  baseRevisionId?: string
  baseRevisionRowVersion: number
  baseContentHash?: string
  actorId?: string
  clientInstanceId?: string
  mode: string
  state: TimelineWorkingSessionState
  draftHash?: string
  autosavedHash?: string
  draft: TimelineWorkingDraft
  lastAcknowledgedOpSeq: number
  historyCursorSeq: number
  nextOpSeq: number
  lastCheckpointRevisionId?: string | null
  nextStep?: string | null
  rowVersion: number
  lastAutosaveAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  closedAt?: string | null
  operations: TimelineWorkingOperation[]
  historyActions: TimelineWorkingHistoryAction[]
}

export interface TimelineWorkingWorkspace {
  timeline: TimelineSummary | null
  session: TimelineWorkingSession | null
  checkpointRevision?: TimelineRevision | null
  checkpointRevisionId?: string | null
  acceptedOperations?: TimelineWorkingOperation[]
  timelineRowVersion?: number
  impactSummary?: unknown
  undoneOperation?: Pick<TimelineWorkingOperation, 'id' | 'opSeq' | 'opType'> | null
  redoneOperation?: Pick<TimelineWorkingOperation, 'id' | 'opSeq' | 'opType'> | null
  projectionSeq?: number
  generatedAt?: string
  idempotentReplay?: boolean
}

export interface TimelineWorkingHistory {
  timeline: TimelineSummary | null
  workingSessionId?: string
  operations: TimelineWorkingOperation[]
  historyActions: TimelineWorkingHistoryAction[]
  cursor: { afterOpSeq: number; hasMore: boolean }
  projectionSeq?: number
  generatedAt?: string
}

/** Metadata-first timing records. These records pin an immutable timeline
 * revision and content hash; they do not imply playback, rendering, or an
 * available media asset. Unknown readiness stays visible to the UI. */
export type AudioCueType = 'DIALOGUE' | 'ADR' | 'NONVERBAL' | 'FOLEY' | 'SFX' | 'AMBIENCE' | 'ROOM_TONE' | 'MUSIC' | 'SILENCE' | string
export type TimelineTimingLifecycleState = 'DRAFT' | 'TIMED' | 'REVIEWED' | 'CANDIDATE' | 'SELECTED' | 'APPROVED' | 'STALE' | 'REJECTED' | string

export interface AudioCueSummary {
  id?: string
  projectId?: string
  timelineId?: string
  cueType: AudioCueType
  title: string
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface AudioCueRevision {
  id?: string
  audioCueId?: string
  revisionNumber: number
  state: TimelineTimingLifecycleState
  timelineRevisionId?: string
  timelineContentHash?: string
  timingDependencyRevisionId?: string
  timingDependencyContentHash?: string
  timingDependencyHash?: string
  start: RationalValue
  end: RationalValue
  intentText: string
  selectedAssetRevisionId?: string | null
  assetSnapshotHash?: string | null
  assetGate?: {
    state: 'READY' | 'BLOCKED' | 'UNKNOWN' | 'NOT_APPLICABLE' | string
    rightsStatus?: string | null
    materializationState?: string | null
    reason?: string | null
  } | null
  rowVersion: number
  stale: boolean
  staleReason?: string | null
  nextStep?: string | null
  createdAt?: string
}

export interface AudioCueTimingItem {
  audioCue: AudioCueSummary | null
  revision: AudioCueRevision | null
}

export interface AudioCueTiming {
  timeline: TimelineSummary | null
  timelineRevision: TimelineRevision | null
  cues: AudioCueTimingItem[]
  projectionSeq?: number
  generatedAt?: string
}

export interface SubtitleTrackSummary {
  id?: string
  projectId?: string
  timelineId?: string
  locale: string
  title: string
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface SubtitleSegment {
  id?: string
  segmentIndex: number
  start: RationalValue
  end: RationalValue
  locale: string
  text: string
}

export interface SubtitleTrackRevision {
  id?: string
  subtitleTrackId?: string
  revisionNumber: number
  state: TimelineTimingLifecycleState
  timelineRevisionId?: string
  timelineContentHash?: string
  timingDependencyRevisionId?: string
  timingDependencyContentHash?: string
  timingDependencyHash?: string
  formatProfile: string
  segments: SubtitleSegment[]
  rowVersion: number
  stale: boolean
  staleReason?: string | null
  nextStep?: string | null
  createdAt?: string
}

export interface SubtitleTimingItem {
  subtitleTrack: SubtitleTrackSummary | null
  revision: SubtitleTrackRevision | null
}

export interface SubtitleTiming {
  timeline: TimelineSummary | null
  timelineRevision: TimelineRevision | null
  tracks: SubtitleTimingItem[]
  projectionSeq?: number
  generatedAt?: string
}

export interface TimelineTimingImpactItem {
  audioCueId?: string
  audioCueRevisionId?: string
  subtitleTrackId?: string
  subtitleTrackRevisionId?: string
  timelineRevisionId?: string
  state: TimelineTimingLifecycleState
  stale: boolean
  nextStep?: string | null
}

export interface TimelineTimingImpact {
  timeline: TimelineSummary | null
  pinnedTimelineRevisionId?: string | null
  audioCues: TimelineTimingImpactItem[]
  subtitleTracks: TimelineTimingImpactItem[]
  counts: { audioCues: number; subtitleTracks: number; staleAudioCues: number; staleSubtitleTracks: number; staleTotal: number }
  projectionSeq?: number
  generatedAt?: string
}

export interface AudioCueRevisionInput {
  timelineRevisionId: string
  timelineContentHash: string
  cueType: AudioCueType
  title: string
  start: RationalValue
  end: RationalValue
  intentText?: string
  selectedAssetRevisionId?: string | null
  audioCueId?: string
  expectedCueVersion?: number
}

export interface TimingDependencyInput {
  timelineRevisionId: string
  timelineContentHash: string
}

export interface SubtitleSegmentInput {
  start: RationalValue
  end: RationalValue
  locale: string
  text: string
  segmentIndex?: number
}

export interface SubtitleTrackRevisionInput {
  timelineRevisionId: string
  timelineContentHash: string
  locale: string
  title: string
  formatProfile?: string
  segments: SubtitleSegmentInput[]
  subtitleTrackId?: string
  expectedTrackVersion?: number
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

export type HandoffSessionState = 'PLANNED' | 'PREFLIGHT' | 'BUILDING' | 'VALIDATING' | 'VERIFIED' | 'COMPLETED' | 'BLOCKED_RIGHTS' | 'BLOCKED_MEDIA' | 'FAILED' | 'CANCELLED' | string
export type HandoffCompatibilityStatus = 'NATIVE' | 'APPROXIMATED' | 'UNSUPPORTED' | 'UNKNOWN'

export interface HandoffCompatibilityEntry {
  feature: string
  status: HandoffCompatibilityStatus
  detail: string
}

export interface HandoffCompatibilityReport {
  profileVersion?: string
  targetEditor?: string
  targetVersion?: string
  editableClaim: boolean
  entries: HandoffCompatibilityEntry[]
  counts?: Record<string, number>
  nextStep?: string
}

export interface HandoffArtifact {
  assetRevisionId?: string
  assetId?: string
  semanticRole?: string
  rebuildability?: string
  hashAlgorithm?: string
  contentHash?: string
  byteSize: number
  availabilityState?: string
  reviewState?: string
  availabilityEvidenceState?: string
}

export interface HandoffSanitizationReport {
  policy?: string
  recorded: boolean
  removedFields: string[]
  nextStep?: string
}

export interface HandoffManifest {
  id?: string
  exportSessionId?: string
  projectId?: string
  targetEditor?: string
  targetVersion?: string
  compatibilityProfileVersion?: string
  manifestHash?: string
  manifest?: Record<string, unknown>
  artifactAllowlist: HandoffArtifact[]
  compatibility: HandoffCompatibilityReport
  sanitizationReport: HandoffSanitizationReport
  createdAt?: string
}

export interface HandoffSession {
  id?: string
  projectId?: string
  timelineRevisionId?: string
  deliverableType: string
  targetProfile?: string
  targetEditor?: string
  targetVersion?: string
  state: HandoffSessionState
  outputManifestId?: string
  outputAssetRevisionId?: string
  outputContentHash?: string
  outputByteSize?: number
  validationSnapshot?: {
    schemaVersion?: number
    exportProfile?: string
    artifactCount?: number
    clipCount?: number
    documentHash?: string
    verifiedAt?: string
    errorCode?: string
  }
  commandId?: string
  reviewSessionId?: string
  dependencySnapshotHash?: string
  subjectContentHash?: string
  mediaProfileRevisionId?: string
  nextStep?: string
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface HandoffWorkspace {
  exportSession: HandoffSession | null
  handoffManifest: HandoffManifest | null
  manifestHash?: string
  compatibilityReport: HandoffCompatibilityReport
  sanitizationReport?: HandoffSanitizationReport
  nextStep?: string
  projectionSeq?: number
  generatedAt?: string
}

export interface HandoffListItem {
  exportSession: HandoffSession
  handoffManifest: HandoffManifest
}

export type ExternalEditLineageConfidence = 'EXACT' | 'PARTIAL' | 'FLATTENED' | 'UNKNOWN'
export type ExternalEditValidationState = 'RECEIVED' | 'VALIDATING' | 'REGISTERED' | 'BLOCKED_SCHEMA' | 'BLOCKED_SCOPE' | 'BLOCKED_MEDIA' | 'BLOCKED_RIGHTS' | 'FAILED' | string

export interface ExternalEditContractDiff {
  id?: string
  externalEditId?: string
  projectId?: string
  diffType?: string
  severity?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  resolutionState?: string
  createdByActorId?: string
  createdAt?: string
}

export interface ExternalEdit {
  id?: string
  projectId?: string
  handoffManifestId?: string
  exportSessionId?: string
  timelineRevisionId?: string
  returnedAssetRevisionId?: string
  returnedInterchangeAssetRevisionId?: string
  lineageConfidence: ExternalEditLineageConfidence
  validationState: ExternalEditValidationState
  sourceDocumentHash?: string
  sourceDocumentByteSize?: number
  sourceManifestHash?: string
  sourceRevisionContentHash?: string
  sourceDependencySnapshotHash?: string
  sourceReviewSessionId?: string
  returnedRightsStatus: RightsState
  validationSnapshot?: Record<string, unknown>
  contractDiffCount: number
  contractDiffs: ExternalEditContractDiff[]
  nextStep?: string
  rowVersion: number
  commandId?: string
  createdAt?: string
}

export interface ExternalEditList {
  items: ExternalEdit[]
  projectionSeq?: number
  generatedAt?: string
}

export interface TimelineInterchangeDownload {
  projectId?: string
  exportSessionId?: string
  downloadUrl?: string
  expiresAt?: string
  mimeType?: string
  byteSize: number
  contentHash?: string
  maxRangeBytes?: number
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

export interface MediaPreviewResolution {
  projectId: string
  revisionId: string
  purpose: 'LIBRARY_PREVIEW' | 'TIMELINE_PREVIEW' | string
  url: string
  mimeType: string
  byteSize: number
  contentHash?: string
  expiresAt?: string
  readinessState?: string
  rightsStatus?: RightsState | string
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

/** Redacted local-backup projection. Internal paths never cross the Core boundary. */
export interface BackupSummary {
  id?: string
  backupType?: string
  durabilityClass?: string
  failureDomain?: string
  destinationName?: string
  manifestName?: string
  snapshotName?: string
  installationId?: string
  schemaVersion?: number
  eventSeqCheckpoint?: number
  state: string
  dbSha256?: string
  manifestSha256?: string
  byteSize?: number
  objectCount?: number
  externalObjectCount?: number
  errorCode?: string
  rowVersion: number
  createdAt?: string
  completedAt?: string
}

export interface BackupVerification {
  id?: string
  backupId?: string
  outcome: string
  integrityState: string
  manifestSha256?: string
  objectCount?: number
  byteSize?: number
  details?: Record<string, unknown>
  createdAt?: string
}

export interface BackupWorkspace {
  backup: BackupSummary | null
  verifications: BackupVerification[]
  projectionSeq?: number
  generatedAt?: string
}

export interface BackupCommandResult {
  backup: BackupSummary | null
  verification: BackupVerification | null
  idempotentReplay?: boolean
}

export interface StorageAdmission {
  destinationName?: string
  durabilityClass?: string
  failureDomain?: string
  databaseBytes?: number
  objectBytes?: number
  estimatedBytes?: number
  availableBytes?: number
  reserveBytes?: number
  objectCount?: number
  projectionSeq?: number
  generatedAt?: string
}

/**
 * Redacted evidence for a durable import staging row.
 *
 * The Core may know the private staging path and rich file identities, but
 * those are deliberately not part of the desktop contract.  The UI only
 * receives a safe basename plus scalar size/hash/evidence fields.
 */
export interface StagingEvidence {
  id?: string
  importItemId?: string
  state: string
  tempName?: string
  expectedSize?: number
  currentSize?: number
  hashAlgorithm?: string
  sha256?: string
  sourcePathFingerprint?: string
  reparseState?: string
  sourceFileIdentityState?: string
  osFileIdentityState?: string
  finalizationIdentityState?: string
  rowVersion: number
  createdAt?: string
  updatedAt?: string
}

export interface StagingWorkspace {
  items: StagingEvidence[]
  checkedCount?: number
  projectionSeq?: number
  generatedAt?: string
}

export type ReleaseGateState = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE'
export type ReleaseOverallState = 'READY' | 'BLOCKED' | 'NOT_CHECKED'

/**
 * Read-only, redacted evidence for one release readiness gate.  The Core
 * owns the allowlist; the UI must never infer a path, provider field, or
 * release artifact from this object.
 */
export interface ReleaseGate {
  key: string
  state: ReleaseGateState
  blocking: boolean
  reason?: string
  nextStep?: string
  evidence?: Record<string, unknown>
}

export interface ReleaseReadiness {
  projectId?: string
  projectTitle?: string
  overallState: ReleaseOverallState
  policy: { purpose: string; unknownBlocks: boolean }
  exactSource: Record<string, unknown>
  gates: ReleaseGate[]
  blockingGateKeys: string[]
  blockingCount: number
  unknownCount: number
  gateManifestHash?: string
  nextStep?: string
  projectionSeq?: number
  generatedAt?: string
}

export type ReleaseCandidateState = 'DRAFT' | 'CANCELLED' | 'UNKNOWN'

/** Metadata-only release candidate identity.  Master bytes and raw evidence
 * snapshots stay in Core and are intentionally absent from this UI type. */
export interface ReleaseCandidate {
  id?: string
  projectId?: string
  timelineRevisionId?: string
  audioMasterAssetRevisionId?: string
  mediaProfileRevisionId?: string
  reviewSessionId?: string
  readinessDigest?: string
  rightsSnapshotHash?: string
  state: ReleaseCandidateState
  nextStep?: string
  rowVersion: number
  snapshotSchemaVersion: number
  createdAt?: string
  updatedAt?: string
  cancelledAt?: string
  idempotentReplay?: boolean
}

export interface ReleaseCandidateList {
  items: ReleaseCandidate[]
  projectionSeq?: number
  generatedAt?: string
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
  getBackups?(signal?: AbortSignal): Promise<BackupSummary[]>
  getBackup?(backupId: string, signal?: AbortSignal): Promise<BackupWorkspace>
  getStorageAdmission?(signal?: AbortSignal): Promise<StorageAdmission | null>
  createBackup?(input?: { durabilityClass?: string }, idempotencyKey?: string): Promise<BackupCommandResult>
  verifyBackup?(backupId: string, idempotencyKey?: string): Promise<BackupCommandResult>
  getStaging?(state?: string, limit?: number, signal?: AbortSignal): Promise<StagingWorkspace>
  reconcileStaging?(stagingId?: string, idempotencyKey?: string): Promise<StagingWorkspace>
  getReleaseReadiness?(projectId: string, signal?: AbortSignal): Promise<ReleaseReadiness>
  getReleaseCandidates?(projectId: string, signal?: AbortSignal): Promise<ReleaseCandidateList>
  getReleaseCandidate?(projectId: string, candidateId: string, signal?: AbortSignal): Promise<ReleaseCandidate>
  createReleaseCandidateDraft?(projectId: string, idempotencyKey?: string): Promise<ReleaseCandidate>
  cancelReleaseCandidateDraft?(projectId: string, candidateId: string, expectedVersion: number, idempotencyKey?: string): Promise<ReleaseCandidate>
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
  registerExternalEdit?(projectId: string, input: { handoffManifestId: string; exportSessionId: string; returnedAssetRevisionId: string; expectedVersion: number; lineageConfidence?: ExternalEditLineageConfidence }, idempotencyKey?: string): Promise<ExternalEdit>
  createHandoffManifest?(projectId: string, input: { timelineRevisionId: string; reviewSessionId: string; dependencySnapshotHash: string; targetEditor: string; targetVersion: string; targetProfile?: string; expectedVersion: number }, idempotencyKey?: string): Promise<HandoffWorkspace>
  buildTimelineInterchangeExport?(projectId: string, exportSessionId: string, dependencySnapshotHash: string, expectedVersion: number, idempotencyKey?: string): Promise<HandoffWorkspace>
  resolveTimelineInterchangeDownload?(projectId: string, exportSessionId: string, signal?: AbortSignal): Promise<TimelineInterchangeDownload>
}
