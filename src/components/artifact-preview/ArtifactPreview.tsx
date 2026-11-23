import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { isNativeApp } from '@/lib/environment'
import { invoke } from '@/lib/transport'
import {
  ARTIFACT_MESSAGE,
  ARTIFACT_READY_MESSAGE,
  ARTIFACT_SIZE_MESSAGE,
  PREVIEW_IFRAME_SANDBOX,
  buildSandboxedSrcdoc,
  svgToDataUrl,
  type ArtifactKind,
} from './sandbox'

interface SandboxedHtmlFrameProps {
  html: string
  title: string
  className?: string
  /** Called with the height the page's content needs (CSS px). Turns on the
   * page's size report. */
  onContentHeight?: (height: number) => void
  style?: CSSProperties
}

/**
 * An HTML page in a sandboxed iframe: opaque origin, inline scripts only,
 * no network. Remount it (change its `key`) to reload.
 *
 * Web Access uses `srcdoc`. The native app loads the bootstrap page from
 * its loopback origin (`artifact_preview.rs`) and posts the page to it: a
 * `srcdoc` frame would inherit the app's CSP, which blocks inline scripts in
 * release builds. The loopback origin is remote for Tauri, so its ACL
 * rejects every IPC call from the frame (#82).
 */
export function SandboxedHtmlFrame({
  html,
  title,
  className,
  onContentHeight,
  style,
}: SandboxedHtmlFrameProps) {
  const reportSize = onContentHeight !== undefined
  const srcDoc = useMemo(
    () => buildSandboxedSrcdoc(html, { reportSize }),
    [html, reportSize]
  )
  const onHeightRef = useRef(onContentHeight)
  useEffect(() => {
    onHeightRef.current = onContentHeight
  }, [onContentHeight])
  const native = isNativeApp()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { data: frameUrl, isError } = useQuery({
    queryKey: ['artifact-frame-url'],
    queryFn: () => invoke<string>('get_artifact_frame_url'),
    enabled: native,
    staleTime: Infinity,
  })

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

  // Size reports: only from our own frame, only a finite number. The page
  // controls nothing else; the caller clamps the height.
  useEffect(() => {
    if (!reportSize) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type !== ARTIFACT_SIZE_MESSAGE) return
      const height = Number(event.data.height)
      if (Number.isFinite(height) && height > 0) onHeightRef.current?.(height)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [reportSize])

  // Never fall back to srcdoc in the native app: it would not run scripts.
  if (native && !frameUrl) {
    return isError ? (
      <p className={cn('p-3 text-sm text-muted-foreground', className)}>
        Preview unavailable.
      </p>
    ) : null
  }

  return (
    <iframe
      // New content needs a fresh bootstrap document.
      key={native ? srcDoc : undefined}
      ref={frameRef}
      title={title}
      sandbox={PREVIEW_IFRAME_SANDBOX}
      {...(native ? { src: frameUrl } : { srcDoc })}
      referrerPolicy="no-referrer"
      // Pages expect a white canvas, like in a browser.
      className={cn('block w-full border-0 bg-white', className)}
      style={style}
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
  /** HTML only: see `SandboxedHtmlFrame`. */
  onContentHeight?: (height: number) => void
  style?: CSSProperties
}

/** Rendered preview of an HTML or SVG artifact. */
export function ArtifactPreview({
  kind,
  content,
  title,
  className,
  onContentHeight,
  style,
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
      onContentHeight={onContentHeight}
      style={style}
    />
  )
}
