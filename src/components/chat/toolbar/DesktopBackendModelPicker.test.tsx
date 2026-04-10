import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import { DesktopBackendModelPicker } from './DesktopBackendModelPicker'

class ResizeObserverMock {
  observe() {
    return undefined
  }
  unobserve() {
    return undefined
  }
  disconnect() {
    return undefined
  }
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock)
HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
Element.prototype.scrollIntoView = vi.fn()

vi.mock('@/services/opencode-cli', () => ({
  useAvailableOpencodeModels: () => ({
    data: ['openai/gpt-5.4', 'groq/compound-mini'],
  }),
}))

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

describe('DesktopBackendModelPicker', () => {
  it('renders grouped backend sections and switches backend+model together', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    const onBackendModelChange = vi.fn()

    render(
      <DesktopBackendModelPicker
        selectedBackend="opencode"
        selectedModel="openai/gpt-5.4"
        selectedProvider={null}
        installedBackends={['claude', 'codex', 'opencode']}
        customCliProfiles={[]}
        onModelChange={onModelChange}
        onBackendModelChange={onBackendModelChange}
      />
    )

    await user.click(
      screen.getByRole('button', { name: /choose backend and model/i })
    )

    const popover = await screen.findByPlaceholderText(
      'Search backends and models...'
    )
    const list = popover.closest('[data-slot="popover-content"]')
    expect(list).not.toBeNull()

    expect(within(list as HTMLElement).getByText('Claude')).toBeInTheDocument()
    expect(within(list as HTMLElement).getByText('Codex')).toBeInTheDocument()
    expect(
      within(list as HTMLElement).getByText('OpenCode')
    ).toBeInTheDocument()

    await user.click(within(list as HTMLElement).getByText('GPT 5.4'))

    expect(onBackendModelChange).toHaveBeenCalledWith('codex', 'gpt-5.4')
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('searches across all sections and changes model only inside current backend', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    const onBackendModelChange = vi.fn()

    render(
      <DesktopBackendModelPicker
        selectedBackend="codex"
        selectedModel="gpt-5.3"
        selectedProvider={null}
        installedBackends={['claude', 'codex', 'opencode']}
        customCliProfiles={[]}
        onModelChange={onModelChange}
        onBackendModelChange={onBackendModelChange}
      />
    )

    await user.click(
      screen.getByRole('button', { name: /choose backend and model/i })
    )

    const searchInput = await screen.findByPlaceholderText(
      'Search backends and models...'
    )
    await user.type(searchInput, 'compound mini')

    expect(screen.getByText('Compound Mini (Groq)')).toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, 'gpt 5.4')
    await user.click(screen.getByText('GPT 5.4'))

    expect(onModelChange).toHaveBeenCalledWith('gpt-5.4')
    expect(onBackendModelChange).not.toHaveBeenCalled()
  })

  it('locks sections to the current backend once the session has messages', async () => {
    const user = userEvent.setup()

    render(
      <DesktopBackendModelPicker
        sessionHasMessages
        selectedBackend="codex"
        selectedModel="gpt-5.4"
        selectedProvider={null}
        installedBackends={['claude', 'codex', 'opencode']}
        customCliProfiles={[]}
        onModelChange={vi.fn()}
        onBackendModelChange={vi.fn()}
      />
    )

    await user.click(
      screen.getByRole('button', { name: /choose backend and model/i })
    )

    const popover = await screen.findByPlaceholderText(
      'Search backends and models...'
    )
    const list = popover.closest('[data-slot="popover-content"]')

    expect(
      within(list as HTMLElement).queryByText('Claude')
    ).not.toBeInTheDocument()
    expect(within(list as HTMLElement).getByText('Codex')).toBeInTheDocument()
    expect(
      within(list as HTMLElement).queryByText('OpenCode')
    ).not.toBeInTheDocument()
  })
})
