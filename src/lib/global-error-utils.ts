import { logNativeError } from './native-log'

/** Opaque cross-origin browser errors contain no actionable diagnostic data. */
export function shouldSurfaceGlobalError(message: string): boolean {
  return message.trim().toLowerCase() !== 'script error.'
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
