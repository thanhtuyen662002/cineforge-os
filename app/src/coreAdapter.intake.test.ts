import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpCoreClient } from './coreAdapter'

afterEach(() => vi.restoreAllMocks())

function base64UrlUtf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('HttpCoreClient browser intake boundary', () => {
  it('streams the browser file with an idempotency key and lossless filename header', async () => {
    const file = new File([new TextEncoder().encode('hello from browser')], 'ảnh shot-010.txt', { type: 'text/plain' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { handle: 'staging-1', name: 'ảnh shot-010.txt', mime_type: 'text/plain', byte_size: file.size, content_hash: 'a'.repeat(64) },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const staged = await new HttpCoreClient('http://core').stageAsset(file)

    expect(staged).toMatchObject({ handle: 'staging-1', name: 'ảnh shot-010.txt', mimeType: 'text/plain', byteSize: file.size })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://core/v1/desktop/stage')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('text/plain')
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(headers.get('x-cineforge-filename-b64')).toBe(base64UrlUtf8('ảnh shot-010.txt'))
    expect(init?.body).toBe(file)
  })

  it('imports a staged opaque handle without ever sending a browser filesystem path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { asset: { id: 'asset-1', project_id: 'project-1', display_name: 'Shot 010', latest_revision: { id: 'revision-1', content_hash: 'b'.repeat(64), byte_size: 17 } } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await new HttpCoreClient('http://core').importAsset({
      sourceHandle: 'staging-1', projectId: 'project-1', originalName: 'shot-010.txt', storageMode: 'COPY', idempotencyKey: 'import-1',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://core/v1/projects/project-1/assets')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({ source_handle: 'staging-1', project_id: 'project-1', storage_mode: 'COPY' })
    expect(JSON.parse(String(init?.body)).staging_id).toBeUndefined()
    expect(JSON.parse(String(init?.body)).source_path).toBeUndefined()
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('import-1')
  })
})
