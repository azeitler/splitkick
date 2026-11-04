import { describe, expect, it } from 'vitest'
import {
  PREVIEW_CSP,
  PREVIEW_IFRAME_SANDBOX,
  buildSandboxedSrcdoc,
  detectMarkupKind,
  getArtifactKind,
  svgToDataUrl,
} from './sandbox'

describe('artifact sandbox rules', () => {
  it('gives the frame scripts only, never same-origin', () => {
    expect(PREVIEW_IFRAME_SANDBOX).toBe('allow-scripts')
  })

  it('blocks all network in the CSP', () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'")
    expect(PREVIEW_CSP).toContain('img-src data: blob:')
    expect(PREVIEW_CSP).toContain("form-action 'none'")
    expect(PREVIEW_CSP).not.toMatch(/https?:|\*|'self'|connect-src/)
    expect(PREVIEW_CSP).not.toContain('unsafe-eval')
  })

  it('puts the CSP before any byte of the artifact', () => {
    const doc = buildSandboxedSrcdoc(
      '<!DOCTYPE html><html><body>hi</body></html>'
    )
    const cspAt = doc.indexOf('Content-Security-Policy')
    expect(cspAt).toBeGreaterThan(0)
    expect(cspAt).toBeLessThan(doc.indexOf('<html>'))
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true)
    // The artifact's own doctype is dropped, not left after our tags.
    expect(doc.match(/<!doctype/gi)).toHaveLength(1)
  })

  it('keeps the CSP first even for a page that starts with a meta tag', () => {
    const doc = buildSandboxedSrcdoc(
      '<meta http-equiv="Content-Security-Policy" content="default-src *">'
    )
    expect(doc.indexOf(PREVIEW_CSP)).toBeLessThan(doc.indexOf('default-src *'))
  })

  it('knows previewable files', () => {
    expect(getArtifactKind('report.html')).toBe('html')
    expect(getArtifactKind('a/B.HTM')).toBe('html')
    expect(getArtifactKind('chart.svg')).toBe('svg')
    expect(getArtifactKind('notes.md')).toBeNull()
    expect(getArtifactKind(null)).toBeNull()
  })

  it('tells SVG from HTML in a code block', () => {
    expect(detectMarkupKind('<svg viewBox="0 0 1 1"></svg>')).toBe('svg')
    expect(
      detectMarkupKind('<?xml version="1.0"?>\n<!-- x -->\n<svg></svg>')
    ).toBe('svg')
    expect(detectMarkupKind('<div><svg></svg></div>')).toBe('html')
  })

  it('encodes UTF-8 SVG as a data URL', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Größe ✓</text></svg>'
    const url = svgToDataUrl(svg)
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const bytes = Uint8Array.from(atob(url.split(',')[1] ?? ''), c =>
      c.charCodeAt(0)
    )
    expect(new TextDecoder().decode(bytes)).toBe(svg)
  })
})

describe('native artifact origin', () => {
  it('serves the same CSP as the srcdoc preview, plus sandbox', async () => {
    const { readFileSync } = await import('node:fs')
    const rust = readFileSync('src-tauri/src/artifact_preview.rs', 'utf8')
    expect(rust).toContain(
      `"${PREVIEW_CSP}; sandbox ${PREVIEW_IFRAME_SANDBOX}"`
    )
  })

  it('is allowed as frame source by the app CSP', async () => {
    const { readFileSync } = await import('node:fs')
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    const csp: string = conf.app.security.csp
    const frameSrc = csp.split(';').find(d => d.trim().startsWith('frame-src'))
    expect(frameSrc).toContain('splitkick-artifact:')
    expect(frameSrc).toContain('http://splitkick-artifact.localhost')
  })
})
