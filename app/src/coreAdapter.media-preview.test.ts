import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpCoreClient } from './coreAdapter'

afterEach(() => vi.restoreAllMocks())

describe('HttpCoreClient media preview boundary', () => {
  it('requests a session-bound capability and maps the same-origin preview URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        project_id: 'project-1', asset_revision_id: 'revision-1', purpose: 'LIBRARY_PREVIEW',
        preview_url: '/v1/projects/project-1/assets/revision-1/preview?token=opaque',
        mime_type: 'image/png', byte_size: 42, content_hash: 'a'.repeat(64),
        expires_at: '2026-01-01T00:00:00.000Z', rights_status: 'ALLOWED', readiness_state: 'INSPECTION_READY',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new HttpCoreClient('http://127.0.0.1:43217')
    const resolved = await client.resolveMediaPreview('project-1', 'revision-1')
    expect(resolved.url).toContain('http://127.0.0.1:43217/v1/projects/project-1/assets/revision-1/preview?token=opaque')
    expect(resolved.mimeType).toBe('image/png')
    expect(resolved.byteSize).toBe(42)
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(String(fetchMock.mock.calls[0][0])).toContain('purpose=LIBRARY_PREVIEW')
    expect(String(fetchMock.mock.calls[0][0])).toContain('session_id=')
    expect(request.headers).toEqual(expect.objectContaining({ Accept: 'application/json', 'X-CineForge-Session': expect.any(String) }))
  })
})
