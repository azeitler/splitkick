import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import type * as Platform from '@/lib/platform'
import { ImagePreviewDialog } from './ImageLightbox'

const mocks = vi.hoisted(() => ({
  isLocalBackend: vi.fn(() => true),
  isNativeApp: vi.fn(() => true),
  openInPane: vi.fn(async (_url: string) => true),
  onOpenChange: vi.fn(),
  reveal: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  copyImageToClipboard: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  isLocalBackend: () => mocks.isLocalBackend(),
  canOpenNativeApps: () => mocks.isLocalBackend(),
  isNativeApp: () => mocks.isNativeApp(),
}))

vi.mock('@/hooks/useBrowserPane', () => ({
  openUrlInEmbeddedBrowser: (url: string) => mocks.openInPane(url),
}))

vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<typeof Platform>()),
  openExternal: mocks.openExternal,
}))

vi.mock('@/lib/clipboard', () => ({
  copyImageToClipboard: mocks.copyImageToClipboard,
}))

vi.mock('@/services/projects', () => ({
  useRevealPathInFileManager: () => ({ mutate: mocks.reveal }),
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

const REMOTE_SRC =
  'https://remote.example.com/api/files/pasted-images/shot.png?token=t'

function renderDialog(src: string, path?: string) {
  render(
    <ImagePreviewDialog
      open
      onOpenChange={mocks.onOpenChange}
      src={src}
      alt="shot"
      path={path}
    />
  )
}

describe('ImagePreviewDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isLocalBackend.mockReturnValue(true)
    mocks.isNativeApp.mockReturnValue(true)
    mocks.openInPane.mockResolvedValue(true)
    mocks.copyImageToClipboard.mockResolvedValue(undefined)
  })

  it('renders the image inside the zoom container', () => {
    renderDialog('asset://shot.png')

    const img = screen.getByRole('img', { name: 'shot' })
    expect(img.closest('.react-transform-component')).not.toBeNull()
    expect(img.closest('.react-transform-wrapper')).not.toBeNull()
  })

  it('native local session: Reveal and Copy image, no Open in browser', async () => {
    const user = userEvent.setup()
    renderDialog('asset://localhost/shot.png', '/tmp/shot.png')

    await user.click(screen.getByRole('button', { name: /Reveal in/ }))
    expect(mocks.reveal).toHaveBeenCalledWith('/tmp/shot.png')
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull()
  })

  it('native remote session: Open in browser, Reveal disabled', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    const user = userEvent.setup()
    renderDialog(REMOTE_SRC, '/remote/app-data/pasted-images/shot.png')

    const reveal = screen.getByRole('button', { name: /Reveal in/ })
    expect(reveal).toBeDisabled()
    expect(reveal).toHaveTextContent('Host only')
    await user.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(mocks.openExternal).toHaveBeenCalledWith(REMOTE_SRC)
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeVisible()
  })

  it('web access: Open in browser with the served URL, Reveal disabled', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    const user = userEvent.setup()
    const src = '/api/files/pasted-images/shot.png?token=t'
    renderDialog(src, '/srv/app-data/pasted-images/shot.png')

    const reveal = screen.getByRole('button', { name: /Reveal in/ })
    expect(reveal).toBeDisabled()
    expect(reveal).toHaveTextContent('Host only')
    expect(mocks.reveal).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(mocks.openExternal).toHaveBeenCalledWith(src)
  })

  it('offers no Open in browser for an inline data URL', () => {
    mocks.isLocalBackend.mockReturnValue(false)
    renderDialog('data:image/png;base64,AAAA')

    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeVisible()
  })

  it('copies the image itself and confirms', async () => {
    const user = userEvent.setup()
    renderDialog('asset://localhost/shot.png', '/tmp/shot.png')

    await user.click(screen.getByRole('button', { name: 'Copy image' }))

    expect(mocks.copyImageToClipboard).toHaveBeenCalledWith(
      'asset://localhost/shot.png'
    )
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Image copied')
    )
  })

  it('toasts the error when the copy fails', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    mocks.copyImageToClipboard.mockRejectedValue(new Error('Copy failed: nope'))
    const user = userEvent.setup()
    renderDialog(REMOTE_SRC)

    await user.click(screen.getByRole('button', { name: 'Copy image' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Copy failed: nope')
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  describe('keyboard zoom', () => {
    // Both modifiers set: the handler uses Cmd on native macOS, Ctrl elsewhere.
    const press = (key: string) =>
      fireEvent.keyDown(document.body, { key, metaKey: true, ctrlKey: true })
    const scaleOf = () => {
      const content = screen
        .getByRole('img', { name: 'shot' })
        .closest<HTMLElement>('.react-transform-component')
      const match = /scale\(([\d.]+)\)/.exec(content?.style.transform ?? '')
      return match ? Number(match[1]) : 1
    }

    it('zooms in, out and resets the image', async () => {
      renderDialog('asset://localhost/shot.png', '/tmp/shot.png')

      press('=')
      await waitFor(() => expect(scaleOf()).toBeGreaterThan(1))
      const zoomed = scaleOf()
      press('+')
      await waitFor(() => expect(scaleOf()).toBeGreaterThan(zoomed))
      const zoomedMore = scaleOf()
      press('-')
      await waitFor(() => expect(scaleOf()).toBeLessThan(zoomedMore))
      press('0')
      await waitFor(() => expect(scaleOf()).toBe(1))
    })

    it('keeps the zoom keys from the app zoom while open', () => {
      const appZoom = vi.fn()
      document.addEventListener('keydown', appZoom, { capture: true })
      try {
        renderDialog('asset://localhost/shot.png', '/tmp/shot.png')
        for (const key of ['=', '+', '-', '0']) press(key)
        expect(appZoom).not.toHaveBeenCalled()

        // Other keys still reach the app.
        fireEvent.keyDown(document.body, {
          key: 'k',
          metaKey: true,
          ctrlKey: true,
        })
        expect(appZoom).toHaveBeenCalledTimes(1)
      } finally {
        document.removeEventListener('keydown', appZoom, { capture: true })
      }
    })

    it('leaves the app zoom alone when the viewer is closed', () => {
      const appZoom = vi.fn()
      document.addEventListener('keydown', appZoom, { capture: true })
      try {
        render(
          <ImagePreviewDialog
            open={false}
            onOpenChange={vi.fn()}
            src="asset://localhost/shot.png"
            alt="shot"
          />
        )
        press('=')
        expect(appZoom).toHaveBeenCalledTimes(1)
      } finally {
        document.removeEventListener('keydown', appZoom, { capture: true })
      }
    })

    it('shows the zoom key hints on native desktop only', () => {
      renderDialog('asset://localhost/shot.png', '/tmp/shot.png')
      expect(screen.getByTestId('image-zoom-hints')).toHaveTextContent('zoom')
    })

    it('hides the zoom key hints in web access', () => {
      mocks.isNativeApp.mockReturnValue(false)
      mocks.isLocalBackend.mockReturnValue(false)
      renderDialog('/api/files/pasted-images/shot.png?token=t', '/srv/shot.png')
      expect(screen.queryByTestId('image-zoom-hints')).toBeNull()
    })
  })

  describe('Open in browser pane', () => {
    it('opens the file URL in the browser pane and closes the viewer', async () => {
      const user = userEvent.setup()
      renderDialog('asset://localhost/my%20shot.png', '/tmp/my shot.png')

      await user.click(
        screen.getByRole('button', { name: 'Open in browser pane' })
      )

      expect(mocks.openInPane).toHaveBeenCalledWith('file:///tmp/my%20shot.png')
      await waitFor(() =>
        expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
      )
    })

    it('stays open and toasts when no browser surface is there', async () => {
      mocks.openInPane.mockResolvedValue(false)
      const user = userEvent.setup()
      renderDialog('asset://localhost/shot.png', '/tmp/shot.png')

      await user.click(
        screen.getByRole('button', { name: 'Open in browser pane' })
      )

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
      expect(mocks.onOpenChange).not.toHaveBeenCalled()
    })

    it('is hidden in web access and in a remote session', () => {
      mocks.isLocalBackend.mockReturnValue(false)
      renderDialog(REMOTE_SRC, '/remote/shot.png')
      expect(
        screen.queryByRole('button', { name: 'Open in browser pane' })
      ).toBeNull()
    })

    it('is hidden for an image without a file path', () => {
      renderDialog('data:image/png;base64,AAAA')
      expect(
        screen.queryByRole('button', { name: 'Open in browser pane' })
      ).toBeNull()
    })
  })
})
