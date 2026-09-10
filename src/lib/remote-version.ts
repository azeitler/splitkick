/**
 * Remote Jean version probing and compatibility checks.
 *
 * Native desktop clients keep their bundled React UI while talking to a
 * remote headless/Web Access backend. When versions diverge we surface a
 * warning (picker label + toast) but still allow the connection so users
 * are not locked out.
 */

import { toast } from 'sonner'
import { FALLBACK_APP_VERSION } from './app-version'
import { compareVersions } from './version-utils'
import { logger } from './logger'

export interface RemoteServerInfo {
  ok: boolean
  appVersion: string | null
  webBuildId: string | null
}

export type VersionCompatibility =
  | { compatible: true; localVersion: string; remoteVersion: string | null }
  | {
      compatible: false
      localVersion: string
      remoteVersion: string
      message: string
    }

/**
 * Local desktop/UI version. Uses package.json (same source as Cargo package
 * versions in this repo) so native remotes can compare without Vite build
 * globals.
 */
export function getLocalJeanVersion(): string {
  return FALLBACK_APP_VERSION
}

/**
 * Marker kept out of the message text so callers can recognise this failure
 * without matching the whole sentence.
 */
const SSO_PROXY_MARKER = 'SSO login proxy'

/**
 * Shown when a remote URL sits behind an SSO login proxy such as Cloudflare
 * Access, Authelia, Authentik, Google IAP, or oauth2-proxy.
 *
 * The native desktop client cannot sign in to one. Its origin is
 * `tauri://localhost`, so every call to the remote host is cross-origin and
 * `fetch` sends no cookies. A WebView also cannot put headers or cookies on a
 * WebSocket handshake, so `/ws` can never authenticate. A browser can, because
 * there the page and the socket share the proxy's origin. See issue #15.
 */
export const SSO_PROXY_ERROR =
  `This URL is behind an ${SSO_PROXY_MARKER} (for example Cloudflare Access). ` +
  'The Jean desktop app cannot sign in to it, because it cannot send login ' +
  'cookies or headers on the WebSocket connection. Reach the server through a ' +
  'private network instead (Cloudflare One/WARP or Tailscale), or open this ' +
  'URL in a web browser, where the login does work.'

/** True when a message reports the SSO login proxy failure above. */
export function isSsoProxyMessage(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.includes(SSO_PROXY_MARKER)
}

/**
 * Compares the host only, not the whole origin.
 *
 * A login proxy lives on another host - `team.cloudflareaccess.com` for the
 * server at `jean.example.com`. A scheme or port change on the same host is an
 * ordinary redirect instead: a server behind TLS answers `http://host:8080`
 * with a 301 to `https://host:8080`, and comparing origins would read that
 * healthy server as a proxy and refuse to save the connection.
 */
function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname
  } catch {
    // Cannot compare, so do not accuse a proxy.
    return true
  }
}

/**
 * True when something other than Jean answered `/api/auth`.
 *
 * A real Jean server always answers that route with JSON, for 200 and for 401
 * alike (`auth_handler` in `jean-core/src/http_server/server.rs`). So an HTML
 * body, or a redirect to a different host, means a login proxy replied
 * instead.
 *
 * Two cases stay unflagged on purpose: a missing content type, because older
 * servers may omit it, and 5xx, because that is an origin or gateway error
 * rather than a login page.
 */
export function isSsoProxyResponse(
  res: Pick<Response, 'status'> &
    Partial<Pick<Response, 'redirected' | 'url'>> & {
      headers?: { get(name: string): string | null }
    },
  requestUrl: string
): boolean {
  if (res.redirected === true && !sameHost(res.url ?? requestUrl, requestUrl)) {
    return true
  }
  if (res.status >= 500) return false
  const contentType = res.headers?.get('content-type') ?? ''
  if (!contentType) return false
  return !contentType.toLowerCase().includes('json')
}

/**
 * Probe failures that must stop the user from saving a connection, because no
 * retry can make it work. Every other failure stays non-blocking, so a server
 * that is merely offline can still be saved and recovered later.
 */
export function isBlockingProbeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('Invalid access token') ||
    isSsoProxyMessage(error.message)
  )
}

export function buildRemoteAuthUrl(url: string, token: string): string {
  const base = `${url.replace(/\/+$/, '')}/`
  const authUrl = new URL('api/auth', base)
  if (token) authUrl.searchParams.set('token', token)
  return authUrl.toString()
}

export function formatJeanVersionLabel(
  version: string | null | undefined
): string {
  if (!version) return 'version unknown'
  const cleaned = version.startsWith('v') ? version.slice(1) : version
  return `v${cleaned}`
}

/**
 * Compare local desktop client version against a remote Jean appVersion.
 * Missing remote version (older servers) is treated as compatible so we do
 * not spam warnings for pre-version-reporting installs.
 */
export function checkRemoteVersionCompatibility(
  remoteVersion: string | null | undefined,
  localVersion: string = getLocalJeanVersion()
): VersionCompatibility {
  if (!remoteVersion) {
    return { compatible: true, localVersion, remoteVersion: null }
  }

  if (compareVersions(localVersion, remoteVersion) === 0) {
    return { compatible: true, localVersion, remoteVersion }
  }

  const localIsOlder = compareVersions(localVersion, remoteVersion) < 0
  const localLabel = formatJeanVersionLabel(localVersion)
  const remoteLabel = formatJeanVersionLabel(remoteVersion)
  const message = localIsOlder
    ? `This Jean app is ${localLabel}, but the remote server is ${remoteLabel}. Consider updating this app for the best experience.`
    : `This Jean app is ${localLabel}, but the remote server is ${remoteLabel}. Consider updating the remote Jean server (or using a matching app version).`

  return {
    compatible: false,
    localVersion,
    remoteVersion,
    message,
  }
}

export async function fetchRemoteServerInfo(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<RemoteServerInfo> {
  const authUrl = buildRemoteAuthUrl(url, token)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const res = await fetchImpl(authUrl, { signal: controller.signal })
    // Check for a login proxy before the status, because it can answer 200
    // with an HTML sign-in page after a redirect.
    if (isSsoProxyResponse(res, authUrl)) {
      throw new Error(SSO_PROXY_ERROR)
    }
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Invalid access token for this Jean server.')
      }
      throw new Error(`Jean server returned HTTP ${res.status}.`)
    }

    let body: {
      ok?: boolean
      appVersion?: string | null
      webBuildId?: string | null
    }
    try {
      body = await res.json()
    } catch {
      throw new Error('The Jean server did not return a valid response.')
    }

    return {
      ok: body.ok !== false,
      appVersion: body.appVersion ?? null,
      webBuildId: body.webBuildId ?? null,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Timed out reaching the Jean server.')
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Timed out reaching the Jean server.')
    }
    if (error instanceof Error) throw error
    throw new Error(String(error))
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Probe a remote and return its version plus an optional mismatch warning.
 * Does not throw on version mismatch — only on network/auth failures.
 */
export async function probeRemoteConnectionVersion(
  connection: { url: string; token: string },
  options?: {
    fetchImpl?: typeof fetch
    localVersion?: string
  }
): Promise<{
  appVersion: string | null
  warning: string | null
  check: VersionCompatibility
}> {
  const info = await fetchRemoteServerInfo(
    connection.url,
    connection.token,
    options?.fetchImpl ?? fetch
  )
  const check = checkRemoteVersionCompatibility(
    info.appVersion,
    options?.localVersion ?? getLocalJeanVersion()
  )
  return {
    appVersion: info.appVersion,
    warning: check.compatible ? null : check.message,
    check,
  }
}

let notifiedMismatchKey: string | null = null

/**
 * Show a non-blocking toast when the remote Jean version differs from this
 * client. Deduped per local+remote version pair until the page reloads.
 */
export function warnRemoteVersionMismatch(
  remoteVersion: string | null | undefined,
  localVersion: string = getLocalJeanVersion()
): boolean {
  const check = checkRemoteVersionCompatibility(remoteVersion, localVersion)
  if (check.compatible) return false

  const key = `${check.localVersion}|${check.remoteVersion}`
  if (notifiedMismatchKey === key) return true
  notifiedMismatchKey = key

  logger.warn('Remote Jean version mismatch', {
    localVersion: check.localVersion,
    remoteVersion: check.remoteVersion,
  })

  toast.warning('Jean version mismatch', {
    id: 'remote-version-mismatch',
    description: check.message,
    duration: 12_000,
  })

  return true
}

/** Test helper — reset toast dedupe state. */
export function resetRemoteVersionMismatchNotification(): void {
  notifiedMismatchKey = null
}
