import { describe, expect, it, vi, afterEach } from 'vitest'
import { HttpCoreClient } from './coreAdapter'

afterEach(() => vi.restoreAllMocks())

describe('HttpCoreClient character boundary', () => {
  it('maps separate identity packages and workspace revisions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        characters: [{
          id: 'char-1', project_id: 'project-1', stable_code: 'MAYA', display_name: 'Maya', lifecycle_state: 'ACTIVE', row_version: 3,
          visual_identity_package: { id: 'visual-package-1', candidate_revisions: [{ id: 'visual-1', state: 'DRAFT' }] },
          voice_identity_package: { id: 'voice-package-1', candidate_revisions: [{ id: 'voice-1', state: 'DRAFT', canonical_language: 'vi-VN' }] },
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new HttpCoreClient('http://127.0.0.1:43217')
    const characters = await client.getCharacters('project-1')
    expect(characters).toHaveLength(1)
    expect(characters[0].displayName).toBe('Maya')
    expect(characters[0].visualIdentityPackage?.candidateRevisions[0].id).toBe('visual-1')
    expect(characters[0].voiceIdentityPackage?.candidateRevisions[0].canonicalLanguage).toBe('vi-VN')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/characters?project_id=project-1')
  })

  it('sends a typed voice revision through the command adapter without provider fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { id: 'voice-rev-1', state: 'DRAFT', canonical_language: 'vi-VN', character_id: 'char-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new HttpCoreClient('http://127.0.0.1:43217')
    const revision = await client.createVoiceIdentityRevision('char-1', { semanticDescription: 'Warm and restrained', canonicalLanguage: 'vi-VN' }, 'voice-revision-1')
    expect(revision.id).toBe('voice-rev-1')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': 'voice-revision-1' }))
    expect(JSON.parse(String(request.body))).toEqual({ semantic_description: 'Warm and restrained', canonical_language: 'vi-VN' })
  })
})
