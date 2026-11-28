import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { START_LOADER_SOURCE } from '../../scripts/web-start-loader.mjs'

/** The skeleton status markup from index.html and two built assets. */
function mountPage() {
  document.head.innerHTML = `
    <link rel="app-asset" data-entry href="/assets/index-abc.js" data-size="100">
    <link rel="app-asset" href="/assets/markdown-def.js" data-size="300">`
  document.body.innerHTML = `
    <div id="app-skeleton">
      <div class="sk-progress" role="progressbar" aria-valuenow="0" hidden>
        <div class="sk-progress-fill"></div>
      </div>
      <p class="sk-step" hidden></p>
    </div>`
}

/** A response whose body the test feeds chunk by chunk. */
function controlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start: c => {
      controller = c
    },
  })
  return {
    response: new Response(body),
    send: (bytes: number) => controller.enqueue(new Uint8Array(bytes)),
    end: () => controller.close(),
  }
}

const runLoader = () => new Function(START_LOADER_SOURCE)()
const step = () => document.querySelector('.sk-step')?.textContent
const moduleScript = () =>
  document.head.querySelector<HTMLScriptElement>('script[type="module"]')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Web Access start loader', () => {
  beforeEach(mountPage)
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('shows the real download progress, then starts the app', async () => {
    const entry = controlledResponse()
    const markdown = controlledResponse()
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('index-abc') ? entry.response : markdown.response
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    runLoader()
    expect(step()).toBe('Loading app… 0%')
    expect(document.querySelector<HTMLElement>('.sk-progress')?.hidden).toBe(
      false
    )

    entry.send(100)
    await flush()
    expect(step()).toBe('Loading app… 25%')
    expect(
      document.querySelector('.sk-progress')?.getAttribute('aria-valuenow')
    ).toBe('25')
    // Nothing runs before every file is in.
    expect(moduleScript()).toBeNull()

    entry.end()
    markdown.send(300)
    markdown.end()
    await flush()
    await flush()

    expect(moduleScript()?.getAttribute('src')).toBe('/assets/index-abc.js')
    expect(step()).toBe('Starting…')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('starts the app anyway when a download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('login', { status: 401 })))
    )

    runLoader()
    await flush()
    await flush()

    expect(moduleScript()?.getAttribute('src')).toBe('/assets/index-abc.js')
  })

  it('starts at once in the desktop app, without a bar', () => {
    ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    runLoader()

    expect(moduleScript()).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('.sk-progress')?.hidden).toBe(
      true
    )
  })
})
