import { beforeAll, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { Markdown } from './markdown'
import {
  codeBlockRenderers,
  findCodeBlockRenderer,
} from './code-block-renderers'

// Markdown loads the renderer chunk lazily. On a busy machine the first
// import can take longer than a findBy* wait, so load it before the tests.
beforeAll(async () => {
  await import('./rich-blocks/HtmlPreviewBlock')
})

const htmlBlock = '```html\n<p id="x">Hello</p>\n```'

describe('code block renderer registry', () => {
  it('finds the Mermaid renderer, in any case', () => {
    const mermaid = codeBlockRenderers.find(r =>
      r.languages.includes('mermaid')
    )
    expect(mermaid?.mode).toBe('auto')
    expect(findCodeBlockRenderer('mermaid')).toBe(mermaid)
    expect(findCodeBlockRenderer('Mermaid')).toBe(mermaid)
  })

  it('maps vega-lite to the lazily loaded chart renderer', async () => {
    const renderer = findCodeBlockRenderer('vega-lite')
    expect(renderer?.mode).toBe('auto')
    expect(findCodeBlockRenderer('Vega-Lite')).toBe(renderer)
    const module = await renderer?.load()
    expect(typeof module?.default).toBe('function')
    expect(findCodeBlockRenderer('chart')).toBeUndefined()
  })

  it('finds the HTML/SVG preview renderer', () => {
    expect(findCodeBlockRenderer('html')?.mode).toBe('preview')
    expect(findCodeBlockRenderer('SVG')?.mode).toBe('preview')
    expect(findCodeBlockRenderer('ts')).toBeUndefined()
    expect(findCodeBlockRenderer(undefined)).toBeUndefined()
  })
})

describe('Markdown preview code blocks', () => {
  it('shows an HTML block as a sandboxed preview at once, source on click', async () => {
    const user = userEvent.setup()
    render(<Markdown>{htmlBlock}</Markdown>)

    const frame = await screen.findByTitle('HTML preview')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<p id="x">Hello</p>')
    // The source is hidden until asked for.
    expect(screen.queryByText('<p id="x">Hello</p>')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show source' }))
    expect(screen.getByText('<p id="x">Hello</p>')).toBeInTheDocument()
    // The preview stays above the source.
    expect(screen.getByTitle('HTML preview')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide source' }))
    expect(screen.queryByText('<p id="x">Hello</p>')).toBeNull()
  })

  it('previews an SVG block as image at once', async () => {
    render(<Markdown>{'```svg\n<svg viewBox="0 0 1 1"></svg>\n```'}</Markdown>)

    const img = await screen.findByAltText('SVG preview')
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('shows the code while the block is still streaming', () => {
    render(<Markdown streaming>{'```html\n<p id="x">Hel'}</Markdown>)
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show source' })).toBeNull()
    expect(screen.getByText(/<p id="x">Hel/)).toBeInTheDocument()
  })

  it('shows the preview once the fence is closed, even while streaming', async () => {
    render(<Markdown streaming>{htmlBlock}</Markdown>)
    expect(await screen.findByTitle('HTML preview')).toBeInTheDocument()
  })

  it('renders other languages as plain code', () => {
    render(<Markdown>{'```js\nconst a = 1\n```'}</Markdown>)
    expect(screen.queryByRole('button', { name: 'Show source' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Copy code' })
    ).toBeInTheDocument()
  })
})
