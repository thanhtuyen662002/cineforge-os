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
  state: 'todo' | 'in_progress' | 'done'
}

export interface DecisionRequest {
  id: string
  projectId: string
  projectName: string
  title: string
  detail: string
  reason: string
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
  revisionId?: string
  hashAlgorithm?: string
  contentHash?: string
  byteSize: number
  storageUri?: string
  provenance?: { source_name?: string; [key: string]: unknown } | null
  importSessionId?: string
  importItemId?: string
  warnings: string[]
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
 * A project workspace is a read model owned by Core.  The UI keeps the
 * contract deliberately small: tasks are rendered as production items and
 * the other counts are informational until their dedicated views exist.
 */
export interface ProjectWorkspace {
  projectId: string
  productionItems: ProductionItem[]
  shotsCount: number
  notesCount: number
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
  createProject(name: string): Promise<ProjectSummary>
  addProductionItem(projectId: string, title: string): Promise<ProductionItem>
  /** Optional in older bridges; the HTTP Core implements both methods. */
  getProjectWorkspace?(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspace>
  getProjectActivity?(projectId: string, signal?: AbortSignal): Promise<ActivityItem[]>
  getAssets?(projectId?: string, signal?: AbortSignal): Promise<AssetSummary[]>
  stageAsset?(file: File): Promise<StagedAsset>
  importAsset?(input: ImportAssetInput): Promise<AssetSummary>
}
