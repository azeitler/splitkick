import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { Markdown } from '@/components/ui/markdown'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: mermaidMock }))

const FLOWCHART = '```mermaid\ngraph TD\n  A-->B\n```'

beforeEach(() => {
  mermaidMock.initialize.mockReset()
  mermaidMock.parse.mockReset().mockResolvedValue({ diagramType: 'flowchart' })
  mermaidMock.render.mockReset().mockImplementation(async (id: string) => ({
    svg: `<svg id="${id}" data-testid="mermaid-svg" viewBox="0 0 10 10"></svg>`,
  }))
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('Mermaid blocks in Markdown', () => {
  it('renders a complete block as a diagram with strict security', async () => {
    render(<Markdown>{FLOWCHART}</Markdown>)

    expect(await screen.findByTestId('mermaid-svg')).toBeInTheDocument()
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.any(String),
      'graph TD\n  A-->B'
    )
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'default' })
    )
    expect(screen.getByRole('button', { name: 'Show source' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy as SVG' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy as PNG' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Open full screen' })
    ).toBeVisible()
  })

  it('toggles to the source', async () => {
    render(<Markdown>{FLOWCHART}</Markdown>)
    ;(await screen.findByRole('button', { name: 'Show source' })).click()
    await waitFor(() =>
      expect(screen.queryByTestId('mermaid-svg')).not.toBeInTheDocument()
    )
    expect(screen.getByText(/A-->B/)).toBeInTheDocument()
  })

  it('shows the source and the error for invalid code', async () => {
    mermaidMock.parse.mockRejectedValue(new Error('Parse error on line 1'))
    render(<Markdown>{'```mermaid\nnot a diagram\n```'}</Markdown>)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not render the Mermaid diagram')
    expect(alert).toHaveTextContent('Parse error on line 1')
    expect(screen.getByText('not a diagram')).toBeInTheDocument()
    expect(mermaidMock.render).not.toHaveBeenCalled()
  })

  it('renders again with the dark theme when the theme changes', async () => {
    render(<Markdown>{FLOWCHART}</Markdown>)
    await screen.findByTestId('mermaid-svg')

    await act(async () => {
      document.documentElement.classList.add('dark')
    })

    await waitFor(() =>
      expect(mermaidMock.initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: 'dark' })
      )
    )
    expect(mermaidMock.render).toHaveBeenCalledTimes(2)
  })

  it('shows the code while a streamed block is not complete', async () => {
    const { rerender } = render(
      <Markdown streaming>{'Look:\n\n```mermaid\ngraph TD\n  A-->B'}</Markdown>
    )

    expect(await screen.findByText(/A-->B/)).toBeInTheDocument()
    expect(mermaidMock.render).not.toHaveBeenCalled()

    rerender(<Markdown streaming>{`Look:\n\n${FLOWCHART}`}</Markdown>)
    expect(await screen.findByTestId('mermaid-svg')).toBeInTheDocument()
  })

  it('leaves other code blocks alone', () => {
    const { container } = render(
      <Markdown>{'```ts\nconst a = 1\n```'}</Markdown>
    )
    expect(container.querySelector('[data-rich-block]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
  })
})
