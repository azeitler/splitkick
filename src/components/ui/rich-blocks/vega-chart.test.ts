import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chartConfig,
  EXPORT_BACKGROUND,
  exportSvg,
  noNetworkLoader,
  parseVegaLiteSpec,
  renderVegaLite,
} from './vega-chart'

const values = [
  { day: 'Mon', ms: 120 },
  { day: 'Tue', ms: 90 },
  { day: 'Wed', ms: 150 },
]

function spec(mark: string) {
  return parseVegaLiteSpec(
    JSON.stringify({
      data: { values },
      mark,
      encoding: {
        x: { field: 'day', type: 'nominal' },
        y: { field: 'ms', type: 'quantitative' },
      },
    })
  )
}

beforeEach(() => {
  // jsdom has no canvas; Vega then estimates text width.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

describe('renderVegaLite', () => {
  it('renders a bar chart as SVG with one bar per row', async () => {
    const el = document.createElement('div')
    const view = await renderVegaLite(el, spec('bar'), 'light')
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelectorAll('.mark-rect path')).toHaveLength(3)
    view.finalize()
  })

  it('renders a line chart', async () => {
    const el = document.createElement('div')
    const view = await renderVegaLite(el, spec('line'), 'light')
    expect(el.querySelector('.mark-line path')).not.toBeNull()
    view.finalize()
  })

  it('renders area and point charts', async () => {
    const cases: [string, string][] = [
      ['area', '.mark-area path'],
      ['point', '.mark-symbol path'],
    ]
    for (const [mark, selector] of cases) {
      const el = document.createElement('div')
      const view = await renderVegaLite(el, spec(mark), 'light')
      expect(el.querySelector(selector)).not.toBeNull()
      view.finalize()
    }
  })

  it('uses theme colors for axis labels', async () => {
    const light = document.createElement('div')
    const dark = document.createElement('div')
    const views = [
      await renderVegaLite(light, spec('bar'), 'light'),
      await renderVegaLite(dark, spec('bar'), 'dark'),
    ]
    const labelFill = (el: HTMLElement) =>
      el.querySelector('.role-axis-label text')?.getAttribute('fill')
    expect(labelFill(light)).toBe(chartConfig('light').axis?.labelColor)
    expect(labelFill(dark)).toBe(chartConfig('dark').axis?.labelColor)
    expect(labelFill(light)).not.toBe(labelFill(dark))
    views.forEach(view => view.finalize())
  })

  it('exports SVG with an opaque theme background', async () => {
    const el = document.createElement('div')
    const view = await renderVegaLite(el, spec('bar'), 'dark')
    const svg = await exportSvg(view, 'dark')
    expect(svg).toContain('<svg')
    expect(svg).toContain(EXPORT_BACKGROUND.dark)
    expect(view.background()).toBe('transparent')
    view.finalize()
  })

  it('rejects an invalid spec', async () => {
    const el = document.createElement('div')
    await expect(
      renderVegaLite(
        el,
        parseVegaLiteSpec('{"mark": "bar", "layer": 3}'),
        'light'
      )
    ).rejects.toThrow()
  })
})

describe('parseVegaLiteSpec', () => {
  it('reports invalid JSON', () => {
    expect(() => parseVegaLiteSpec('{ "mark": ')).toThrow(/Invalid JSON/)
    expect(() => parseVegaLiteSpec('[1, 2]')).toThrow(/JSON object/)
  })

  it('refuses remote data, also when nested', () => {
    expect(() =>
      parseVegaLiteSpec('{"data": {"url": "https://example.com/a.csv"}}')
    ).toThrow(/remote data/)
    expect(() =>
      parseVegaLiteSpec(
        JSON.stringify({
          data: { values },
          transform: [
            { lookup: 'day', from: { data: { url: 'a.json' }, key: 'd' } },
          ],
          mark: 'bar',
        })
      )
    ).toThrow(/remote data/)
  })

  it('drops vega-embed options from usermeta', () => {
    const parsed = parseVegaLiteSpec(
      '{"mark": "bar", "usermeta": {"embedOptions": {"ast": false}, "k": 1}}'
    ) as { usermeta?: Record<string, unknown> }
    expect(parsed.usermeta).toEqual({ k: 1 })
  })
})

describe('noNetworkLoader', () => {
  it('refuses every load, link and file', async () => {
    const opts = { context: 'dataflow' } as never
    await expect(noNetworkLoader.load('https://example.com')).rejects.toThrow()
    await expect(
      noNetworkLoader.sanitize('https://example.com', opts)
    ).rejects.toThrow()
    await expect(
      noNetworkLoader.http('https://example.com', {})
    ).rejects.toThrow()
    await expect(noNetworkLoader.file('/etc/passwd')).rejects.toThrow()
  })
})
