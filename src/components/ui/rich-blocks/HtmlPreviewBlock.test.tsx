import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import HtmlPreviewBlock from './HtmlPreviewBlock'

vi.mock('@/components/artifact-preview/ArtifactPreview', () => ({
  ArtifactPreview: () => <div>preview frame</div>,
}))

describe('HtmlPreviewBlock', () => {
  const scrollIntoView = vi.fn()
  const original = HTMLElement.prototype.scrollIntoView

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = original
    scrollIntoView.mockReset()
  })

  // It mounts for every complete block, also when an older chat loads, so it
  // must not pull the view to itself (it did while it opened only on click, #81).
  it('does not scroll itself into view when it mounts', () => {
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(<HtmlPreviewBlock code="<p>hi</p>" isComplete />)

    expect(screen.getByTestId('html-preview-block')).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('shows the actions in its header bar', () => {
    render(
      <HtmlPreviewBlock
        code="<p>hi</p>"
        isComplete
        actions={<button type="button">Show source</button>}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Show source' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reload preview' })
    ).toBeInTheDocument()
  })
})
