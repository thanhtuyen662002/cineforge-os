import { mockSnapshot } from './data/mockSnapshot'
import type { CoreClient, DashboardSnapshot, ProductionItem, ProjectSummary } from './types'

declare global {
  interface Window {
    /** Optional runtime override injected by the desktop bootstrapper. */
    __CINEFORGE_CORE_BASE_URL__?: string
  }
}

export interface CoreBridge {
  getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot>
  acknowledgeDecision(id: string): Promise<void>
  createProject(name: string): Promise<ProjectSummary>
  addProductionItem(projectId: string, title: string): Promise<ProductionItem>
}

const LOCAL_SNAPSHOT_KEY = 'cineforge-dashboard-v1'

function localSnapshot(): DashboardSnapshot {
  const stored = localStorage.getItem(LOCAL_SNAPSHOT_KEY)
  if (!stored) return structuredClone(mockSnapshot)
  try {
    return JSON.parse(stored) as DashboardSnapshot
  } catch {
    localStorage.removeItem(LOCAL_SNAPSHOT_KEY)
    return structuredClone(mockSnapshot)
  }
}

function saveLocalSnapshot(snapshot: DashboardSnapshot) {
  localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(snapshot))
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

  async getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot> {
    if (!this.baseUrl) return localSnapshot()
    const response = await fetch(`${this.baseUrl}/v1/dashboard`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Core dashboard request failed (${response.status})`)
    return response.json() as Promise<DashboardSnapshot>
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
    return item
  }
}

/** Injectable factory for Tauri, browser, and deterministic tests. */
export function createCoreClient(bridge?: CoreBridge): CoreClient {
  if (bridge) return bridge
  return new HttpCoreClient()
}
