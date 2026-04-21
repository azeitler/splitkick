/**
 * Diagnostic watchdog for issue #320 — terminal freeze after idle.
 *
 * Tracks requestAnimationFrame cadence. Logs a warning when RAF stalls
 * for > 3s while the document is visible, which indicates the webview's
 * render loop has been throttled or suspended (e.g. macOS App Nap,
 * WebKitGTK DPMS sleep, or window occlusion).
 *
 * Also exposes getTerminalDebugStats() for external logging.
 */

const RAF_STALL_THRESHOLD_MS = 3_000
const CHECK_INTERVAL_MS = 2_000

let watchdogStarted = false
let lastRafTs = performance.now()

/** Call once to start the global watchdog. Safe to call multiple times. */
export function startTerminalWatchdog(
  getStats: () => { instanceCount: number; totalListeners: number; pendingRegistrations: number }
): void {
  if (watchdogStarted) return
  watchdogStarted = true

  // Track RAF cadence
  const tick = () => {
    lastRafTs = performance.now()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Check for stalls every 2s
  setInterval(() => {
    if (document.visibilityState !== 'visible') return
    const gap = performance.now() - lastRafTs
    if (gap > RAF_STALL_THRESHOLD_MS) {
      const stats = getStats()
      console.warn(
        `[terminal-watchdog] RAF stall detected: gap=${Math.round(gap)}ms, ` +
        `instances=${stats.instanceCount}, listeners=${stats.totalListeners}, ` +
        `pendingRegistrations=${stats.pendingRegistrations}`
      )
    }
  }, CHECK_INTERVAL_MS)
}
