import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { Markdown } from './markdown'
import { findCodeBlockRenderer } from './code-block-renderers'

const htmlBlock = '```html\n<p id="x">Hello</p>\n```'

describe('code block renderer registry', () => {
  it('finds the HTML/SVG preview renderer', () => {
    expect(findCodeBlockRenderer('html')?.mode).toBe('preview')
    expect(findCodeBlockRenderer('SVG')?.mode).toBe('preview')
    expect(findCodeBlockRenderer('ts')).toBeUndefined()
    expect(findCodeBlockRenderer(undefined)).toBeUndefined()
  })
})

describe('Markdown preview code blocks', () => {
  it('keeps an HTML block as code until Preview is clicked', async () => {
    const user = userEvent.setup()
    render(<Markdown>{htmlBlock}</Markdown>)

    expect(screen.getByText('<p id="x">Hello</p>')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Preview' }))

    const frame = await screen.findByTitle('HTML preview')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<p id="x">Hello</p>')
    // The code stays visible next to the preview.
    expect(screen.getByText('<p id="x">Hello</p>')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide preview' }))
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('previews an SVG block as image', async () => {
    const user = userEvent.setup()
    render(<Markdown>{'```svg\n<svg viewBox="0 0 1 1"></svg>\n```'}</Markdown>)

    await user.click(screen.getByRole('button', { name: 'Preview' }))

    const img = await screen.findByAltText('SVG preview')
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('offers no preview while the message streams', () => {
    render(<Markdown streaming>{htmlBlock}</Markdown>)
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('offers no preview for other languages', () => {
    render(<Markdown>{'```js\nconst a = 1\n```'}</Markdown>)
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Copy code' })
    ).toBeInTheDocument()
  })
})
