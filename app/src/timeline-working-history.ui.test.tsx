import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimelineView } from './App'
import type { CoreClient, DashboardSnapshot } from './types'
import { mockSnapshot } from './data/mockSnapshot'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const snapshot: DashboardSnapshot = {
  ...mockSnapshot,
  projects: [mockSnapshot.projects[0]],
  decisions: [],
  activity: [],
}

function createClient() {
  const timeline = { id: 'timeline-1', projectId: 'aurora', scopeType: 'PROJECT', scopeId: 'aurora', title: 'Main', code: 'MAIN', state: 'ACTIVE', rowVersion: 1 }
  const profileRevision = { id: 'profile-revision-1', profileId: 'profile-1', projectId: 'aurora', state: 'APPROVED', rowVersion: 1, timelineRate: { num: 24, den: 1 }, timeBase: { num: 1, den: 24 }, dropFramePolicy: 'NON_DROP', width: 1920, height: 1080, pixelAspect: { num: 1, den: 1 }, workingColorSpace: 'REC709', transferFunction: 'SDR', hdrPolicy: 'DISABLED', audioSampleRate: 48000, audioChannelLayout: 'STEREO' }
  const revision = { id: 'timeline-revision-1', timelineId: 'timeline-1', mediaProfileRevisionId: 'profile-revision-1', state: 'DRAFT_CHECKPOINT', rowVersion: 1, duration: { num: 24, den: 1 }, editHash: 'a'.repeat(64), tracks: [], markers: [], readinessState: 'READY' }
  const session = { id: 'session-1', timelineId: 'timeline-1', baseRevisionId: revision.id, baseRevisionRowVersion: 1, baseContentHash: revision.editHash, mode: 'EXCLUSIVE', state: 'DIRTY', draftHash: 'b'.repeat(64), autosavedHash: 'a'.repeat(64), rowVersion: 2, lastAcknowledgedOpSeq: 1, historyCursorSeq: 1, nextOpSeq: 2, draft: { schemaVersion: 1, mediaProfileRevisionId: profileRevision.id, duration: { num: 24, den: 1 }, tracks: [], markers: [] }, lastCheckpointRevisionId: null, nextStep: null, operations: [{ id: 'op-1', opSeq: 1, opType: 'ADD_MARKER', historyState: 'ACTIVE', resultHash: 'b'.repeat(64) }], historyActions: [] }
  const workspace = { timeline, mediaProfile: { profile: { id: 'profile-1', projectId: 'aurora' }, revisions: [profileRevision], approvedRevision: profileRevision, candidateRevisions: [] }, revisions: [revision], currentRevision: revision, needsYou: [] }
  const history = { timeline, workingSessionId: session.id, operations: [{ id: 'op-1', opSeq: 1, opType: 'ADD_MARKER', historyState: 'ACTIVE', resultHash: 'b'.repeat(64) }], historyActions: [{ id: 'action-1', actionSeq: 1, actionType: 'UNDO', targetOpSeq: 1 }], cursor: { afterOpSeq: 1, hasMore: false } }
  const getTimelineWorkingHistory = vi.fn(async () => history)
  const client = {
    isLive: () => true,
    getMediaProfile: vi.fn(async () => ({ profile: { id: 'profile-1', projectId: 'aurora' }, revisions: [profileRevision], approvedRevision: profileRevision, candidateRevisions: [] })),
    getTimelines: vi.fn(async () => [timeline]),
    getAssets: vi.fn(async () => []),
    getTimelineWorkspace: vi.fn(async () => workspace),
    getTimelineWorkingSession: vi.fn(async () => ({ timeline, session })),
    getTimelineWorkingHistory,
  } as unknown as CoreClient
  return { client, getTimelineWorkingHistory }
}

describe('TimelineView working history', () => {
  it('loads a read-only history page and exposes safe operation/action summaries', async () => {
    window.localStorage.setItem('cineforge-working-session:aurora:timeline-1', 'session-1')
    const { client, getTimelineWorkingHistory } = createClient()
    render(<TimelineView snapshot={snapshot} locale="en" client={client} onToast={vi.fn()} />)

    const loadButton = await screen.findByRole('button', { name: 'Load history' })
    fireEvent.click(loadButton)
    await waitFor(() => expect(getTimelineWorkingHistory).toHaveBeenCalledWith('aurora', 'timeline-1', 'session-1', 0, 100, expect.any(AbortSignal)))
    // App.tsx is intentionally a large production surface.  Under a cold
    // `npm ci`/Vite worker the first React commit can exceed Testing Library's
    // one-second default even though the Core call has already resolved.
    expect(await screen.findByText(/#1 · Add marker/, {}, { timeout: 5000 })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Undo · #1/)).toBeTruthy(), { timeout: 5000 })
    await waitFor(() => expect(screen.getAllByText('bbbbbbbbbbbb')).toHaveLength(2), { timeout: 5000 })
    expect(screen.queryByText('provider')).toBeNull()
  })
})
