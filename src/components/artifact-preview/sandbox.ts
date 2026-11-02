/**
 * Sandbox rules for HTML and SVG artifacts that agents write.
 * Threat model: docs/developer/artifact-preview.md.
 */

/**
 * The only token the preview iframe gets. Without `allow-same-origin` the
 * frame has an opaque origin: it cannot read the app's DOM, storage, cookies
 * or Tauri globals. Without `allow-top-navigation`, `allow-popups` and
 * `allow-forms` it cannot navigate the app, open windows or submit forms.
 */
export const PREVIEW_IFRAME_SANDBOX = 'allow-scripts'

/**
 * Content Security Policy of every HTML preview. Inline scripts and styles
 * run; nothing loads from the network. Images, fonts and media are allowed
 * only from `data:` / `blob:` URLs that the page itself contains.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * The native app's preview origin (`src-tauri/src/artifact_preview.rs`). It
 * serves a bootstrap page that waits for `ARTIFACT_MESSAGE` from the parent.
 */
export const ARTIFACT_SCHEME = 'splitkick-artifact'
export const ARTIFACT_READY_MESSAGE = 'splitkick-artifact-ready'
export const ARTIFACT_MESSAGE = 'splitkick-artifact'

/** `splitkick-artifact://localhost/` (`http://splitkick-artifact.localhost/` on Windows). */
export function artifactFrameUrl(): string {
  // Not `convertFileSrc` from transport: connection windows use the WebSocket
  // branch there, but the scheme is always this app's own.
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (path: string, protocol: string) => string
      }
    }
  ).__TAURI_INTERNALS__
  return (
    internals?.convertFileSrc?.('frame', ARTIFACT_SCHEME) ??
    `${ARTIFACT_SCHEME}://localhost/frame`
  )
}

export type ArtifactKind = 'html' | 'svg'

/** `html` or `svg` for a previewable file name, else null. */
export function getArtifactKind(
  filename: string | null | undefined
): ArtifactKind | null {
  if (!filename) return null
  if (/\.html?$/i.test(filename)) return 'html'
  if (/\.svg$/i.test(filename)) return 'svg'
  return null
}

/** Whether a code block holds an SVG document rather than an HTML page. */
export function detectMarkupKind(code: string): ArtifactKind {
  const head = code
    .trimStart()
    .replace(/^<\?xml[^>]*>\s*/i, '')
    .replace(/^(<!--[\s\S]*?-->\s*)+/, '')
  return /^<svg[\s>]/i.test(head) ? 'svg' : 'html'
}

/**
 * The `srcdoc` of a preview: the CSP meta tag comes first, before any byte
 * of the artifact, so it covers every element the page contains. A page can
 * add its own policies, but each extra policy only restricts more.
 */
export function buildSandboxedSrcdoc(html: string): string {
  // The artifact's own doctype would come after our tags and be ignored.
  const body = html.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, '')
  return (
    '<!DOCTYPE html>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    '<meta name="referrer" content="no-referrer">' +
    body
  )
}

/**
 * An SVG as `data:` URL for an `<img>`. In image context the browser runs no
 * script and loads no external resource from the SVG, so no sandbox is
 * needed.
 */
export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}
