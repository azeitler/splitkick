import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ArtifactPreview } from './ArtifactPreview'

const env = vi.hoisted(() => ({ native: false }))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => env.native }))
const FRAME_URL = 'http://127.0.0.1:49152/frame'
const transport = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/transport', () => transport)

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
    transport.invoke.mockReset()
  })

  it('loads the loopback origin and posts the page once to its own frame', async () => {
    env.native = true
    transport.invoke.mockResolvedValue(FRAME_URL)
    render(<ArtifactPreview kind="html" content="<p>hi</p>" title="Preview" />)
    const frame = (await screen.findByTitle('Preview')) as HTMLIFrameElement
    expect(transport.invoke).toHaveBeenCalledWith('get_artifact_frame_url')
    expect(frame.getAttribute('src')).toBe(FRAME_URL)
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

  it('never falls back to srcdoc when the origin is missing', async () => {
    env.native = true
    transport.invoke.mockRejectedValue(new Error('no listener'))
    render(<ArtifactPreview kind="html" content="<p>hi</p>" title="Preview" />)
    expect(await screen.findByText('Preview unavailable.')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })
})
