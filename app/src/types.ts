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
  projectName: string
  label: string
  detail: string
  state: WorkState
  milestone?: string
  updatedAt: string
  actionable?: boolean
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
  getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot>
  acknowledgeDecision(id: string): Promise<void>
  createProject(name: string): Promise<ProjectSummary>
  addProductionItem(projectId: string, title: string): Promise<ProductionItem>
}
