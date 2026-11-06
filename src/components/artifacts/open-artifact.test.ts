import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import { openArtifact } from './open-artifact'

const mocks = vi.hoisted(() => ({
  openChatLink: vi.fn(() => true),
  openExternal: vi.fn(async () => undefined),
  openFileInBrowser: vi.fn(async () => undefined),
}))

vi.mock('@/lib/chat-links', async importOriginal => ({
  ...(await importOriginal<object>()),
  openChatLink: mocks.openChatLink,
}))
vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<object>()),
  openExternal: mocks.openExternal,
}))
vi.mock('@/components/artifact-preview/open-in-browser', () => ({
  openFileInBrowser: mocks.openFileInBrowser,
}))

describe('openArtifact (#107)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.getState().setViewingFilePath(null)
  })

  it('opens a URL in the in-app browser, or the system browser', () => {
    const url = { title: 'Preview', target: 'https://preview.example.dev' }
    openArtifact(url, '/wt')
    expect(mocks.openChatLink).toHaveBeenCalledWith(url.target)
    openArtifact(url, '/wt', { system: true })
    expect(mocks.openExternal).toHaveBeenCalledWith(url.target)
  })

  it('opens an HTML file in the file viewer (sandboxed preview)', () => {
    openArtifact({ title: 'Report', target: '/wt/out/report.html' }, '/wt')
    expect(useUIStore.getState().viewingFilePath).toBe('/wt/out/report.html')
    // The viewer picks the preview from this name, so never the title.
    expect(useUIStore.getState().viewingFileLabel).toBeNull()
    expect(mocks.openChatLink).not.toHaveBeenCalled()
  })

  it('resolves a relative path and a file URL', () => {
    openArtifact({ title: 'Shot', target: 'tmp/shot.png' }, '/wt')
    expect(useUIStore.getState().viewingFilePath).toBe('/wt/tmp/shot.png')
    openArtifact({ title: 'Doc', target: 'file:///wt/my%20doc.md' }, '/wt')
    expect(useUIStore.getState().viewingFilePath).toBe('/wt/my doc.md')
  })

  it('opens a file outside Splitkick with the default app', () => {
    openArtifact({ title: 'Report', target: '/wt/report.html' }, '/wt', {
      system: true,
    })
    expect(mocks.openFileInBrowser).toHaveBeenCalledWith('/wt/report.html')
    expect(useUIStore.getState().viewingFilePath).toBeNull()
  })
})
