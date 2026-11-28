/**
 * Web Access start loader: a real progress bar for the app download.
 *
 * Why: on a slow link the first visit after a release spends most of its
 * wait downloading the app code, behind the static start skeleton (#72).
 * Module scripts report no progress, so the skeleton could only spin.
 *
 * The build (Vite plugin in vite.config.ts) rewrites index.html:
 *
 * - The entry `<script type="module">` and its `<link rel="modulepreload">`
 *   tags become `<link rel="app-asset" href=… data-size=…>`. The browser
 *   ignores that rel and fetches nothing; the service worker still finds the
 *   URLs in `href="/assets/…"` for its precache.
 * - An inline loader at the end of `<body>` fetches those files, counts the
 *   bytes of each response stream against the sizes from the build, and
 *   fills the bar. Then it adds the entry module script; the browser takes
 *   the files from its HTTP cache (the assets are `immutable`).
 *
 * The desktop app, browsers without streams, and a failed fetch skip the bar
 * and start the app at once, as before. Stylesheets keep their own tags.
 */

/** Text under the bar while the app downloads (no product name, see #72). */
export const DOWNLOAD_LABEL = 'Loading app…'
/** Text once the app code runs and before App.tsx names its own step. */
export const STARTING_LABEL = 'Starting…'

const ENTRY_RE =
  /\s*<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"><\/script>/
const PRELOAD_RE =
  /\s*<link rel="modulepreload" crossorigin href="(\/assets\/[^"]+\.js)">/g

/**
 * Rewrite the built index.html for the start loader.
 *
 * @param {string} html built index.html
 * @param {(url: string) => number} sizeOf byte size of a built `/assets/…` file
 * @returns {string} the rewritten html, or `html` unchanged without an entry
 */
export function rewriteIndexHtmlForStartLoader(html, sizeOf) {
  const entry = html.match(ENTRY_RE)
  if (!entry) return html
  const preloads = [...html.matchAll(PRELOAD_RE)].map(match => match[1])

  const assetLinks = [
    `<link rel="app-asset" data-entry href="${entry[1]}" data-size="${sizeOf(entry[1])}">`,
    ...preloads
      .filter(
        (url, index) => url !== entry[1] && preloads.indexOf(url) === index
      )
      .map(
        url => `<link rel="app-asset" href="${url}" data-size="${sizeOf(url)}">`
      ),
  ]
    .map(tag => `\n    ${tag}`)
    .join('')

  return html
    .replace(ENTRY_RE, assetLinks)
    .replace(PRELOAD_RE, '')
    .replace('</body>', `  <script>${START_LOADER_SOURCE}</script>\n  </body>`)
}

/**
 * The inline loader. Plain browser JavaScript; runs once, after the skeleton
 * markup, before any module.
 */
export const START_LOADER_SOURCE = `
;(() => {
  const links = Array.from(document.querySelectorAll('link[rel="app-asset"]'))
  const entry = links.find(link => link.hasAttribute('data-entry'))
  if (!entry) return
  const skeleton = document.getElementById('app-skeleton')
  const progress = skeleton && skeleton.querySelector('.sk-progress')
  const fill = progress && progress.querySelector('.sk-progress-fill')
  const step = skeleton && skeleton.querySelector('.sk-step')
  let started = false
  const start = () => {
    if (started) return
    started = true
    if (step) step.textContent = ${JSON.stringify(STARTING_LABEL)}
    const script = document.createElement('script')
    script.type = 'module'
    script.crossOrigin = ''
    script.src = entry.getAttribute('href')
    document.head.appendChild(script)
  }
  if (
    window.__TAURI_INTERNALS__ ||
    !window.fetch ||
    !window.ReadableStream ||
    !progress ||
    !fill ||
    !step
  ) {
    start()
    return
  }
  const total = links.reduce((sum, link) => sum + (Number(link.dataset.size) || 0), 0)
  let received = 0
  const show = () => {
    const ratio = total > 0 ? Math.min(1, received / total) : 0
    const percent = Math.round(ratio * 100)
    fill.style.transform = 'scaleX(' + ratio + ')'
    progress.setAttribute('aria-valuenow', String(percent))
    step.textContent = ${JSON.stringify(DOWNLOAD_LABEL)} + ' ' + percent + '%'
  }
  progress.hidden = false
  step.hidden = false
  show()
  const read = url =>
    fetch(url, { credentials: 'same-origin' }).then(response => {
      if (!response.ok || !response.body) throw new Error(url)
      const reader = response.body.getReader()
      const pump = () =>
        reader.read().then(chunk => {
          if (chunk.done) return
          received += chunk.value.byteLength
          show()
          return pump()
        })
      return pump()
    })
  Promise.all(links.map(link => read(link.getAttribute('href'))))
    .then(() => {
      received = total
      show()
    })
    .catch(() => {})
    .then(start)
})()
`
