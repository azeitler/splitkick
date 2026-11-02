import { parse, View, type Loader } from 'vega'
import { compile, type Config, type TopLevelSpec } from 'vega-lite'
import { expressionInterpreter } from 'vega-interpreter'

export type ChartTheme = 'light' | 'dark'

const REFUSED = 'Charts cannot load remote data or files. Put the data inline.'

/**
 * Loader that refuses every URL. Specs come from agent output, so a chart must
 * never fetch data, images or links (no `data.url`, no image marks by URL).
 */
export const noNetworkLoader: Loader = {
  load: () => Promise.reject(new Error(REFUSED)),
  sanitize: () => Promise.reject(new Error(REFUSED)),
  http: () => Promise.reject(new Error(REFUSED)),
  file: () => Promise.reject(new Error(REFUSED)),
}

/** Throws when any `data` object (also nested, e.g. `lookup.from.data`) has a `url`. */
function assertInlineData(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(assertInlineData)
    return
  }
  if (!node || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node)) {
    const isDataUrl =
      key === 'data' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'url' in value
    if (isDataUrl) throw new Error(REFUSED)
    assertInlineData(value)
  }
}

/** Parses the code block text into a Vega-Lite spec, or throws a readable error. */
export function parseVegaLiteSpec(code: string): TopLevelSpec {
  let spec: unknown
  try {
    spec = JSON.parse(code)
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('A Vega-Lite spec must be a JSON object.')
  }
  assertInlineData(spec)
  // `usermeta.embedOptions` is a vega-embed hook; drop it so a spec can never
  // change how it is embedded.
  const { usermeta, ...rest } = spec as Record<string, unknown>
  if (usermeta && typeof usermeta === 'object') {
    const { embedOptions: _ignored, ...keep } = usermeta as Record<
      string,
      unknown
    >
    return { ...rest, usermeta: keep } as TopLevelSpec
  }
  return spec as TopLevelSpec
}

const THEME_COLORS = {
  light: {
    text: '#3f3f46',
    title: '#18181b',
    grid: '#e4e4e7',
    domain: '#a1a1aa',
  },
  dark: {
    text: '#a1a1aa',
    title: '#fafafa',
    grid: '#3f3f46',
    domain: '#71717a',
  },
} as const

/** Background used for exports, so a copied image reads well on its own. */
export const EXPORT_BACKGROUND: Record<ChartTheme, string> = {
  light: '#ffffff',
  dark: '#18181b',
}

/** Chart config that follows the app theme. The chart itself is transparent. */
export function chartConfig(theme: ChartTheme): Config {
  const c = THEME_COLORS[theme]
  const axis = {
    domainColor: c.domain,
    gridColor: c.grid,
    tickColor: c.domain,
    labelColor: c.text,
    titleColor: c.text,
  }
  return {
    background: 'transparent',
    font: 'ui-sans-serif, system-ui, sans-serif',
    view: { stroke: c.grid },
    axis,
    legend: { labelColor: c.text, titleColor: c.text },
    header: { labelColor: c.text, titleColor: c.text },
    title: { color: c.title, subtitleColor: c.text },
    text: { color: c.text },
  }
}

/**
 * Single and layered charts without a width fill the block width. With
 * `fill`, they also fill the container height (full screen).
 */
function withContainerSize(spec: TopLevelSpec, fill: boolean): TopLevelSpec {
  const s = spec as unknown as Record<string, unknown>
  if (!('mark' in s || 'layer' in s)) return spec
  if (fill)
    return { ...s, width: 'container', height: 'container' } as TopLevelSpec
  if ('width' in s) return spec
  return { ...s, width: 'container' } as TopLevelSpec
}

/**
 * Compiles and renders a Vega-Lite spec into `container` as SVG.
 * Expressions run through the AST interpreter (no `eval` / `new Function`),
 * and the loader refuses all network and file access.
 */
export async function renderVegaLite(
  container: HTMLElement,
  spec: TopLevelSpec,
  theme: ChartTheme,
  fill = false
): Promise<View> {
  const { spec: vegaSpec } = compile(withContainerSize(spec, fill), {
    config: chartConfig(theme),
  })
  const runtime = parse(vegaSpec, undefined, { ast: true })
  const view = new View(runtime, {
    container,
    renderer: 'svg',
    hover: true,
    loader: noNetworkLoader,
    expr: expressionInterpreter,
  })
  try {
    await view.runAsync()
  } catch (error) {
    view.finalize()
    throw error
  }
  return view
}

/** Renders the chart as standalone SVG markup with an opaque background. */
export async function exportSvg(view: View, theme: ChartTheme) {
  return withExportBackground(view, theme, () => view.toSVG())
}

/** Renders the chart as a 2x PNG with an opaque background. */
export async function exportPng(view: View, theme: ChartTheme): Promise<Blob> {
  const url = await withExportBackground(view, theme, () =>
    view.toImageURL('png', 2)
  )
  // Decode by hand: the app CSP blocks fetch() of data: URLs.
  const bytes = Uint8Array.from(atob(url.split(',')[1] ?? ''), ch =>
    ch.charCodeAt(0)
  )
  return new Blob([bytes], { type: 'image/png' })
}

async function withExportBackground<T>(
  view: View,
  theme: ChartTheme,
  run: () => Promise<T>
): Promise<T> {
  const previous = view.background()
  view.background(EXPORT_BACKGROUND[theme])
  try {
    return await run()
  } finally {
    view.background(previous)
  }
}
