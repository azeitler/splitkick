import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { isNativeApp } from '@/lib/environment'
import {
  ARTIFACT_MESSAGE,
  ARTIFACT_READY_MESSAGE,
  PREVIEW_IFRAME_SANDBOX,
  artifactFrameUrl,
  buildSandboxedSrcdoc,
  svgToDataUrl,
  type ArtifactKind,
} from './sandbox'

interface SandboxedHtmlFrameProps {
  html: string
  title: string
  className?: string
}

/**
 * An HTML page in a sandboxed iframe: opaque origin, inline scripts only,
 * no network. Remount it (change its `key`) to reload.
 *
 * Web Access uses `srcdoc`. The native app loads the `splitkick-artifact:`
 * bootstrap page and posts the page to it: a `srcdoc` frame would inherit
 * the app's CSP, which blocks inline scripts in release builds.
 */
export function SandboxedHtmlFrame({
  html,
  title,
  className,
}: SandboxedHtmlFrameProps) {
  const srcDoc = useMemo(() => buildSandboxedSrcdoc(html), [html])
  const native = isNativeApp()
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!native) return
    let sent = false
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow
      // Only our own frame, and only its first ready signal: later messages
      // come from the artifact and are ignored.
      if (sent || !frame || event.source !== frame) return
      if (event.data?.type !== ARTIFACT_READY_MESSAGE) return
      sent = true
      frame.postMessage({ type: ARTIFACT_MESSAGE, html: srcDoc }, '*')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [native, srcDoc])

  return (
    <iframe
      // New content needs a fresh bootstrap document.
      key={native ? srcDoc : undefined}
      ref={frameRef}
      title={title}
      sandbox={PREVIEW_IFRAME_SANDBOX}
      {...(native ? { src: artifactFrameUrl() } : { srcDoc })}
      referrerPolicy="no-referrer"
      // Pages expect a white canvas, like in a browser.
      className={cn('block w-full border-0 bg-white', className)}
    />
  )
}

interface SvgPreviewProps {
  svg: string
  alt: string
  className?: string
}

/** An SVG as image: scripts in it never run. */
export function SvgPreview({ svg, alt, className }: SvgPreviewProps) {
  const src = useMemo(() => svgToDataUrl(svg), [svg])
  return (
    <img
      src={src}
      alt={alt}
      className={cn('max-w-full object-contain', className)}
    />
  )
}

interface ArtifactPreviewProps {
  kind: ArtifactKind
  content: string
  title: string
  className?: string
}

/** Rendered preview of an HTML or SVG artifact. */
export function ArtifactPreview({
  kind,
  content,
  title,
  className,
}: ArtifactPreviewProps) {
  if (kind === 'svg') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md bg-white p-4',
          className
        )}
      >
        <SvgPreview svg={content} alt={title} className="max-h-full" />
      </div>
    )
  }
  return (
    <SandboxedHtmlFrame
      html={content}
      title={title}
      className={cn('rounded-md', className)}
    />
  )
}
