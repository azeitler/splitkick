import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyChatLink, openChatLink } from './chat-links'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import { openExternal } from '@/lib/platform'
import { invoke } from '@/lib/transport'
import { openUrlInEmbeddedBrowser } from '@/hooks/useBrowserPane'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type * as Environment from '@/lib/environment'
import type * as Transport from '@/lib/transport'

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof Environment>()),
  isNativeApp: vi.fn(),
  isLocalBackend: vi.fn(),
}))
vi.mock('@/lib/platform', () => ({ openExternal: vi.fn() }))
vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: vi.fn(),
}))
vi.mock('@/hooks/useBrowserPane', () => ({
  openUrlInEmbeddedBrowser: vi.fn(),
}))

function setEnvironment({
  native,
  local,
}: {
  native: boolean
  local: boolean
}) {
  vi.mocked(isNativeApp).mockReturnValue(native)
  vi.mocked(isLocalBackend).mockReturnValue(local)
}

describe('classifyChatLink', () => {
  it('sorts web links, local pages and other local files', () => {
    expect(classifyChatLink('https://example.com/a.html')).toBe('web')
    expect(classifyChatLink('HTTP://localhost:3000')).toBe('web')
    expect(classifyChatLink('out/report.html')).toBe('page')
    expect(classifyChatLink('/tmp/Report.HTM#top')).toBe('page')
    expect(classifyChatLink('file:///tmp/a.xhtml')).toBe('page')
    expect(classifyChatLink('C:\\site\\index.html')).toBe('page')
    expect(classifyChatLink('src/main.ts')).toBe('file')
    expect(classifyChatLink('file:///tmp/notes.md')).toBe('file')
  })

  it('ignores anchors, mailto and other schemes', () => {
    expect(classifyChatLink(undefined)).toBeNull()
    expect(classifyChatLink('#section')).toBeNull()
    expect(classifyChatLink('mailto:a@b.c')).toBeNull()
    expect(classifyChatLink('javascript:alert(1)')).toBeNull()
  })
})

describe('openChatLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(openExternal).mockResolvedValue(undefined)
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(openUrlInEmbeddedBrowser).mockResolvedValue(true)
    useChatStore.setState({ activeWorktreePath: '/repo/wt' })
    useUIStore.getState().setViewingFilePath(null)
  })

  it('opens web links in the embedded browser in the native app', () => {
    setEnvironment({ native: true, local: true })

    expect(openChatLink('https://example.com')).toBe(true)

    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith('https://example.com')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens web links in the system browser when asked or in web access', () => {
    setEnvironment({ native: true, local: true })
    openChatLink('https://example.com', { system: true })
    expect(openExternal).toHaveBeenCalledWith('https://example.com')

    vi.clearAllMocks()
    vi.mocked(openExternal).mockResolvedValue(undefined)
    setEnvironment({ native: false, local: false })
    openChatLink('https://example.com')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('falls back to the system browser when no browser surface exists', async () => {
    setEnvironment({ native: true, local: true })
    vi.mocked(openUrlInEmbeddedBrowser).mockResolvedValue(false)

    openChatLink('https://example.com')

    await vi.waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith('https://example.com')
    )
  })

  it('opens local pages as file URLs, keeping the fragment', () => {
    setEnvironment({ native: true, local: true })

    openChatLink('out/my%20report.html#summary')

    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'file:///repo/wt/out/my%20report.html#summary'
    )
    expect(useUIStore.getState().viewingFilePath).toBeNull()
  })

  it('opens local pages with the system app on Cmd-click', () => {
    setEnvironment({ native: true, local: true })

    openChatLink('/tmp/report.html', { system: true })

    expect(invoke).toHaveBeenCalledWith('open_path_in_default_app', {
      path: '/tmp/report.html',
    })
    expect(openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('shows local pages in the file viewer without the local backend', () => {
    setEnvironment({ native: true, local: false })

    openChatLink('out/report.html#summary')

    expect(useUIStore.getState().viewingFilePath).toBe(
      '/repo/wt/out/report.html'
    )
    expect(openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('keeps other local files in the file viewer', () => {
    setEnvironment({ native: true, local: true })

    expect(openChatLink('src/main.ts')).toBe(true)

    expect(useUIStore.getState().viewingFilePath).toBe('/repo/wt/src/main.ts')
    expect(openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('leaves links it does not handle to the default behaviour', () => {
    setEnvironment({ native: true, local: true })

    expect(openChatLink('mailto:a@b.c')).toBe(false)
    expect(openChatLink('#top')).toBe(false)
  })
})
