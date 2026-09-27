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
    expect(workspace?.shotsCount).toBe(project.productionItems?.length)
  })

  it('keeps activity reads empty for an unknown local project', async () => {
    const client = createCoreClient()

    await expect(client.getProjectActivity?.('missing-project')).resolves.toEqual([])
  })

  it('maps HTTP asset records and sends a Core import command', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'asset-1', projectId: 'project-1', name: 'shot.png', assetType: 'IMAGE', availability: 'AVAILABLE', revisionId: 'revision-1', contentHash: 'a'.repeat(64), byteSize: 42, storageUri: 'object://sha-256/a/aaa', warnings: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      expect(url).toContain('/v1/assets')
      return new Response(JSON.stringify({ assets: [{ id: 'asset-1', projectId: 'project-1', name: 'shot.png', assetType: 'IMAGE', availability: 'AVAILABLE', revisionId: 'revision-1', contentHash: 'a'.repeat(64), byteSize: 42, storageUri: 'object://sha-256/a/aaa', warnings: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new HttpCoreClient('http://core')
      const assets = await client.getAssets?.()
      expect(assets?.[0].contentHash).toBe('a'.repeat(64))
      expect(assets?.[0].byteSize).toBe(42)
      const imported = await client.importAsset?.({ sourcePath: 'C:/media/shot.png', projectId: 'project-1' })
      expect(imported?.id).toBe('asset-1')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(String(fetchMock.mock.calls[1][0])).toContain('/v1/projects/project-1/assets')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
