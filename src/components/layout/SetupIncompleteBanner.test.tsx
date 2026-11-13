import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import { SetupIncompleteBanner } from './SetupIncompleteBanner'

const mocks = vi.hoisted(() => ({
  cursorInstalled: true,
  cursorAuthenticated: true,
  kimiStatusFailed: false,
}))

function statusResult(installed = false) {
  return { data: { installed }, isLoading: false }
}

function authResult(authenticated = false) {
  return { data: { authenticated }, isLoading: false, isFetching: false }
}

vi.mock('@/lib/environment', () => ({ isNativeApp: () => true }))

vi.mock('@/services/claude-cli', () => ({
  useClaudeCliStatus: () => statusResult(),
  useClaudeCliAuth: () => authResult(),
}))

vi.mock('@/services/codex-cli', () => ({
  useCodexCliStatus: () => statusResult(),
  useCodexCliAuth: () => authResult(),
}))

vi.mock('@/services/opencode-cli', () => ({
  useOpencodeCliStatus: () => statusResult(),
  useOpencodeCliAuth: () => authResult(),
}))

vi.mock('@/services/cursor-cli', () => ({
  useCursorCliStatus: () => statusResult(mocks.cursorInstalled),
  useCursorCliAuth: () => authResult(mocks.cursorAuthenticated),
}))

vi.mock('@/services/pi-cli', () => ({
  usePiCliStatus: () => statusResult(),
  usePiCliAuth: () => authResult(),
}))

vi.mock('@/services/commandcode-cli', () => ({
  useCommandCodeCliStatus: () => statusResult(),
  useCommandCodeCliAuth: () => authResult(),
}))

vi.mock('@/services/grok-cli', () => ({
  useGrokCliStatus: () => statusResult(),
  useGrokCliAuth: () => authResult(),
}))

vi.mock('@/services/kimi-cli', () => ({
  useKimiCliStatus: () =>
    mocks.kimiStatusFailed
      ? { data: undefined, isLoading: false, isError: true }
      : statusResult(),
  useKimiCliAuth: () => authResult(),
}))

// GitHub CLI is not installed: it is optional and must not affect the banner.
vi.mock('@/services/gh-cli', () => ({
  useGhCliStatus: () => statusResult(false),
  useGhCliAuth: () => authResult(false),
}))

describe('SetupIncompleteBanner', () => {
  beforeEach(() => {
    mocks.cursorInstalled = true
    mocks.cursorAuthenticated = true
    mocks.kimiStatusFailed = false
    useUIStore.setState({ onboardingDismissed: true, onboardingOpen: false })
  })

  it('treats an authenticated Cursor installation as a ready AI backend', () => {
    render(<SetupIncompleteBanner />)

    expect(screen.queryByText(/setup incomplete/i)).not.toBeInTheDocument()
  })

  it('hides the banner with one AI backend ready and no GitHub CLI', () => {
    render(<SetupIncompleteBanner />)

    expect(screen.queryByText(/setup incomplete/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/GitHub CLI/i)).not.toBeInTheDocument()
  })

  it('shows setup as incomplete when Cursor is not authenticated', () => {
    mocks.cursorAuthenticated = false

    render(<SetupIncompleteBanner />)

    expect(screen.getByText(/setup incomplete/i)).toBeInTheDocument()
  })

  it('hides the banner when a status check failed (e.g. remote timeout)', () => {
    mocks.cursorAuthenticated = false
    mocks.kimiStatusFailed = true

    render(<SetupIncompleteBanner />)

    expect(screen.queryByText(/setup incomplete/i)).not.toBeInTheDocument()
  })
})
