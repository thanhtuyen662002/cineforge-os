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
}
