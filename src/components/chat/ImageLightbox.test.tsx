import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import type * as Platform from '@/lib/platform'
import { ImagePreviewDialog } from './ImageLightbox'

const mocks = vi.hoisted(() => ({
  isLocalBackend: vi.fn(() => true),
  reveal: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  copyImageToClipboard: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  isLocalBackend: () => mocks.isLocalBackend(),
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
      onOpenChange={vi.fn()}
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

  it('native remote session: Open in browser instead of Reveal', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    const user = userEvent.setup()
    renderDialog(REMOTE_SRC, '/remote/app-data/pasted-images/shot.png')

    expect(screen.queryByRole('button', { name: /Reveal in/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(mocks.openExternal).toHaveBeenCalledWith(REMOTE_SRC)
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeVisible()
  })

  it('web access: Open in browser with the served URL, no Reveal', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    const user = userEvent.setup()
    const src = '/api/files/pasted-images/shot.png?token=t'
    renderDialog(src, '/srv/app-data/pasted-images/shot.png')

    expect(screen.queryByRole('button', { name: /Reveal in/ })).toBeNull()
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
})
