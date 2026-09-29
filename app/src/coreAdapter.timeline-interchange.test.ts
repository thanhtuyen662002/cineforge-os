import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpCoreClient } from './coreAdapter'

afterEach(() => vi.restoreAllMocks())

describe('HttpCoreClient verified timeline interchange boundary', () => {
  it('builds with exact export evidence and maps the completed output binding', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {
      export_session: {
        id: 'export-1', project_id: 'project-1', state: 'COMPLETED', row_version: 6,
        dependency_snapshot_hash: 'a'.repeat(64), output_asset_revision_id: 'asset-revision-1',
        output_content_hash: 'b'.repeat(64), output_byte_size: 2048,
        validation_snapshot: { schema_version: 1, export_profile: 'GENERIC_INTERCHANGE_V1', artifact_count: 2, clip_count: 3, document_hash: 'b'.repeat(64), verified_at: '2026-09-30T00:00:00.000Z' },
        next_step: 'Ready',
      },
    } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new HttpCoreClient('http://core')
    const workspace = await client.buildTimelineInterchangeExport('project-1', 'export-1', 'a'.repeat(64), 2, 'export-build-1')
    expect(workspace.exportSession).toMatchObject({ id: 'export-1', state: 'COMPLETED', outputAssetRevisionId: 'asset-revision-1', outputContentHash: 'b'.repeat(64), outputByteSize: 2048, rowVersion: 6 })
    expect(workspace.exportSession?.validationSnapshot).toMatchObject({ schemaVersion: 1, artifactCount: 2, clipCount: 3, documentHash: 'b'.repeat(64) })
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/projects/project-1/exports/export-1/build')
    expect(request.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json', 'Idempotency-Key': 'export-build-1' }))
    expect(JSON.parse(String(request.body))).toEqual({ dependency_snapshot_hash: 'a'.repeat(64), expected_version: 2 })
  })

  it('resolves an opaque, absolute, session-bound download URL without exposing the capability token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {
      project_id: 'project-1', export_session_id: 'export-1',
      download_url: '/v1/projects/project-1/exports/export-1/download?token=opaque-token',
      expires_at: '2026-09-30T00:01:00.000Z', mime_type: 'application/json', byte_size: 128,
      content_hash: 'c'.repeat(64), max_range_bytes: 16 * 1024 * 1024,
    } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new HttpCoreClient('http://core/')
    const resolved = await client.resolveTimelineInterchangeDownload('project-1', 'export-1')
    expect(resolved.downloadUrl).toBe('http://core/v1/projects/project-1/exports/export-1/download?token=opaque-token')
    expect(resolved.byteSize).toBe(128)
    expect(resolved.contentHash).toBe('c'.repeat(64))
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const headers = new Headers(request.headers)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('x-cineforge-session')).toEqual(expect.any(String))
  })
})
