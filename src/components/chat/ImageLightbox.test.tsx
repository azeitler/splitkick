import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ImagePreviewDialog } from './ImageLightbox'

const mocks = vi.hoisted(() => ({
  canOpenNativeApps: vi.fn(() => true),
  reveal: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  canOpenNativeApps: () => mocks.canOpenNativeApps(),
}))

vi.mock('@/services/projects', () => ({
  useRevealPathInFileManager: () => ({ mutate: mocks.reveal }),
}))

describe('ImagePreviewDialog', () => {
  beforeEach(() => {
    mocks.canOpenNativeApps.mockReturnValue(true)
    mocks.reveal.mockReset()
  })

  it('renders the image inside the zoom container', () => {
    render(
      <ImagePreviewDialog
        open
        onOpenChange={vi.fn()}
        src="asset://shot.png"
        alt="shot"
      />
    )

    const img = screen.getByRole('img', { name: 'shot' })
    expect(img.closest('.react-transform-component')).not.toBeNull()
    expect(img.closest('.react-transform-wrapper')).not.toBeNull()
  })

  it('shows the reveal button only for a local path on a native machine', () => {
    const { rerender } = render(
      <ImagePreviewDialog
        open
        onOpenChange={vi.fn()}
        src="asset://shot.png"
        alt="shot"
        path="/tmp/shot.png"
      />
    )
    expect(screen.getByRole('button', { name: /Reveal in/ })).toBeVisible()

    mocks.canOpenNativeApps.mockReturnValue(false)
    rerender(
      <ImagePreviewDialog
        open
        onOpenChange={vi.fn()}
        src="asset://shot.png"
        alt="shot"
        path="/tmp/shot.png"
      />
    )
    expect(screen.queryByRole('button', { name: /Reveal in/ })).toBeNull()
  })
})
