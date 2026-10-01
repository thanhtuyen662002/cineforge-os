import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('cineforge-locale', 'en')
  window.__CINEFORGE_CORE_BASE_URL__ = 'http://core'
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('Core connection refused')
  }))
})

afterEach(() => {
  delete window.__CINEFORGE_CORE_BASE_URL__
  vi.unstubAllGlobals()
})

it('shows a production Core-unavailable state instead of demo data when the live endpoint fails', async () => {
  render(<App />)

  expect(await screen.findByRole('heading', { name: 'CineForge Core is unavailable.' })).toBeTruthy()
  expect(screen.getByText(/The production app requires the local Core to be ready/)).toBeTruthy()
  expect(screen.getByText(/Core connection refused/)).toBeTruthy()
  expect(screen.queryByText('Aurora — Mùa mưa cuối')).toBeNull()
})
