// Deterministic stand-in for the `claude` CLI, used by the local two-instance
// e2e run (issue #65). Splitkick starts it like the real CLI:
//   cat <input.jsonl> | claude --print --output-format stream-json --input-format stream-json ...
// It answers in Claude's stream-json format without any model or login.
//
// Reply: "STUB REPLY mode=<execution mode>. Seen markers: <E2E-* tokens>". The
// markers come from stdin, argv and every readable file whose absolute path
// appears in them, so a reply proves which history, pasted files and contexts
// reached the agent.
//
// Script lines in the user message (one per line):
//   STUB:mcp <tool> <json args>  call the Splitkick MCP socket as this session
//   STUB:say <text>              put <text> verbatim into the reply
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'

const argv = process.argv.slice(2)

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write('2.1.0 (Claude Code)\n')
  process.exit(0)
}
if (!argv.includes('--print')) {
  // auth status, doctor, update, ...: report success.
  process.stdout.write(
    JSON.stringify({ loggedIn: true, authMethod: 'stub' }) + '\n'
  )
  process.exit(0)
}

const MARKER = /E2E-[A-Z0-9-]*[A-Z0-9]/g
const PATH = /\/(?:private\/)?(?:tmp|var)\/[^\s"'`)\]\\<>]+/g

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function emit(line) {
  process.stdout.write(JSON.stringify(line) + '\n')
}

/** Text of the last user message in the stream-json input. */
function userText(input) {
  let text = ''
  for (const raw of input.split('\n')) {
    if (!raw.trim()) continue
    try {
      const line = JSON.parse(raw)
      const content = line?.message?.content
      if (typeof content === 'string') text = content
      else if (Array.isArray(content))
        text = content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n')
    } catch {
      // not JSON: ignore
    }
  }
  return text
}

/** Text plus the content of every readable file it names (one level deep). */
function corpus(text) {
  let all = text
  for (const path of new Set(text.match(PATH) ?? [])) {
    try {
      if (existsSync(path) && statSync(path).isFile()) {
        all += '\n' + readFileSync(path, 'utf8')
      }
    } catch {
      // unreadable: ignore
    }
  }
  return all
}

function mcpServer() {
  const index = argv.indexOf('--mcp-config')
  if (index < 0) return null
  const servers = JSON.parse(argv[index + 1]).mcpServers ?? {}
  for (const [name, server] of Object.entries(servers)) {
    if (!name.includes('dialog') && server.env?.JEAN_MCP_SOCKET) {
      return { name, env: server.env }
    }
  }
  return null
}

function callMcp(server, name, args) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.env.JEAN_MCP_SOCKET)
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end >= 0) {
        socket.end()
        resolve(JSON.parse(buffer.slice(0, end)))
      }
    })
    socket.on('error', reject)
    socket.write(
      JSON.stringify({
        token: server.env.JEAN_MCP_TOKEN,
        source: server.env.JEAN_MCP_SESSION,
        depth: Number(server.env.JEAN_MCP_DEPTH ?? 0),
        role: 'full',
        name,
        arguments: args,
      }) + '\n'
    )
  })
}

const input = readStdin()
const text = userText(input)
const sessionId = randomUUID()
const mode = process.env.JEAN_EXECUTION_MODE ?? 'unknown'
const said = []

emit({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  model: 'stub',
  tools: [],
})

for (const line of text.split('\n')) {
  const say = line.match(/^STUB:say (.*)$/)
  if (say) said.push(say[1])
  const call = line.match(/^STUB:mcp (\S+)\s*(.*)$/)
  if (!call) continue
  const server = mcpServer()
  const [, tool, rawArgs] = call
  const args = rawArgs ? JSON.parse(rawArgs) : {}
  const toolUseId = `toolu_stub_${randomUUID().slice(0, 8)}`
  emit({
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: `msg_${randomUUID()}`,
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: `mcp__${server?.name ?? 'none'}__${tool}`,
          input: args,
        },
      ],
    },
  })
  let result
  try {
    result = server
      ? await callMcp(server, tool, args)
      : { error: 'no MCP server' }
  } catch (error) {
    result = { error: String(error) }
  }
  emit({
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(result.result ?? result),
          is_error: Boolean(result.error),
        },
      ],
    },
  })
}

const markers = [
  ...new Set(corpus(input + '\n' + argv.join('\n')).match(MARKER) ?? []),
].sort()
const reply = [
  `STUB REPLY mode=${mode}. Seen markers: ${markers.join(', ') || 'none'}`,
  ...said,
].join('\n\n')

emit({
  type: 'assistant',
  session_id: sessionId,
  message: {
    id: `msg_${randomUUID()}`,
    role: 'assistant',
    content: [{ type: 'text', text: reply }],
  },
})
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: reply,
  session_id: sessionId,
  usage: { input_tokens: 1, output_tokens: 1 },
})
