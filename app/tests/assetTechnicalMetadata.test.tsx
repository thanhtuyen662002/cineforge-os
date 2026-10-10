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
function measuredRaw() {
  const metadata = { id: 'measurement-1', media_kind: 'AUDIO', container: 'wav', codec: 'pcm_s16le', width: null, height: null,
    pixel_format: null, frame_rate: null, time_base: { num: 1, den: 8000 }, frame_count: null, duration: { num: 1, den: 500 },
    color_primaries: null, transfer: null, matrix: null, audio_codec: 'pcm_s16le', sample_rate: 8000, channel_layout: 'mono',
    stream_count: 1, normalized_metadata_hash: 'c'.repeat(64), raw_evidence_hash: 'd'.repeat(64), raw_evidence_byte_size: 295,
    verified_at: '2026-10-10T15:09:45.999Z', metadata_json: { token: 'private-token' } }
  const streams = [{ stream_index: 0, stream_kind: 'AUDIO', codec: 'pcm_s16le', time_base: { num: 1, den: 8000 },
    duration: { num: 1, den: 500 }, disposition: { default: 1 }, channels: 1, channel_layout: 'mono', sample_rate: 8000,
    sample_format: 's16', diagnostics: 'C:\\private-token.wav' }]
  const facts = { projection_contract: 'MEDIA_PROBE_PROJECTION_V1', execution_available: false, state: 'COMPLETED', outcome: 'PASS',
    metadata, streams, needs_user: false, next_step_key: 'media_probe.next_step.completed' }
  return { ...raw, ...facts, job: { ...rawJob, ...facts, row_version: 7, content_hash: hash, byte_size: 76,
    execution_started: true, toolchain_verified: true, cancel_allowed: false, attempt_id: 'attempt-1',
    toolchain_id: 'fixture-pack', toolchain_version: '1.0.0', toolchain_binary_hash: 'e'.repeat(64) } }
}
async function readMeasured(value: Record<string, unknown> = measuredRaw()) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: value }))))
  return new HttpCoreClient('http://core').getAssetTechnicalMetadata('project-1', 'revision-1')
}
function measuredVideoRaw() {
  const raw = measuredRaw()
  const streams = [{ ...raw.streams[0], duration: { num: 1001, den: 100 } },
    { stream_index: 2, stream_kind: 'VIDEO', codec: 'h264', width: 1920, height: 1080, frame_rate: { num: 30000, den: 1001 },
      nominal_frame_rate: { num: 30000, den: 1001 }, time_base: { num: 1, den: 90000 }, duration: { num: 1001, den: 100 },
      frame_count: 300, pixel_aspect: { num: 1, den: 1 }, pixel_format: 'yuv420p', color_range: 'tv', color_space: 'bt709',
      color_transfer: 'bt709', color_primaries: 'bt709', disposition: { default: 1 } }]
  const metadata = { ...raw.metadata, media_kind: 'AUDIO_VIDEO', codec: 'h264', width: 1920, height: 1080, frame_count: 300,
    pixel_format: 'yuv420p', frame_rate: { num: 30000, den: 1001 }, time_base: { num: 1, den: 90000 }, duration: { num: 1001, den: 100 },
    color_primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', stream_count: 2 }
  return { ...raw, metadata, streams, job: { ...raw.job, metadata, streams } }
}
function bridge(get: NonNullable<CoreClient['getAssetTechnicalMetadata']> = vi.fn(async () => projection),
  cancel: NonNullable<CoreClient['cancelMediaProbe']> = vi.fn(async () => ({ ...projection.job!, state: 'CANCELLED' as const, rowVersion: 2 }))) {
  return { isLive: () => true, getAssetTechnicalMetadata: get, cancelMediaProbe: cancel } as unknown as CoreClient
}
function openPanel(container: HTMLElement) {
  const details = container.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
}

describe('technical media adapter admission boundary', () => {
  it('accepts a consistent V1 measurement and strips producer/private extras from every stream and summary', async () => {
    const result = await readMeasured()
    expect(result.projectionContract).toBe('MEDIA_PROBE_PROJECTION_V1'); expect(result.outcome).toBe('PASS')
    expect(result.metadata?.duration).toEqual({ num: 1, den: 500 })
    expect(result.streams[0]).toMatchObject({ kind: 'AUDIO', sampleRate: 8000, channels: 1, channelLayout: 'mono' })
    expect(result.job).toMatchObject({ toolchainVerified: true, executionStarted: true, cancelAllowed: false, rowVersion: 7 })
    expect(JSON.stringify(result)).not.toContain('private-token'); expect(JSON.stringify(result)).not.toContain('disposition')
  })
  it.each([
    ['future root version', (v: ReturnType<typeof measuredRaw>) => { v.projection_contract = 'MEDIA_PROBE_PROJECTION_V2' }],
    ['future job version', (v: ReturnType<typeof measuredRaw>) => { v.job.projection_contract = 'MEDIA_PROBE_PROJECTION_V2' }],
    ['execution falsely available', (v: ReturnType<typeof measuredRaw>) => { v.execution_available = true }],
    ['missing execution evidence', (v: ReturnType<typeof measuredRaw>) => { v.job.execution_started = false }],
    ['missing toolchain proof', (v: ReturnType<typeof measuredRaw>) => { v.job.toolchain_verified = false }],
    ['historical cancel enabled', (v: ReturnType<typeof measuredRaw>) => { v.job.cancel_allowed = true }],
    ['wrong current source hash', (v: ReturnType<typeof measuredRaw>) => { v.job.content_hash = 'f'.repeat(64) }],
    ['wrong current source size', (v: ReturnType<typeof measuredRaw>) => { v.job.byte_size = 77 }],
    ['stream count mismatch', (v: ReturnType<typeof measuredRaw>) => { v.metadata.stream_count = 2 }],
    ['duplicate stream index', (v: ReturnType<typeof measuredRaw>) => { v.streams.push({ ...v.streams[0] }); v.metadata.stream_count = 2 }],
    ['unbounded stream inventory', (v: ReturnType<typeof measuredRaw>) => { v.streams = Array.from({ length: 257 }, (_, i) => ({ ...v.streams[0], stream_index: i })); v.metadata.stream_count = 257 }],
    ['zero denominator', (v: ReturnType<typeof measuredRaw>) => { v.metadata.duration.den = 0 }],
    ['numeric overflow', (v: ReturnType<typeof measuredRaw>) => { v.metadata.duration.num = Number.MAX_SAFE_INTEGER + 1 }],
    ['duration bound', (v: ReturnType<typeof measuredRaw>) => { v.metadata.duration.num = 604801; v.metadata.duration.den = 1 }],
    ['unsafe codec token', (v: ReturnType<typeof measuredRaw>) => { v.streams[0].codec = 'C:\\private-token.wav' }],
    ['primary stream disagreement', (v: ReturnType<typeof measuredRaw>) => { v.metadata.sample_rate = 48000 }],
    ['invalid evidence hash', (v: ReturnType<typeof measuredRaw>) => { v.metadata.raw_evidence_hash = 'bad' }],
    ['wrong recovery step', (v: ReturnType<typeof measuredRaw>) => { v.next_step_key = 'media_probe.next_step.running' }],
  ])('rejects inconsistent V1 proof: %s', async (_name, mutate) => {
    const value = measuredRaw(); mutate(value)
    await expect(readMeasured(value)).rejects.toMatchObject({ code: 'INVALID_CORE_RESPONSE' })
  })
  it('rejects an unknown future version even when it only claims UNKNOWN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { ...raw, projection_contract: 'MEDIA_PROBE_PROJECTION_V2' } }))))
    await expect(new HttpCoreClient('http://core').getAssetTechnicalMetadata('project-1', 'revision-1')).rejects.toMatchObject({ code: 'INVALID_CORE_RESPONSE' })
  })
  it('accepts complete A/V streams with distinct indices and rejects mismatched color summaries', async () => {
    const value = measuredVideoRaw(); const result = await readMeasured(value)
    expect(result.metadata).toMatchObject({ kind: 'AUDIO_VIDEO', codec: 'h264', width: 1920, height: 1080, streamCount: 2 })
    expect(result.streams.map(stream => stream.streamIndex)).toEqual([0, 2])
    value.metadata.transfer = 'linear'
    await expect(readMeasured(value)).rejects.toMatchObject({ code: 'INVALID_CORE_RESPONSE' })
  })
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
  it('shows primary video dimensions and marks rounded frame rate while retaining exact rational values', async () => {
    const result = await readMeasured(measuredVideoRaw())
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="vi" client={bridge(vi.fn(async () => result))} connected />)
    openPanel(container); expect(await screen.findByText('≈ 29,97003 fps')).toBeTruthy()
    expect(screen.getAllByText('1920 × 1080').length).toBe(2); expect(screen.getAllByText('30000/1001').length).toBe(2)
    expect(screen.getByText('tv · bt709 · bt709 · bt709')).toBeTruthy()
    expect(screen.getByText('Luồng 2 · Video · h264')).toBeTruthy(); expect(screen.queryByRole('progressbar')).toBeNull()
  })
  it('renders verified Vietnamese facts and exact stream evidence, with execution still unavailable', async () => {
    const result = await readMeasured()
    const { container } = render(<AssetTechnicalMetadataPanel asset={{ ...asset, rowVersion: 1 }} locale="vi" client={bridge(vi.fn(async () => result))} connected />)
    openPanel(container); expect(await screen.findByText('Đã xác minh metadata')).toBeTruthy()
    expect(screen.getByText('0,002 s')).toBeTruthy(); expect(screen.getByText('wav')).toBeTruthy()
    expect(screen.getAllByText('8.000 Hz').length).toBe(2); expect(screen.getAllByText('1/500').length).toBe(2)
    expect(screen.getAllByText('1/8000').length).toBe(2)
    expect(container.textContent).not.toContain('private-token'); expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hủy yêu cầu chưa chạy' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Phân tích kỹ thuật' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('keeps verified history visible alongside a pin-release restart warning', async () => {
    const value = measuredRaw(); value.needs_user = true; value.job.needs_user = true
    value.next_step_key = value.job.next_step_key = 'media_probe.next_step.restart_required'
    const result = await readMeasured(value)
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={bridge(vi.fn(async () => result))} connected />)
    openPanel(container); expect(await screen.findByText('0.002 s')).toBeTruthy()
    expect(screen.getByText(/Restart CineForge/)).toBeTruthy(); expect(screen.queryByRole('progressbar')).toBeNull()
  })
  it('shows interrupted command recovery alongside verified facts without suggesting repeated restart proves cleanup', async () => {
    const value = measuredRaw(); value.needs_user = value.job.needs_user = true
    value.next_step_key = value.job.next_step_key = 'media_probe.next_step.recovery_required'
    const result = await readMeasured(value)
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={bridge(vi.fn(async () => result))} connected />)
    openPanel(container); expect(await screen.findByText('0.002 s')).toBeTruthy()
    expect(screen.getByText(/CineForge recovered the interrupted request/)).toBeTruthy()
    expect(screen.queryByText(/Restart CineForge/)).toBeNull(); expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel unexecuted request' })).toBeNull()
  })
  it.each(['RUNNING','PARSING','VERIFYING','CONFLICT','STALE','BLOCKED_RIGHTS'] as const)('shows actual %s state without old measurements or cancelling historical work', async state => {
    const result: AssetTechnicalMetadata = { ...projection, projectionContract: 'MEDIA_PROBE_PROJECTION_V1', state,
      outcome: state === 'CONFLICT' ? 'CONFLICT' : 'UNKNOWN', nextStepKey: `media_probe.next_step.${state.toLowerCase()}`,
      job: { ...projection.job!, state, outcome: state === 'CONFLICT' ? 'CONFLICT' : 'UNKNOWN', cancelAllowed: false, executionStarted: true } }
    const { container } = render(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={bridge(vi.fn(async () => result))} connected />)
    openPanel(container); expect(await screen.findByText('No verified analysis result.')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel unexecuted request' })).toBeNull(); expect(screen.queryByRole('progressbar')).toBeNull()
  })
  it('immediately hides old facts and aborts the read when the same revision gains a new source/version', async () => {
    const result = await readMeasured(); let resolve!: (data: AssetTechnicalMetadata) => void
    const get = vi.fn<NonNullable<CoreClient['getAssetTechnicalMetadata']>>().mockResolvedValueOnce(result)
      .mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const client = bridge(get)
    const { container, rerender } = render(<AssetTechnicalMetadataPanel asset={{ ...asset, rowVersion: 1 }} locale="en" client={client} connected />)
    openPanel(container); expect(await screen.findByText('0.002 s')).toBeTruthy()
    rerender(<AssetTechnicalMetadataPanel asset={{ ...asset, rowVersion: 2, contentHash: 'f'.repeat(64), byteSize: 77 }} locale="en" client={client} connected />)
    expect(screen.queryByText('0.002 s')).toBeNull(); expect(screen.queryByText('wav')).toBeNull()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2)); expect((get.mock.calls[0][2] as AbortSignal).aborted).toBe(true)
    await act(async () => resolve(result)); expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('0.002 s')).toBeNull()
  })
  it('hides verified facts after refresh fails and after disconnect, including Advanced evidence', async () => {
    const result = await readMeasured(); const get = vi.fn().mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('private-token'))
    const client = bridge(get)
    const { container, rerender } = render(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={client} connected />)
    openPanel(container); expect(await screen.findByText('0.002 s')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('0.002 s')).toBeNull(); expect(screen.queryByText('c'.repeat(64))).toBeNull()
    rerender(<AssetTechnicalMetadataPanel asset={asset} locale="en" client={client} connected={false} />)
    expect(screen.queryByText('0.002 s')).toBeNull(); expect(container.textContent).not.toContain('private-token')
  })
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
