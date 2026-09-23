import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { BrowserToolbar } from './BrowserToolbar'
import { useBrowserStore } from '@/store/browser-store'

const actionsMock = vi.hoisted(() => ({
  navigate: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  focus: vi.fn(),
  enableGrab: vi.fn(),
}))

vi.mock('@/hooks/useBrowserPane', () => ({
  useBrowserTabActions: () => actionsMock,
  browserBackend: {
    close: vi.fn(),
  },
}))

describe('BrowserToolbar grab control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actionsMock.enableGrab.mockResolvedValue(undefined)
    useBrowserStore.setState({
      tabs: {},
      activeTabIds: {},
      sidePaneOpen: {},
      modalOpen: {},
      bottomPanelOpen: {},
    })
    useBrowserStore.getState().addTab('worktree-1', 'http://localhost:3000')
  })

  it('enables React Grab for the active tab when the Grab button is clicked', async () => {
    render(<BrowserToolbar worktreeId="worktree-1" />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Grab DOM element' })
    )

    expect(actionsMock.enableGrab).toHaveBeenCalledTimes(1)
  })
})

describe('BrowserToolbar with a tab opened from a chat reference', () => {
  const FILE_URL = 'file:///Users/me/Downloads/report.html'
  const REFERENCE = '~/Downloads/report.html'

  beforeEach(() => {
    vi.clearAllMocks()
    useBrowserStore.setState({
      tabs: {},
      activeTabIds: {},
      sidePaneOpen: {},
      modalOpen: {},
      bottomPanelOpen: {},
    })
  })

  it('shows what was written, not the path it resolved to', () => {
    useBrowserStore.getState().addTab('worktree-1', FILE_URL, REFERENCE)

    render(<BrowserToolbar worktreeId="worktree-1" />)

    expect(screen.getByPlaceholderText('Search or enter URL')).toHaveValue(
      REFERENCE
    )
    // The tab is named after the reference as well.
    expect(screen.getByRole('tab')).toHaveAttribute('title', REFERENCE)
    expect(screen.getByRole('tab')).toHaveTextContent('report.html')
  })

  it('stays on the tab when Enter is pressed on the untouched reference', async () => {
    useBrowserStore.getState().addTab('worktree-1', FILE_URL, REFERENCE)

    render(<BrowserToolbar worktreeId="worktree-1" />)
    const input = screen.getByPlaceholderText('Search or enter URL')
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')

    // Not `https://~/Downloads/report.html`, which is what a plain
    // normalizeUrl() would make of it.
    expect(actionsMock.navigate).toHaveBeenCalledWith(FILE_URL)
  })

  it('shows the URL for a tab that was not opened from a reference', () => {
    useBrowserStore.getState().addTab('worktree-1', 'https://example.com/')

    render(<BrowserToolbar worktreeId="worktree-1" />)

    expect(screen.getByPlaceholderText('Search or enter URL')).toHaveValue(
      'https://example.com/'
    )
  })
})
