import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import { BackendModelPickerContent } from './BackendModelPickerContent'

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

describe('BackendModelPickerContent', () => {
  it('renders grouped backend sections and switches backend+model together', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    const onBackendModelChange = vi.fn()
    const onRequestClose = vi.fn()

    render(
      <BackendModelPickerContent
        open
        selectedBackend="opencode"
        selectedModel="openai/gpt-5.4"
        selectedProvider={null}
        installedBackends={['claude', 'codex', 'opencode']}
        customCliProfiles={[]}
        onModelChange={onModelChange}
        onBackendModelChange={onBackendModelChange}
        onRequestClose={onRequestClose}
      />
    )

    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('OpenCode')).toBeInTheDocument()

    await user.click(screen.getByText('GPT 5.4'))

    expect(onBackendModelChange).toHaveBeenCalledWith('codex', 'gpt-5.4')
    expect(onModelChange).not.toHaveBeenCalled()
    expect(onRequestClose).toHaveBeenCalled()
  })

  it('searches across all sections and changes model inside current backend', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    const onBackendModelChange = vi.fn()

    render(
      <BackendModelPickerContent
        open
        selectedBackend="codex"
        selectedModel="gpt-5.3"
        selectedProvider={null}
        installedBackends={['claude', 'codex', 'opencode']}
        customCliProfiles={[]}
        onModelChange={onModelChange}
        onBackendModelChange={onBackendModelChange}
        onRequestClose={vi.fn()}
      />
    )

    const searchInput = screen.getByPlaceholderText(
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

  it('locks sections to the current backend once the session has messages', () => {
    const { container } = render(
      <BackendModelPickerContent
        open
        sessionHasMessages
        selectedBackend="codex"
        selectedModel="gpt-5.4"
        selectedProvider={null}
        installedBackends={['claude', 'codex', 'opencode']}
        customCliProfiles={[]}
        onModelChange={vi.fn()}
        onBackendModelChange={vi.fn()}
        onRequestClose={vi.fn()}
      />
    )

    const command = container.querySelector('[data-slot="command"]')
    expect(command).not.toBeNull()
    expect(
      within(command as HTMLElement).queryByText('Claude')
    ).not.toBeInTheDocument()
    expect(
      within(command as HTMLElement).getByText('Codex')
    ).toBeInTheDocument()
    expect(
      within(command as HTMLElement).queryByText('OpenCode')
    ).not.toBeInTheDocument()
  })
})
