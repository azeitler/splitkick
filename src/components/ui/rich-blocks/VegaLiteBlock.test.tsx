import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { Markdown } from '@/components/ui/markdown'

const bar = JSON.stringify({
  data: {
    values: [
      { a: 'A', b: 1 },
      { a: 'B', b: 2 },
    ],
  },
  mark: 'bar',
  encoding: {
    x: { field: 'a', type: 'nominal' },
    y: { field: 'b', type: 'quantitative' },
  },
})

const block = (code: string) => '```vega-lite\n' + code + '\n```'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('vega-lite code blocks', () => {
  it('renders a chart with the toolbar', async () => {
    render(<Markdown>{block(bar)}</Markdown>)
    const chart = await screen.findByTestId('vega-lite-chart')
    await waitFor(() => expect(chart.querySelector('svg')).not.toBeNull())
    for (const label of [
      'Show source',
      'Full screen',
      'Copy source',
      'Copy as SVG',
      'Copy as PNG',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('toggles to the source', async () => {
    render(<Markdown>{block(bar)}</Markdown>)
    fireEvent.click(await screen.findByRole('button', { name: 'Show source' }))
    expect(screen.getByText(/"mark":"bar"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show chart' })).toBeVisible()
  })

  it('shows the source and the error for an invalid spec', async () => {
    render(<Markdown>{block('{ "mark": ')}</Markdown>)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid JSON/)
    expect(screen.getByText('{ "mark":')).toBeInTheDocument()
    expect(screen.queryByTestId('vega-lite-chart')).toBeNull()
  })

  it('refuses remote data', async () => {
    render(
      <Markdown>
        {block('{"data": {"url": "https://example.com/x.csv"}, "mark": "bar"}')}
      </Markdown>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/remote data/)
  })

  it('shows plain code while the message streams', async () => {
    render(<Markdown streaming>{block(bar)}</Markdown>)
    await waitFor(() => expect(screen.getByText(bar)).toBeInTheDocument())
    expect(screen.queryByTestId('chart-frame')).toBeNull()
  })

  it('follows the app theme', async () => {
    render(<Markdown>{block(bar)}</Markdown>)
    const chart = await screen.findByTestId('vega-lite-chart')
    expect(chart).toHaveAttribute('data-theme', 'light')
    await act(async () => {
      document.documentElement.classList.add('dark')
    })
    await waitFor(() =>
      expect(screen.getByTestId('vega-lite-chart')).toHaveAttribute(
        'data-theme',
        'dark'
      )
    )
  })

  it('leaves other code blocks alone', () => {
    render(<Markdown>{'```ts\nconst a = 1\n```'}</Markdown>)
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
    expect(screen.queryByTestId('chart-frame')).toBeNull()
  })
})
