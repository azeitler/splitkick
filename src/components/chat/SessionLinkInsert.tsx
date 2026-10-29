import { useContext } from 'react'
import { CornerDownRight } from 'lucide-react'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useSessionLink } from '@/services/chat'
import type { SessionLink } from '@/types/chat'
import { CurrentSessionContext } from './CurrentSessionContext'

/** Splitkick MCP tools whose result names a session they started or sent to. */
const SESSION_TOOLS = new Set([
  'create_session',
  'send_chat_message',
  'create_worktree',
])

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** MCP results can arrive raw or wrapped as `{content: [{type: 'text', text}]}` / `[{text}]`. */
function unwrapMcpResult(value: unknown): unknown {
  const blocks = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && 'content' in value
      ? (value as { content: unknown }).content
      : null
  if (!Array.isArray(blocks)) return value
  const text = blocks.find(
    (b): b is { text: string } =>
      !!b && typeof b === 'object' && typeof b.text === 'string'
  )?.text
  return text ? parseJson(text) : null
}

/**
 * Session id named by a Splitkick MCP tool result, for the tools that start
 * or message a session. `bareToolName` is the name without MCP prefixes.
 */
export function getLinkedSessionId(
  bareToolName: string | null,
  output: string | undefined
): string | null {
  if (!bareToolName || !SESSION_TOOLS.has(bareToolName) || !output) return null
  const result = unwrapMcpResult(parseJson(output))
  if (!result || typeof result !== 'object') return null
  const record = result as Record<string, unknown>
  const id = bareToolName === 'create_session' ? record.id : record.sessionId
  return typeof id === 'string' && id ? id : null
}

/** "Started session" when this chat is the child's recorded parent, else "Sent to session". */
export function linkVerb(
  bareToolName: string,
  link: SessionLink | null,
  currentSessionId: string | null
): 'Started session' | 'Sent to session' {
  if (bareToolName !== 'send_chat_message') return 'Started session'
  return link?.startedBySessionId &&
    link.startedBySessionId === currentSessionId
    ? 'Started session'
    : 'Sent to session'
}

export function SessionLinkRow({
  prefix,
  link,
  goneText,
  className = 'mt-1',
}: {
  prefix: string
  link: SessionLink | null
  goneText: string
  className?: string
}) {
  return (
    <div
      className={`${className} flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground`}
    >
      <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
      {link ? (
        <>
          <span>
            {prefix} ‘
            <span className="font-medium text-foreground">{link.name}</span>’
            {link.archived && ' · archived'}
          </span>
          {!link.archived && (
            <button
              type="button"
              onClick={() =>
                navigateToSession({
                  projectId: link.projectId,
                  worktreeId: link.worktreeId,
                  sessionId: link.sessionId,
                })
              }
              className="ml-auto font-medium text-foreground underline-offset-2 hover:underline"
            >
              View →
            </button>
          )}
        </>
      ) : (
        <span>{goneText}</span>
      )}
    </div>
  )
}

/** Insert under a Splitkick MCP tool call that started or messaged a session (#62). */
export function SessionLinkInsert({
  bareToolName,
  sessionId,
}: {
  bareToolName: string
  sessionId: string
}) {
  const currentSessionId = useContext(CurrentSessionContext)
  const { data: link, isSuccess } = useSessionLink(sessionId)
  if (!isSuccess) return null
  const verb = linkVerb(bareToolName, link, currentSessionId)
  return (
    <SessionLinkRow
      prefix={verb}
      link={link}
      goneText={`${verb} (no longer available)`}
    />
  )
}
