import { describe, expect, it } from 'vitest'
import {
  mergeTimelineWorkingHistory,
  timelineHistoryActionLabel,
  timelineHistoryHashPreview,
  timelineHistoryOperationLabel,
  timelineHistoryStateLabel,
} from './App'
import type { TimelineWorkingHistory } from './types'

const page = (overrides: Partial<TimelineWorkingHistory> = {}): TimelineWorkingHistory => ({
  timeline: { id: 'timeline-1', projectId: 'project-1', title: 'Main', code: 'MAIN', scopeType: 'PROJECT', scopeId: 'project-1', rowVersion: 1, state: 'ACTIVE' },
  workingSessionId: 'session-1',
  operations: [],
  historyActions: [],
  cursor: { afterOpSeq: 0, hasMore: false },
  ...overrides,
})

describe('Timeline working-session history presentation', () => {
  it('merges pages by sequence, replaces duplicate evidence, and preserves cursor metadata', () => {
    const first = page({
      operations: [
        { id: 'op-2', opSeq: 2, opType: 'MOVE_CLIP', historyState: 'ACTIVE', resultHash: 'old' },
        { id: 'op-1', opSeq: 1, opType: 'ADD_MARKER', historyState: 'ACTIVE' },
      ],
      historyActions: [{ id: 'action-1', actionSeq: 1, actionType: 'UNDO', targetOpSeq: 1 }],
      cursor: { afterOpSeq: 2, hasMore: true },
    })
    const second = page({
      operations: [
        { id: 'op-2', opSeq: 2, opType: 'MOVE_CLIP', historyState: 'UNDONE', resultHash: 'new' },
        { id: 'op-3', opSeq: 3, opType: 'TRIM_CLIP', historyState: 'ACTIVE' },
      ],
      historyActions: [{ id: 'action-2', actionSeq: 2, actionType: 'REDO', targetOpSeq: 2 }],
      cursor: { afterOpSeq: 3, hasMore: false },
    })

    const merged = mergeTimelineWorkingHistory(first, second)
    expect(merged.operations.map((operation) => operation.opSeq)).toEqual([1, 2, 3])
    expect(merged.operations.find((operation) => operation.opSeq === 2)).toMatchObject({ historyState: 'UNDONE', resultHash: 'new' })
    expect(merged.historyActions.map((action) => action.actionSeq)).toEqual([1, 2])
    expect(merged.cursor).toEqual({ afterOpSeq: 3, hasMore: false })
  })

  it('uses bounded labels for known and unknown operation evidence', () => {
    expect(timelineHistoryOperationLabel('ADD_MARKER', 'vi')).toBe('Thêm marker')
    expect(timelineHistoryOperationLabel('unknown_provider_operation', 'en')).toBe('Other operation')
    expect(timelineHistoryStateLabel('UNDONE', 'vi')).toBe('Đã undo')
    expect(timelineHistoryActionLabel('DISCARD_REDO_BRANCH', 'en')).toBe('Discard redo branch')
    expect(timelineHistoryHashPreview('a'.repeat(64))).toBe('aaaaaaaaaaaa')
    expect(timelineHistoryHashPreview('provider-secret')).toBe('—')
  })
})
