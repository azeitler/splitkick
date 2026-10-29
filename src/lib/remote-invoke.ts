/**
 * Run one backend command on another Jean instance over plain HTTP.
 *
 * Each window talks to one backend through `invoke` (`src/lib/transport.ts`).
 * To reach a *different* saved connection without opening a WebSocket to it,
 * post the command to its `POST /api/invoke?token=…` route instead
 * (`invoke_handler` in `jean-core/src/http_server/server.rs`). The route runs
 * the same `dispatch_command` as the WebSocket, so command names and args are
 * the same as for `invoke`.
 *
 * Used by session transfer (issue #35). Generic on purpose: any feature that
 * acts on a second instance can use it.
 */

import { PRODUCT_NAME } from '@/lib/build-info'
import { isNativeApp } from '@/lib/environment'
import type { RemoteConnection } from './remote-connections'
import { isSsoProxyResponse, SSO_PROXY_ERROR } from './remote-version'

export type RemoteInvokeTarget = Pick<
  RemoteConnection,
  'name' | 'url' | 'token'
>

export interface RemoteInvokeOptions {
  fetchImpl?: typeof fetch
  /** Default 60 s. Large uploads (a session bundle) pass more. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

export function buildRemoteInvokeUrl(url: string, token: string): string {
  const base = `${url.replace(/\/+$/, '')}/`
  const invokeUrl = new URL('api/invoke', base)
  if (token) invokeUrl.searchParams.set('token', token)
  return invokeUrl.toString()
}

export async function remoteInvoke<T>(
  target: RemoteInvokeTarget,
  command: string,
  args: Record<string, unknown> = {},
  options: RemoteInvokeOptions = {}
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch
  const requestUrl = buildRemoteInvokeUrl(target.url, target.token)
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )

  try {
    let res: Response
    try {
      res = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
        signal: controller.signal,
      })
    } catch (error) {
      // A browser hides a CORS refusal behind a plain network error.
      if (error instanceof TypeError && !isNativeApp()) {
        throw new Error(
          `Could not reach ${target.name}. In Web Access the target must allow this origin: start it with JEAN_ALLOWED_ORIGINS=${window.location.origin}`
        )
      }
      throw error
    }
    // Known statuses first: axum answers 405 and 413 as plain text, which the
    // login-proxy check would read as a proxy page.
    if (res.status === 401) {
      throw new Error(`Invalid access token for ${target.name}.`)
    }
    // A Jean without the route answers 405: its fallback only takes GET.
    if (res.status === 404 || res.status === 405) {
      throw new Error(
        `Update ${PRODUCT_NAME} on ${target.name}: it is too old for this action.`
      )
    }
    if (res.status === 413) {
      throw new Error(`The request is too large for ${target.name}.`)
    }
    if (isSsoProxyResponse(res, requestUrl)) {
      throw new Error(SSO_PROXY_ERROR)
    }

    let body: { ok?: boolean; data?: unknown; error?: string }
    try {
      body = await res.json()
    } catch {
      throw new Error(
        `${target.name} returned HTTP ${res.status} without a valid response.`
      )
    }
    if (!res.ok || body.ok === false) {
      throw new Error(
        body.error || `${target.name} returned HTTP ${res.status}.`
      )
    }
    return body.data as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out waiting for ${target.name}.`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timeout)
  }
}
