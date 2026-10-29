import { describe, expect, it, vi } from 'vitest'
import { buildRemoteInvokeUrl, remoteInvoke } from './remote-invoke'
import { SSO_PROXY_ERROR } from './remote-version'

const target = {
  name: 'Studio',
  url: 'https://jean.example.com/',
  token: 't 1',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(status: number, body = ''): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  })
}

describe('remoteInvoke', () => {
  it('builds the invoke URL with the token', () => {
    expect(buildRemoteInvokeUrl('https://jean.example.com/', 't 1')).toBe(
      'https://jean.example.com/api/invoke?token=t+1'
    )
    expect(buildRemoteInvokeUrl('https://jean.example.com', '')).toBe(
      'https://jean.example.com/api/invoke'
    )
  })

  it('posts the command and returns data', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, data: [{ id: 'p1' }] })
    )

    const data = await remoteInvoke(
      target,
      'list_worktrees',
      { projectId: 'p1' },
      { fetchImpl }
    )

    expect(data).toEqual([{ id: 'p1' }])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://jean.example.com/api/invoke?token=t+1')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      command: 'list_worktrees',
      args: { projectId: 'p1' },
    })
  })

  it('reports the command error from the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, { ok: false, error: 'Worktree not found: w1' })
    )
    await expect(
      remoteInvoke(target, 'import_session_bundle', {}, { fetchImpl })
    ).rejects.toThrow('Worktree not found: w1')
  })

  it('names the connection on a bad token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { ok: false, error: 'Invalid token' })
    )
    await expect(
      remoteInvoke(target, 'list_projects', {}, { fetchImpl })
    ).rejects.toThrow('Invalid access token for Studio.')
  })

  it.each([404, 405])('asks to update an old remote on %i', async status => {
    const fetchImpl = vi.fn(async () => textResponse(status))
    await expect(
      remoteInvoke(target, 'list_projects', {}, { fetchImpl })
    ).rejects.toThrow(/^Update .* on Studio/)
  })

  it('reports a body that is too large', async () => {
    const fetchImpl = vi.fn(async () => textResponse(413))
    await expect(
      remoteInvoke(target, 'import_session_bundle', {}, { fetchImpl })
    ).rejects.toThrow('too large for Studio')
  })

  it('detects an SSO login page', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html>login</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
    )
    await expect(
      remoteInvoke(target, 'list_projects', {}, { fetchImpl })
    ).rejects.toThrow(SSO_PROXY_ERROR)
  })

  it('times out', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )
    await expect(
      remoteInvoke(
        target,
        'list_projects',
        {},
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          timeoutMs: 5,
        }
      )
    ).rejects.toThrow('Timed out waiting for Studio.')
  })

  it('names the origin to allow when Web Access cannot reach the target', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      remoteInvoke(target, 'list_projects', {}, { fetchImpl })
    ).rejects.toThrow(
      `Could not reach Studio. In Web Access the target must allow this origin: start it with JEAN_ALLOWED_ORIGINS=${window.location.origin}`
    )
  })

  it('keeps the network error in the native app', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Load failed')
    })
    const tauriWindow = window as unknown as Record<string, unknown>
    tauriWindow.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    try {
      await expect(
        remoteInvoke(target, 'list_projects', {}, { fetchImpl })
      ).rejects.toThrow('Load failed')
    } finally {
      delete tauriWindow.__TAURI_INTERNALS__
    }
  })
})
