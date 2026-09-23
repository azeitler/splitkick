import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyChatLink, openChatLink, resolveLocalPath } from './chat-links'
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
    expect(classifyChatLink('data/rows.json')).toBe('file')
  })

  it('sorts the other file types the browser pane can show as pages', () => {
    for (const href of [
      'out/chart.svg',
      'shots/run.PNG',
      '/tmp/report.pdf',
      'media/clip.mp4',
      'file:///tmp/notes.md',
      'build/output.log',
    ]) {
      expect(classifyChatLink(href)).toBe('page')
    }
  })

  it('reads # and ? in a file name as part of the name', () => {
    expect(classifyChatLink('reports/q#1?draft.html')).toBe('page')
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
      'file:///repo/wt/out/my%20report.html#summary',
      // The pane shows what was written, decoded, not the file URL.
      'out/my report.html'
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

describe('resolveLocalPath with a home-relative path', () => {
  it('does not join ~/… onto the root', () => {
    // `<root>/~/a.md` never exists; only the backend can expand `~`.
    expect(resolveLocalPath('~/Downloads/a.md', '/repo/worktree')).toBeNull()
    expect(resolveLocalPath('~', '/repo/worktree')).toBeNull()
  })

  it('still joins a name that merely contains a tilde', () => {
    expect(resolveLocalPath('docs/~draft.md', '/repo/worktree')).toBe(
      '/repo/worktree/docs/~draft.md'
    )
  })
})

describe('resolveLocalPath with .. segments', () => {
  it('joins a parent-relative path without leaving .. in it', () => {
    expect(resolveLocalPath('../shared/api.md', '/repo/worktree')).toBe(
      '/repo/shared/api.md'
    )
    expect(resolveLocalPath('../../notes.md', '/repo/worktree')).toBe(
      '/notes.md'
    )
  })

  it('cleans an absolute path that holds ..', () => {
    expect(resolveLocalPath('/repo/worktree/../x.md', '/other')).toBe(
      '/repo/x.md'
    )
  })
})

describe('openChatLink keeps the written reference for display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvironment({ native: true, local: true })
    useUIStore.getState().setViewingFilePath(null)
  })

  it('opens the resolved file but labels the viewer with what was written', () => {
    expect(
      openChatLink('~/Downloads/data.json', {
        resolvedPath: '/Users/me/Downloads/data.json',
      })
    ).toBe(true)

    const state = useUIStore.getState()
    expect(state.viewingFilePath).toBe('/Users/me/Downloads/data.json')
    expect(state.viewingFileLabel).toBe('~/Downloads/data.json')
  })

  it('gives the pane the written reference too', () => {
    openChatLink('~/Downloads/report.html', {
      resolvedPath: '/Users/me/Downloads/report.html',
    })

    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'file:///Users/me/Downloads/report.html',
      '~/Downloads/report.html'
    )
  })

  it('decodes an encoded reference for display', () => {
    openChatLink('file:///Users/me/My%20Files/a.json', {
      resolvedPath: '/Users/me/My Files/a.json',
    })

    expect(useUIStore.getState().viewingFileLabel).toBe(
      '/Users/me/My Files/a.json'
    )
  })
})
