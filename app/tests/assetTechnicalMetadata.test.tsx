import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetTechnicalMetadataPanel } from '../src/App'
import { HttpCoreClient } from '../src/coreAdapter'
import type { AssetSummary, AssetTechnicalMetadata, CoreClient } from '../src/types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const hash = 'a'.repeat(64)
const asset: AssetSummary = { id: 'asset-1', projectId: 'project-1', revisionId: 'revision-1', name: 'Nguồn âm thanh',
  assetType: 'AUDIO', originType: 'IMPORTED', state: 'ACTIVE', availability: 'AVAILABLE', readinessState: 'UNKNOWN', contentHash: hash, byteSize: 76, warnings: [] }
const rawJob = { id: 'job-1', project_id: 'project-1', asset_revision_id: 'revision-1', state: 'BLOCKED_TOOLCHAIN',
  row_version: 1, outcome: 'UNKNOWN', execution_started: false, toolchain_verified: false,
  toolchain_manifest_hash: 'b'.repeat(64), metadata: null, streams: [], needs_user: true }
const raw = { project_id: 'project-1', asset_revision_id: 'revision-1', asset_row_version: 1,
  content_hash: hash, byte_size: 76, state: 'BLOCKED_TOOLCHAIN', outcome: 'UNKNOWN', metadata: null,
  streams: [], job: rawJob, needs_user: true, next_step: 'C:\\private-token.wav', metadata_json: { token: 'private-token' } }
const projection: AssetTechnicalMetadata = { projectId: 'project-1', revisionId: 'revision-1', assetRowVersion: 1,
  contentHash: hash, byteSize: 76, state: 'BLOCKED_TOOLCHAIN', outcome: 'UNKNOWN', metadata: null, streams: [], needsUser: true,
  job: { id: 'job-1', projectId: 'project-1', revisionId: 'revision-1', state: 'BLOCKED_TOOLCHAIN', rowVersion: 1,
    outcome: 'UNKNOWN', executionStarted: false, toolchainVerified: false, requestedManifestHash: 'b'.repeat(64), needsUser: true } }
function bridge(get: NonNullable<CoreClient['getAssetTechnicalMetadata']> = vi.fn(async () => projection),
  cancel: NonNullable<CoreClient['cancelMediaProbe']> = vi.fn(async () => ({ ...projection.job!, state: 'CANCELLED' as const, rowVersion: 2 }))) {
  return { isLive: () => true, getAssetTechnicalMetadata: get, cancelMediaProbe: cancel } as unknown as CoreClient
}
function openPanel(container: HTMLElement) {
  const details = container.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
}

describe('technical media adapter admission boundary', () => {
  it('reads exact project/revision and strips private/raw fields, then cancels with the current version and explicit key', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: raw })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { job: { ...rawJob, state: 'CANCELLED', row_version: 2, needs_user: false } } })))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpCoreClient('http://core')
    const read = await client.getAssetTechnicalMetadata('project-1', 'revision-1')
    expect(fetchMock.mock.calls[0][0]).toBe('http://core/v1/projects/project-1/assets/revision-1/technical-metadata')
    expect(read).toEqual(projection); expect(JSON.stringify(read)).not.toContain('private-token')
    expect((await client.cancelMediaProbe('project-1', 'job-1', 1, 'cancel-key')).state).toBe('CANCELLED')
    const options = fetchMock.mock.calls[1][1] as RequestInit
    expect(options.body).toBe(JSON.stringify({ expected_version: 1 }))
    expect((options.headers as Record<string, string>)['Idempotency-Key']).toBe('cancel-key')
  })
  it('rejects mismatched scope and uncertified measurement claims rather than rendering PASS', async () => {
    const client = new HttpCoreClient('http://core')
    for (const [value, code] of [
      [{ ...raw, project_id: 'other-project' }, 'ENTITY_SCOPE_MISMATCH'],
      [{ ...raw, asset_revision_id: 'other-revision' }, 'ENTITY_SCOPE_MISMATCH'],
      [{ ...raw, outcome: 'PASS', metadata: { codec: 'h264' } }, 'PROBE_VERIFIER_UNAVAILABLE'],
      [{ ...raw, state: 'COMPLETED' }, 'PROBE_VERIFIER_UNAVAILABLE'],
      [{ ...raw, job: { ...rawJob, execution_started: true } }, 'PROBE_VERIFIER_UNAVAILABLE'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: value }))))
      await expect(client.getAssetTechnicalMetadata('project-1', 'revision-1')).rejects.toMatchObject({ code })
    }
  })
  it('does not fetch offline and preserves typed Core conflicts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'STALE_REVISION', category: 'CONFLICT', needs_user: true } }), { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new HttpCoreClient('').getAssetTechnicalMetadata('project-1', 'revision-1')).rejects.toMatchObject({ code: 'CORE_OFFLINE' })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(new HttpCoreClient('http://core').cancelMediaProbe('project-1', 'job-1', 1, 'stale')).rejects.toMatchObject({ code: 'STALE_REVISION' })
  })
})

describe('Library technical information', () => {
  it('reads on demand in Vietnamese and never enables analysis without an execution capability', async () => {
    const get = vi.fn(async () => projection)
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="vi" client={bridge(get)} connected />)
    expect(get).not.toHaveBeenCalled(); openPanel(container)
    expect(await screen.findByText('Cần xử lý')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('project-1', 'revision-1', expect.any(AbortSignal))
    expect((screen.getByRole('button', { name: 'Phân tích kỹ thuật' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/CineForge chưa có bộ thực thi/)).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(container.textContent).not.toContain('private-token')
  })
  it('cancels the exact blocked job once and refreshes the projection in English', async () => {
    const cancelled = { ...projection, state: 'CANCELLED' as const, job: { ...projection.job!, state: 'CANCELLED' as const, rowVersion: 2 }, needsUser: false }
    const get = vi.fn().mockResolvedValueOnce(projection).mockResolvedValue(cancelled)
    const cancel = vi.fn(async () => cancelled.job)
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={bridge(get, cancel)} connected />)
    openPanel(container); fireEvent.click(await screen.findByRole('button', { name: 'Cancel unexecuted request' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('project-1', 'job-1', 1, expect.any(String), expect.any(AbortSignal)))
    expect(await screen.findByText('Cancelled')).toBeTruthy(); expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('disables controls offline and ignores a read completed after disconnect', async () => {
    let resolve!: (data: AssetTechnicalMetadata) => void
    const get = vi.fn<NonNullable<CoreClient['getAssetTechnicalMetadata']>>(() => new Promise<AssetTechnicalMetadata>(done => { resolve = done }))
    const client = bridge(get)
    const { container, rerender } = render(<AssetTechnicalMetadataPanel asset={asset} locale="vi" client={client} connected />)
    openPanel(container); await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    const signal = get.mock.calls[0][2] as AbortSignal
    rerender(<AssetTechnicalMetadataPanel asset={asset} locale="vi" client={client} connected={false} />)
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(projection))
    expect(screen.getByText(/Core đang ngoại tuyến/)).toBeTruthy()
    expect(screen.queryByText('Cần xử lý')).toBeNull()
    expect((screen.getByRole('button', { name: 'Tải lại' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows a recovery message without exposing error diagnostics or mismatched revision facts', async () => {
    const get = vi.fn(async () => { throw new Error('C:\\private-token.wav') })
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="vi" client={bridge(get)} connected />)
    openPanel(container)
    expect(await screen.findByRole('alert')).toBeTruthy(); expect(container.textContent).not.toContain('private-token')
  })
  it('rejects another revision returned by a bridge and keeps cancellation unavailable', async () => {
    const get = vi.fn(async () => ({ ...projection, revisionId: 'wrong-revision' }))
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={bridge(get)} connected />)
    openPanel(container)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel unexecuted request' })).toBeNull()
    expect(screen.queryByText('Action needed')).toBeNull()
  })
})
