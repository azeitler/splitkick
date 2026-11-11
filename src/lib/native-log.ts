import { invoke } from '@tauri-apps/api/core'
import { logger } from './logger'

/** tauri-plugin-log `LogLevel` values (numeric enum on the Rust side). */
const LOG_LEVEL_INFO = 3
const LOG_LEVEL_ERROR = 5

/**
 * Log an error to the console AND the app log file (via tauri-plugin-log).
 * `logger.error` only reaches the console, which a release build cannot open.
 * Native shell only.
 */
/** Like `logNativeError`, at info level: a normal event worth a log line. */
export function logNativeInfo(message: string): void {
  logger.info(message)
  invoke('plugin:log|log', { level: LOG_LEVEL_INFO, message }).catch(() => {
    // Logging must never throw
  })
}

export function logNativeError(message: string): void {
  logger.error(message)
  invoke('plugin:log|log', { level: LOG_LEVEL_ERROR, message }).catch(() => {
    // Logging must never throw
  })
}
