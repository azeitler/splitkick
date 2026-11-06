import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { api, mcp, readEnv, waitForIdle } from '../helpers'
import type { Instance } from '../launcher'
import { goToSession, openApp, shot, uniqueName } from './ui'

// Agents on A use B through list_instances and remote_tool (#94).

interface ToolResult {
  content: { type: string; text: string }[]
  _meta?: { splitkickInstance?: { id: string; name: string } }
}

const CONNECTION_ID = 'e2e-remote-b'
const NAME = 'B box'

/** The remote's own text block (block 0 is the instance tag). */
function remoteJson<T>(result: ToolResult): T {
  return JSON.parse(result.content[1].text) as T
}

function remoteTool(
  a: Instance,
  tool: string,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  return mcp<ToolResult>(a, 'e2e-remote-caller', 'remote_tool', {
    instance: NAME,
    tool,
    arguments: args,
  })
}

test.beforeAll(async () => {
  const { a, b } = readEnv()
  await api(a, 'save_remote_connection', {
    connection: { id: CONNECTION_ID, name: NAME, url: b.url, token: b.token },
  })
})

test('connections keep the token out of the list and the file (#94)', async () => {
  const { a, b } = readEnv()
  const listed = await api<unknown[]>(a, 'list_remote_connections')
  const text = JSON.stringify(listed)
  expect(text).toContain(NAME)
  expect(text).toContain('"hasToken":true')
  expect(text).not.toContain(b.token)

  const onDisk = readFileSync(join(a.data, 'remote-connections.json'), 'utf8')
  expect(onDisk).toContain(NAME)
  expect(onDisk).not.toContain(b.token)

  // Sealed: the token went to the file store, not to the login Keychain.
  if (process.platform === 'darwin') {
    let found = true
    try {
      execFileSync(
        'security',
        [
          'find-generic-password',
          '-s',
          'Splitkick remote connection token',
          '-a',
          `${a.data}/${CONNECTION_ID}`,
        ],
        { stdio: 'ignore' }
      )
    } catch {
      found = false
    }
    expect(found).toBe(false)
  }
})

test('list_instances → remote_tool create/send/read on B (#94)', async ({
  page,
}) => {
  const { a, b, alphaB } = readEnv()

  const listed = await mcp<ToolResult>(a, 'anon', 'list_instances', {})
  expect(listed.content[0].text).not.toContain(b.token)
  const { instances } = JSON.parse(listed.content[0].text) as {
    instances: { id: string; name: string; reachable: boolean }[]
  }
  expect(instances).toContainEqual(
    expect.objectContaining({ id: CONNECTION_ID, name: NAME, reachable: true })
  )

  const projects = await remoteTool(a, 'list_projects')
  expect(projects.content[0].text).toContain(`"${NAME}"`)
  expect(projects._meta?.splitkickInstance?.id).toBe(CONNECTION_ID)
  expect(remoteJson<{ id: string }[]>(projects).map(p => p.id)).toContain(
    alphaB.projectId
  )

  const name = uniqueName('Remote MCP')
  const created = await remoteTool(a, 'create_session', {
    worktreeId: alphaB.worktreeId,
    name,
  })
  const sessionId = remoteJson<{ id: string }>(created).id
  expect(sessionId).toBeTruthy()

  await remoteTool(a, 'send_chat_message', {
    sessionId,
    message: 'Hello from A. E2E-REMOTE-MCP',
  })
  await expect
    .poll(
      async () => {
        await waitForIdle(b, sessionId)
        const read = await remoteTool(a, 'read_session_messages', {
          sessionId,
        })
        return read.content[1].text
      },
      { timeout: 60_000 }
    )
    .toContain('STUB REPLY')
  const read = await remoteTool(a, 'read_session_messages', { sessionId })
  expect(read.content[1].text).toContain('Hello from A. E2E-REMOTE-MCP')

  // B's own UI shows the message that A's agent sent.
  await openApp(page, b)
  await goToSession(page, name)
  await expect(
    page.getByText('Hello from A. E2E-REMOTE-MCP').first()
  ).toBeVisible()
  await expect(page.getByText('STUB REPLY').first()).toBeVisible()
  await shot(page, 'remote-mcp-session-on-b')
})

test('remote_tool refuses loops, graph writes, unknown and bad-token instances (#94)', async () => {
  const { a, b } = readEnv()
  const refused = async (call: Promise<unknown>) => {
    const error = await call.then(
      () => null,
      (e: Error) => e.message
    )
    expect(error).not.toBeNull()
    return error ?? ''
  }

  expect(
    await refused(
      mcp(a, 'anon', 'remote_tool', { instance: 'mars', tool: 'list_projects' })
    )
  ).toContain("Unknown Splitkick instance 'mars'")
  expect(
    await refused(remoteTool(a, 'set_node_state', { graphId: 'g' }))
  ).toContain('not available across instances')

  // B refuses to forward a call that came from A: one hop only.
  const loop = await fetch(`${b.url}/api/mcp/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${b.token}`,
    },
    body: JSON.stringify({
      tool: 'remote_tool',
      arguments: { instance: 'anything', tool: 'list_projects' },
      origin: 'e2e',
      hop: 1,
    }),
  })
  expect(loop.status).toBe(422)
  expect(((await loop.json()) as { error: string }).error).toContain(
    'one hop only'
  )

  const unauthorized = await fetch(`${b.url}/api/mcp/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'list_projects' }),
  })
  expect(unauthorized.status).toBe(401)

  await api(a, 'save_remote_connection', {
    connection: {
      id: 'e2e-bad-token',
      name: 'Bad token',
      url: b.url,
      token: 'not-the-token',
    },
  })
  expect(
    await refused(
      mcp(a, 'anon', 'remote_tool', {
        instance: 'Bad token',
        tool: 'list_projects',
      })
    )
  ).toContain('rejected the access token')
  await api(a, 'remove_remote_connection', { id: 'e2e-bad-token' })
})
