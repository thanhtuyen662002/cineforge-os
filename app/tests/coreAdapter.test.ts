import { beforeEach, describe, expect, it } from 'vitest'
import { createCoreClient } from '../src/coreAdapter'

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
})
