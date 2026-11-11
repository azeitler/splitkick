import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import HtmlPreviewBlock from './HtmlPreviewBlock'

vi.mock('@/components/artifact-preview/ArtifactPreview', () => ({
  ArtifactPreview: () => <div>preview frame</div>,
}))
vi.mock('@/lib/chat-composer-metrics', () => ({
  getChatComposerBottomOffset: () => 120,
}))

describe('HtmlPreviewBlock (#81)', () => {
  const scrollIntoView = vi.fn()
  const original = HTMLElement.prototype.scrollIntoView

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = original
    scrollIntoView.mockReset()
  })

  it('scrolls itself into view above the composer when it opens', () => {
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(<HtmlPreviewBlock code="<p>hi</p>" isComplete />)

    const root = screen.getByTestId('html-preview-block')
    expect(root.style.scrollMarginBottom).toBe('136px')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'smooth',
    })
  })
})
