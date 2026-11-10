/**
 * Web Access reload log (#72). Counts how often the page starts again, and
 * why, so the reloads of the iOS Home Screen app can be measured.
 *
 * iOS ends the web content process of a Home Screen app in the background,
 * often without a `pagehide`. So the log keeps the last page event
 * (`visible`, `hidden`, `unload`) in `localStorage`. On the next start that
 * event tells the cause:
 *
 * - `hidden`: the page ended while it was in the background. On iOS this is
 *   the process end. (Closing the app in the app switcher usually fires
 *   `pagehide` first, so it shows as `unload`.)
 * - `unload`: the page unloaded normally (a reload, a close, a navigation).
 * - `visible`: the page ended while on screen (a crash).
 *
 * A reload that the app itself starts calls `reloadApp()`, which marks it
 * first, so it never counts as an iOS reload.
 */
import { isNativeApp } from '@/lib/environment'

const STORAGE_KEY = 'jean:web-reload-log'
const MAX_ENTRIES = 200
/** An app reload mark older than this is stale (the reload never happened). */
const APP_RELOAD_MARK_MAX_AGE_MS = 60_000

export type WebStartKind =
  /** First start in this browser (no earlier page event). */
  | 'first'
  /** The page ended in the background: on iOS, the process end. */
  | 'background-end'
  /** The page ended while on screen (a crash). */
  | 'foreground-end'
  /** A browser reload (pull-to-refresh, the reload button). */
  | 'reload'
  /** A new start after a normal unload (app closed, tab opened again). */
  | 'start'
  /** A reload that the app started (Reload toast, palette, error screen). */
  | 'app-reload'

export interface WebStartEntry {
  /** Start time (ms). */
  at: number
  kind: WebStartKind
  /** Time since the last page event (ms), null on the first start. */
  gapMs: number | null
  /** `performance` navigation type: navigate, reload, back_forward. */
  navigationType: string | null
  /** Why the app reloaded (only for `app-reload`). */
  reason?: string
}

interface PageEvent {
  type: 'visible' | 'hidden' | 'unload'
  at: number
}

interface StoredLog {
  lastEvent?: PageEvent
  appReload?: { at: number; reason: string }
  entries: WebStartEntry[]
}

function readLog(): StoredLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { entries: [] }
    const parsed = JSON.parse(raw) as Partial<StoredLog>
    return {
      lastEvent: parsed.lastEvent,
      appReload: parsed.appReload,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return { entries: [] }
  }
}

function writeLog(log: StoredLog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    // The log is best-effort; full or blocked storage must never break the app.
  }
}

function recordEvent(type: PageEvent['type'], now = Date.now()): void {
  const log = readLog()
  log.lastEvent = { type, at: now }
  writeLog(log)
}

function navigationType(): string | null {
  try {
    const [entry] = performance.getEntriesByType(
      'navigation'
    ) as PerformanceNavigationTiming[]
    return entry?.type ?? null
  } catch {
    return null
  }
}

/** Classifies this start from the stored state. Pure, for the tests. */
export function classifyStart(
  log: Pick<StoredLog, 'lastEvent' | 'appReload'>,
  navType: string | null,
  now: number
): Pick<WebStartEntry, 'kind' | 'gapMs' | 'reason'> {
  const gapMs = log.lastEvent ? Math.max(0, now - log.lastEvent.at) : null
  const appReload = log.appReload
  if (appReload && now - appReload.at <= APP_RELOAD_MARK_MAX_AGE_MS) {
    return { kind: 'app-reload', gapMs, reason: appReload.reason }
  }
  switch (log.lastEvent?.type) {
    case undefined:
      return { kind: 'first', gapMs }
    case 'hidden':
      return { kind: 'background-end', gapMs }
    case 'visible':
      return { kind: 'foreground-end', gapMs }
    case 'unload':
      return { kind: navType === 'reload' ? 'reload' : 'start', gapMs }
  }
}

/**
 * Records this start and follows the page events. Call once at boot, in Web
 * Access only. Returns the entry for this start, or null in the native app.
 */
export function installWebReloadLog(now = Date.now()): WebStartEntry | null {
  if (isNativeApp() || typeof window === 'undefined') return null

  const log = readLog()
  const navType = navigationType()
  const entry: WebStartEntry = {
    at: now,
    navigationType: navType,
    ...classifyStart(log, navType, now),
  }
  writeLog({
    entries: [...log.entries, entry].slice(-MAX_ENTRIES),
    lastEvent: {
      type: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
      at: now,
    },
  })

  // An unload fires `pagehide` first and `visibilitychange` (hidden) after
  // it (HTML spec; seen in iOS Safari on a reload). Without this flag the
  // later "hidden" would turn every reload into a background end.
  let unloading = false
  document.addEventListener('visibilitychange', () => {
    if (unloading) return
    recordEvent(document.visibilityState === 'hidden' ? 'hidden' : 'visible')
  })
  // A page kept in the back/forward cache is not unloaded.
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    unloading = true
    recordEvent('unload')
  })
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return
    unloading = false
    recordEvent('visible')
  })
  return entry
}

/** Reloads the page and marks the reload as started by the app. */
export function reloadApp(reason: string): void {
  if (!isNativeApp()) {
    const log = readLog()
    log.appReload = { at: Date.now(), reason }
    writeLog(log)
  }
  window.location.reload()
}

/** All recorded starts, oldest first. */
export function getWebReloadLog(): WebStartEntry[] {
  return readLog().entries
}

export function clearWebReloadLog(): void {
  const log = readLog()
  writeLog({ lastEvent: log.lastEvent, entries: [] })
}

/** Starts of the given kind since `since` (ms). */
export function countStarts(
  entries: WebStartEntry[],
  kind: WebStartKind,
  since: number
): number {
  return entries.filter(entry => entry.kind === kind && entry.at >= since)
    .length
}
