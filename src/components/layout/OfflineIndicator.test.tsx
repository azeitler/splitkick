import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const offline = vi.hoisted(() => ({ backend: false, models: false }))

vi.mock('@/lib/backend-online', () => ({
  useBackendOffline: () => offline.backend,
  useModelsOffline: () => offline.models,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}))

import {
  SidebarOfflineStatus,
  useOfflineReason,
  useSidebarFooterShown,
} from './OfflineIndicator'

describe('OfflineIndicator', () => {
  beforeEach(() => {
    offline.backend = false
    offline.models = false
  })

  it('shows nothing while everything is reachable', () => {
    render(<SidebarOfflineStatus />)
    expect(screen.queryByTestId('offline-indicator')).toBeNull()
    expect(renderHook(() => useOfflineReason()).result.current).toBeNull()
  })

  it('says the backend is offline and that it reconnects', () => {
    offline.backend = true
    render(<SidebarOfflineStatus />)

    const sign = screen.getByRole('status')
    expect(sign).toHaveTextContent('Offline')
    expect(sign).toHaveAttribute('data-reason', 'backend')
    expect(sign).toHaveAccessibleName('Offline. Reconnecting…')
    expect(screen.getByTestId('tooltip')).toHaveTextContent(
      'Offline. Reconnecting…'
    )
  })

  it('says the models cannot be reached when the local machine has no internet', () => {
    offline.models = true
    render(<SidebarOfflineStatus />)

    const sign = screen.getByRole('status')
    expect(sign).toHaveTextContent('No internet')
    expect(sign).toHaveAttribute('data-reason', 'models')
    expect(sign).toHaveAccessibleName(
      'No internet. The models cannot be reached.'
    )
  })

  // No backend means no models either: name the nearer cause.
  it('names the backend when both are unreachable', () => {
    offline.backend = true
    offline.models = true
    expect(renderHook(() => useOfflineReason()).result.current).toBe('backend')
  })

  // The chat window shows the sign itself only while no footer does.
  it('tells the chat window whether a sidebar footer is on screen', () => {
    const { result } = renderHook(() => useSidebarFooterShown())
    expect(result.current).toBe(false)

    const first = render(<SidebarOfflineStatus />)
    expect(result.current).toBe(true)
    const second = render(<SidebarOfflineStatus />)
    first.unmount()
    expect(result.current).toBe(true)
    second.unmount()
    expect(result.current).toBe(false)
  })
})
