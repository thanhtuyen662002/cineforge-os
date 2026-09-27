import { mockSnapshot } from './data/mockSnapshot'
import type { ActivityItem, AssetSummary, CoreClient, DashboardSnapshot, ImportAssetInput, ProductionItem, ProjectSummary, ProjectWorkspace, WorkState } from './types'

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
  getProjectWorkspace?(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspace>
  getProjectActivity?(projectId: string, signal?: AbortSignal): Promise<ActivityItem[]>
  getAssets?(projectId?: string, signal?: AbortSignal): Promise<AssetSummary[]>
  importAsset?(input: ImportAssetInput): Promise<AssetSummary>
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
    const next = await response.json() as DashboardSnapshot
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

  async getProjectWorkspace(projectId: string, signal?: AbortSignal): Promise<ProjectWorkspace> {
    if (!this.baseUrl) {
      const project = localSnapshot().projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new Error('Project no longer exists in Core')
      const productionItems = structuredClone(project.productionItems ?? [])
      return { projectId, productionItems, shotsCount: productionItems.length, notesCount: 0, generatedAt: new Date().toISOString() }
    }
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}/workspace`, { signal, headers: { Accept: 'application/json' } })
    const payload = await readCorePayload(response, 'workspace')
    const result = asRecord(payload)
    const taskSources = arrayValue(result.tasks ?? result.production_items ?? result.productionItems)
    const counts = asRecord(result.counts)
    const productionItems = taskSources.map((source, index) => mapProductionItemRecord(source, index))
    return {
      projectId,
      productionItems,
      shotsCount: numberValue(result.shots_count ?? result.shotsCount ?? counts.shots ?? (Array.isArray(result.shots) ? result.shots.length : result.shots), 0),
      notesCount: numberValue(result.notes_count ?? result.notesCount ?? counts.notes ?? (Array.isArray(result.notes) ? result.notes.length : result.notes), 0),
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

  async importAsset(input: ImportAssetInput): Promise<AssetSummary> {
    if (!this.baseUrl) throw new Error('Asset import requires a connected Core')
    const endpoint = input.projectId
      ? `${this.baseUrl}/v1/projects/${encodeURIComponent(input.projectId)}/assets`
      : `${this.baseUrl}/v1/assets`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        source_path: input.sourcePath,
        ...(input.projectId ? { project_id: input.projectId } : {}),
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

async function readCorePayload(response: Response, label: string): Promise<unknown> {
  let payload: unknown = null
  try { payload = await response.json() } catch { /* handled below */ }
  const envelope = asRecord(payload)
  if (!response.ok || envelope.ok === false) {
    const error = asRecord(envelope.error)
    throw new Error(stringValue(error.user_message_key ?? error.message) ?? `Core ${label} request failed (${response.status})`)
  }
  return envelope.result ?? payload
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

function mapProductionItemRecord(value: unknown, index: number): ProductionItem {
  const source = asRecord(value)
  const rawState = stringValue(source.state ?? source.status ?? source.lifecycle_state) ?? 'todo'
  const state: ProductionItem['state'] = ['DONE', 'COMPLETE', 'completed', 'done'].includes(rawState) ? 'done' : ['RUNNING', 'IN_PROGRESS', 'running', 'in_progress'].includes(rawState) ? 'in_progress' : 'todo'
  return {
    id: stringValue(source.id ?? source.task_id) ?? `workspace-item-${index}`,
    title: stringValue(source.title ?? source.name) ?? 'Production item',
    detail: stringValue(source.detail ?? source.description) ?? (state === 'done' ? 'Đã hoàn tất' : 'Mới tạo · chưa bắt đầu'),
    state,
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
  return {
    id: stringValue(asset.id) ?? `asset-${Math.random().toString(36).slice(2)}`,
    projectId: stringValue(asset.project_id ?? asset.projectId),
    name: stringValue(asset.display_name ?? asset.name) ?? 'Imported asset',
    assetType: stringValue(asset.asset_type ?? asset.assetType) ?? 'GENERIC',
    originType: stringValue(asset.origin_type ?? asset.originType) ?? 'IMPORTED',
    state: stringValue(asset.lifecycle_state ?? asset.state) ?? 'ACTIVE',
    availability: stringValue(asset.availability ?? revision.availability_state ?? revision.availability) ?? 'AVAILABLE',
    revisionId: stringValue(asset.revisionId ?? asset.revision_id ?? revision.id ?? revision.revision_id ?? revision.revisionId),
    hashAlgorithm: stringValue(asset.hashAlgorithm ?? asset.hash_algorithm ?? storage.hash_algorithm ?? storage.hashAlgorithm),
    contentHash: stringValue(asset.contentHash ?? asset.content_hash ?? storage.content_hash ?? storage.contentHash),
    byteSize: numberValue(asset.byteSize ?? asset.byte_size ?? storage.byte_size ?? storage.byteSize, 0),
    storageUri: stringValue(asset.storageUri ?? asset.storage_uri ?? location.path_or_uri ?? location.pathOrUri),
    provenance: asRecord(revision.provenance),
    importSessionId: stringValue(asset.importSessionId ?? asRecord(source.import_session).id ?? source.importSessionId),
    importItemId: stringValue(asset.importItemId ?? asRecord(source.import_item).id ?? source.importItemId),
    warnings,
    latestRevision: revision,
  }
}

/** Injectable factory for Tauri, browser, and deterministic tests. */
export function createCoreClient(bridge?: CoreBridge): CoreClient {
  if (bridge) return bridge
  return new HttpCoreClient()
}
