import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ArtifactPreview } from './ArtifactPreview'

const env = vi.hoisted(() => ({ native: false }))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => env.native }))

describe('ArtifactPreview', () => {
  it('renders HTML in a sandboxed srcdoc iframe', () => {
    render(<ArtifactPreview kind="html" content="<p>hi</p>" title="Preview" />)
    const frame = screen.getByTitle('Preview')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBeNull()
    const srcdoc = frame.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc).toContain('<p>hi</p>')
  })

  it('renders SVG as an image, not in a frame', () => {
    render(
      <ArtifactPreview
        kind="svg"
        content="<svg><script>alert(1)</script></svg>"
        title="Chart"
      />
    )
    const img = screen.getByAltText('Chart')
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('ArtifactPreview in the native app', () => {
  afterEach(() => {
    env.native = false
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('loads the dedicated origin and posts the page once to its own frame', () => {
    env.native = true
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, protocol: string) =>
        `${protocol}://localhost/${path}`,
    }
    render(<ArtifactPreview kind="html" content="<p>hi</p>" title="Preview" />)
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(
      'splitkick-artifact://localhost/frame'
    )
    expect(frame.getAttribute('srcdoc')).toBeNull()
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')

    const target = frame.contentWindow as Window
    const post = vi
      .spyOn(target, 'postMessage')
      .mockImplementation(() => undefined)
    const ready = { type: 'splitkick-artifact-ready' }

    // Another window's ready signal is ignored.
    window.dispatchEvent(
      new MessageEvent('message', { data: ready, source: window })
    )
    expect(post).not.toHaveBeenCalled()

    window.dispatchEvent(
      new MessageEvent('message', { data: ready, source: target })
    )
    expect(post).toHaveBeenCalledTimes(1)
    const [message, targetOrigin] = post.mock.calls[0] as [
      { type: string; html: string },
      string,
    ]
    expect(message.type).toBe('splitkick-artifact')
    expect(message.html).toContain("default-src 'none'")
    expect(message.html).toContain('<p>hi</p>')
    // The frame's origin is opaque, so no narrower target exists.
    expect(targetOrigin).toBe('*')

    // A second ready (from the artifact itself) gets nothing.
    window.dispatchEvent(
      new MessageEvent('message', { data: ready, source: target })
    )
    expect(post).toHaveBeenCalledTimes(1)
  })
})
