import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { FeatureTourDialog } from './FeatureTourDialog'
import type * as EnvironmentModule from '@/lib/environment'

const mocks = vi.hoisted(() => ({
  patchPreferencesMutate: vi.fn(),
  nativeApp: true,
  mobile: false,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof EnvironmentModule>()),
  isNativeApp: () => mocks.nativeApp,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.mobile,
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      has_seen_feature_tour: false,
    },
  }),
  usePatchPreferences: () => ({ mutate: mocks.patchPreferencesMutate }),
}))

function renderTour() {
  act(() => {
    useUIStore.setState({ featureTourOpen: true })
  })

  return render(<FeatureTourDialog />)
}

describe('FeatureTourDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nativeApp = true
    mocks.mobile = false
    act(() => {
      useUIStore.setState({ featureTourOpen: false })
    })
  })

  afterEach(() => {
    act(() => {
      useUIStore.setState({ featureTourOpen: false })
    })
  })

  it('opens with Magic Menu automation instead of shortcut memorization', () => {
    renderTour()

    expect(
      screen.getByRole('dialog', { name: /start with the magic menu/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/automate everyday dev tasks/i)).toBeInTheDocument()
    expect(screen.getByText(/commit, push, open prs/i)).toBeInTheDocument()
    expect(screen.getByText(/resolve conflicts/i)).toBeInTheDocument()
  })

  it('teaches every AI backend before keybindings', async () => {
    const user = userEvent.setup()
    renderTour()

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(
      screen.getByRole('heading', { name: /bring your favorite ai backend/i })
    ).toBeInTheDocument()
    for (const backend of [
      'Claude',
      'Codex',
      'OpenCode',
      'Cursor',
      'Pi',
      'Command Code',
    ]) {
      expect(screen.getByText(backend)).toBeInTheDocument()
    }

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(
      screen.getByRole('heading', { name: /mr\. robot/i })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(
      screen.getByRole('heading', { name: /keyboard shortcuts/i })
    ).toBeInTheDocument()
  })

  it('marks the tour as seen when finished', async () => {
    const user = userEvent.setup()
    renderTour()

    for (let i = 0; i < 5; i += 1) {
      await user.click(screen.getByRole('button', { name: /next/i }))
    }
    await user.click(screen.getByRole('button', { name: /done/i }))

    expect(mocks.patchPreferencesMutate).toHaveBeenCalledWith({
      has_seen_feature_tour: true,
    })
    expect(useUIStore.getState().featureTourOpen).toBe(false)
  })

  it('shows progress and goes back one step', async () => {
    const user = userEvent.setup()
    renderTour()

    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^back$/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /start with the magic menu/i })
    ).toBeInTheDocument()
  })

  it('keeps the list in a scroll area between a fixed header and footer', () => {
    renderTour()

    const body = screen.getByTestId('feature-tour-body')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('min-h-0')
    expect(screen.getByRole('dialog').className).toContain(
      'max-h-[calc(100dvh-2rem)]'
    )
  })

  it('shows keyboard hints and keys in the native desktop app', async () => {
    const user = userEvent.setup()
    renderTour()

    expect(screen.getByRole('button', { name: /skip/i })).toHaveTextContent('S')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
  })

  it.each([
    ['Web Access', { nativeApp: false, mobile: false }],
    ['mobile', { nativeApp: true, mobile: true }],
  ])('hides keyboard hints and keys in %s', async (_label, env) => {
    mocks.nativeApp = env.nativeApp
    mocks.mobile = env.mobile
    const user = userEvent.setup()
    renderTour()

    expect(screen.getByRole('button', { name: /skip/i })).toHaveTextContent(
      /^Skip$/
    )
    expect(screen.getByRole('button', { name: /next/i })).toHaveTextContent(
      /^Next$/
    )
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })
})
