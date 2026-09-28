import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NeedsView, copy } from '../src/App'
import type { DashboardSnapshot, DecisionRequest } from '../src/types'

const decision: DecisionRequest = {
  id: 'decision-1', projectId: 'project-1', projectName: 'Phim thử', decisionType: 'RIGHTS_REVIEW',
  title: 'Xác nhận quyền', titleKey: 'rights.title', detail: 'Cần xác nhận trước khi tiếp tục',
  reason: 'Bằng chứng quyền phát hành vẫn chưa đầy đủ.', reasonKey: 'rights.reason',
  blockingScopeType: 'PROJECT', blockingScopeId: 'project-1', severity: 'HIGH', state: 'OPEN', decisionVersion: 3,
  choices: [{ id: 'hold', label: 'Giữ nội bộ', recommended: true }, { id: 'release', label: 'Cho phép phát hành' }],
  recommendedChoiceId: 'hold', defaultBehavior: 'Không phát hành', requiredAuthority: 'RIGHTS_OWNER',
  evidence: [{ kind: 'RIGHTS', status: 'UNKNOWN' }], age: 'Vừa xong', priority: 'high', actionLabel: 'Xem chi tiết',
}

function snapshot(): DashboardSnapshot {
  return { generatedAt: new Date().toISOString(), projects: [], decisions: [decision], activity: [], system: { connected: true, offline: false, storageUsed: '0 B', storageTotal: '—', storageAttention: false } }
}

describe('Needs You decision surface', () => {
  it('shows canonical evidence and choices, then emits the selected choice', () => {
    const onResolve = vi.fn()
    const onDismiss = vi.fn()
    render(<NeedsView snapshot={snapshot()} t={copy.vi} locale="vi" onOpenDecision={vi.fn()} onResolve={onResolve} onDismiss={onDismiss} pendingId={null} decisionError={null} onRefresh={vi.fn()} />)

    expect(screen.getByText('Bằng chứng quyền phát hành vẫn chưa đầy đủ.')).toBeTruthy()
    expect(screen.getByText('PROJECT · project-1')).toBeTruthy()
    expect(screen.getByText('Khuyến nghị')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Giữ nội bộ Khuyến nghị' }))
    expect(onResolve).toHaveBeenCalledWith(decision, 'hold')
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }))
    expect(onDismiss).toHaveBeenCalledWith(decision)
  })

  it('keeps the choice disabled while pending and makes stale ownership explicit in English', () => {
    const onRefresh = vi.fn()
    render(<NeedsView snapshot={snapshot()} t={copy.en} locale="en" onOpenDecision={vi.fn()} onResolve={vi.fn()} onDismiss={vi.fn()} pendingId="decision-1" decisionError={{ id: 'decision-1', message: 'This decision changed.' }} onRefresh={onRefresh} />)

    expect(screen.getByText('This decision changed.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Giữ nội bộ/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[1])
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
