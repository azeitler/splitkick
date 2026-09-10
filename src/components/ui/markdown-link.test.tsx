import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { Markdown } from './markdown'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import { openExternal } from '@/lib/platform'
import { openUrlInEmbeddedBrowser } from '@/hooks/useBrowserPane'
import { useChatStore } from '@/store/chat-store'
import type * as Environment from '@/lib/environment'
import type * as Platform from '@/lib/platform'
import type * as BrowserPane from '@/hooks/useBrowserPane'

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof Environment>()),
  isNativeApp: vi.fn(),
  isLocalBackend: vi.fn(),
}))
vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<typeof Platform>()),
  openExternal: vi.fn(),
}))
vi.mock('@/hooks/useBrowserPane', async importOriginal => ({
  ...(await importOriginal<typeof BrowserPane>()),
  openUrlInEmbeddedBrowser: vi.fn(),
}))

function setNative(native: boolean) {
  vi.mocked(isNativeApp).mockReturnValue(native)
  vi.mocked(isLocalBackend).mockReturnValue(native)
}

describe('Markdown links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(openExternal).mockResolvedValue(undefined)
    vi.mocked(openUrlInEmbeddedBrowser).mockResolvedValue(true)
    useChatStore.setState({ activeWorktreePath: '/repo/wt' })
    setNative(true)
  })

  it('opens web links in the embedded browser, with a system-browser button', () => {
    render(<Markdown>{'See [the docs](https://example.com/docs).'}</Markdown>)

    fireEvent.click(screen.getByRole('link', { name: 'the docs' }))
    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'https://example.com/docs'
    )
    expect(openExternal).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Open in system browser' })
    )
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('opens web links in the system browser on Cmd-click', () => {
    render(<Markdown>{'https://example.com/a'}</Markdown>)

    fireEvent.click(
      screen.getByRole('link', { name: 'https://example.com/a' }),
      {
        metaKey: true,
      }
    )

    expect(openExternal).toHaveBeenCalledWith('https://example.com/a')
    expect(openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('links HTML paths in plain text and inline code to the embedded browser', () => {
    render(
      <Markdown>
        {'Wrote out/report.html. Also `/tmp/other.html`, not `src/app.ts`.'}
      </Markdown>
    )

    fireEvent.click(screen.getByRole('link', { name: 'out/report.html' }))
    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'file:///repo/wt/out/report.html'
    )

    const codeLink = screen.getByRole('link', { name: '/tmp/other.html' })
    expect(codeLink.querySelector('code')).not.toBeNull()
    fireEvent.click(codeLink)
    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'file:///tmp/other.html'
    )

    expect(screen.queryByRole('link', { name: 'src/app.ts' })).toBeNull()
  })

  it('keeps file:// link targets instead of blanking them', () => {
    render(<Markdown>{'[report](file:///tmp/report.html)'}</Markdown>)

    const link = screen.getByRole('link', { name: 'report' })
    expect(link.getAttribute('href')).toBe('file:///tmp/report.html')
    fireEvent.click(link)
    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'file:///tmp/report.html'
    )
  })

  it('keeps Windows backslash paths, which markdown encodes as %5C', () => {
    render(<Markdown>{'[report](C:\\site\\report.html)'}</Markdown>)

    const link = screen.getByRole('link', { name: 'report' })
    expect(link.getAttribute('href')).not.toBe('')
    fireEvent.click(link)
    expect(openUrlInEmbeddedBrowser).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openUrlInEmbeddedBrowser).mock.calls[0]?.[0]).toMatch(
      /^file:\/\/\/C:\/site\/report\.html$/i
    )
  })

  it('shows no system-browser button in web access', () => {
    setNative(false)
    render(
      <Markdown>{'[docs](https://example.com) and out/report.html'}</Markdown>
    )

    expect(
      screen.queryByRole('button', { name: 'Open in system browser' })
    ).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'docs' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('leaves mailto links to the global interceptor', () => {
    render(<Markdown>{'[mail](mailto:a@b.c)'}</Markdown>)

    const link = screen.getByRole('link', { name: 'mail' })
    expect(link.hasAttribute('data-chat-link')).toBe(false)
    expect(
      screen.queryByRole('button', { name: 'Open in system browser' })
    ).toBeNull()
  })
})
