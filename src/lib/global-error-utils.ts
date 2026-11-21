import { logNativeError } from './native-log'

/** Opaque cross-origin browser errors contain no actionable diagnostic data. */
export function shouldSurfaceGlobalError(message: string): boolean {
  return message.trim().toLowerCase() !== 'script error.'
}

/**
 * Browser noise that is not an error: WebKit and Chrome report a
 * ResizeObserver whose callback changed the layout again, and deliver the
 * rest in the next frame. Nothing breaks, so it gets no toast and no log line
 * (it can fire on every resize and flood the log).
 */
export function isBenignBrowserError(message: string): boolean {
  return message.trim().toLowerCase().startsWith('resizeobserver loop')
}

/**
 * Write an uncaught error to the console and the app log file. A release build
 * has no devtools, so the console alone loses it.
 */
export function logGlobalError(
  kind: string,
  message: string,
  stack: string | undefined
): void {
  logNativeError(
    stack ? `${kind}: ${message}\n${stack}` : `${kind}: ${message}`
  )
}
