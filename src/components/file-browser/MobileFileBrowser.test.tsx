/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { MobileFileBrowser } from './MobileFileBrowser'

vi.mock('./FileBrowserSidebar', () => ({
  FileBrowserSidebar: () => <div>Files</div>,
}))

describe('MobileFileBrowser', () => {
  beforeEach(() => {
    useUIStore.setState({
      fileBrowserSwipe: {
        isDragging: false,
        dragOffset: 0,
        dragTransition: '',
      },
    })
  })

  it('drags the file-browser drawer over the content during a right-edge swipe', async () => {
    useUIStore.getState().setFileBrowserSwipe({
      isDragging: true,
      dragOffset: -112,
      dragTransition: '',
    })

    render(
      <MobileFileBrowser open={false} onOpenChange={vi.fn()} width={280} />
    )

    const drawer = await screen.findByTestId('mobile-file-browser')
    expect(drawer).toHaveAttribute('data-swipe-dragging', 'true')
    expect(drawer).toHaveStyle({
      transform: 'translateX(max(0px, calc(100% + -112px)))',
      animation: 'none',
      transition: 'none',
    })
  })
})
