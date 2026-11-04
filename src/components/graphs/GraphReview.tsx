import { useMemo, useState, type ReactNode } from 'react'
import { Ban, Check, CheckCheck, Eye, Inbox, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import {
  useAnswerGraphRequest,
  useGraphRequests,
  useMarkGraphChangesSeen,
  useRevertGraphChange,
} from '@/services/graphs'
import type {
  GraphActor,
  GraphChange,
  GraphRequest,
  GraphRequestAction,
} from '@/types/graphs'
import { AgentBadge } from './AgentBadge'
import { useAgentProfile } from './agent-utils'
import type { GraphTabProps } from './graph-tab'

/** How many seen changes show below the line. */
const SEEN_LIMIT = 20

/** `ms epoch` as "5 min ago (full date)". */
function TimeAgo({ at }: { at: number }) {
  return (
    <span title={new Date(at).toLocaleString()}>{formatRelativeTime(at)}</span>
  )
}

/**
 * Review tab (mockup screen 4). Left: requests for the user (accept done,
 * send back, answer a decision). Right: changes the user has not seen,
 * grouped by node, with Seen, Mark all seen and Revert; then the last seen
 * changes, dimmed.
 */
export function GraphReview({
  graphId,
  detail,
  changes,
  onSelectNode,
}: GraphTabProps) {
  const { data: requests } = useGraphRequests(graphId)
  const open = (requests ?? []).filter(r => r.status === 'open')
  const answered = (requests ?? []).filter(r => r.status !== 'open')
  const titleOf = (nodeId: string | null) =>
    (nodeId && detail.nodes.find(n => n.id === nodeId)?.title) ||
    nodeId ||
    'Graph'

  return (
    <div
      className="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2"
      data-testid="graph-review"
    >
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Inbox className="size-4" aria-hidden="true" />
          Requests for you
          {open.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white">
              {open.length}
            </span>
          )}
        </h2>
        {open.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing waits for you.
          </p>
        )}
        {open.map(request => (
          <RequestCard
            key={request.id}
            graphId={graphId}
            request={request}
            nodeTitle={titleOf(request.nodeId)}
            onSelectNode={onSelectNode}
          />
        ))}
        {answered.length > 0 && (
          <details className="text-sm" data-testid="answered-requests">
            <summary className="cursor-pointer text-muted-foreground">
              Answered ({answered.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2 opacity-60">
              {answered.map(request => (
                <li key={request.id} className="rounded-md border px-3 py-2">
                  <div className="font-medium">{request.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {request.status}
                    {request.answer && <> · {request.answer}</>}
                    {request.answeredAt && (
                      <>
                        {' · '}
                        <TimeAgo at={request.answeredAt} />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <ChangesColumn
        graphId={graphId}
        changes={changes ?? []}
        titleOf={titleOf}
      />
    </div>
  )
}

function RequestCard({
  graphId,
  request,
  nodeTitle,
  onSelectNode,
}: {
  graphId: string
  request: GraphRequest
  nodeTitle: string
  onSelectNode: (nodeId: string | null) => void
}) {
  const answer = useAnswerGraphRequest()
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [otherOpen, setOtherOpen] = useState(false)
  const [other, setOther] = useState('')

  const send = (action: GraphRequestAction, text?: string) =>
    answer.mutate({ graphId, requestId: request.id, action, answer: text })

  return (
    <article
      className="flex flex-col gap-2 rounded-lg border p-3"
      data-testid="graph-request"
    >
      <div className="flex items-center gap-2">
        {request.kind === 'accept-done' ? (
          <span className="rounded bg-amber-500/15 px-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            accept done
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded bg-red-500/10 px-1.5 text-xs font-medium text-red-500">
            <Ban className="size-3" aria-hidden="true" />
            decision
          </span>
        )}
        <h3 className="min-w-0 truncate text-sm font-semibold">
          {request.title}
        </h3>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {request.fromSessionName && <span>{request.fromSessionName}</span>}
        <AgentBadge
          agentId={request.agentId}
          sessionName={request.fromSessionName}
        />
        <span>
          · <TimeAgo at={request.createdAt} /> ·{' '}
        </span>
        {request.kind === 'decision' && request.blocker && (
          <span>resolves blocked-by on</span>
        )}
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => onSelectNode(request.nodeId)}
        >
          {nodeTitle}
        </button>
      </div>
      {request.body && (
        <p className="text-sm whitespace-pre-wrap">{request.body}</p>
      )}
      {request.evidence.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {request.evidence.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      {request.kind === 'accept-done' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={answer.isPending}
              onClick={() => send('accept')}
            >
              <Check className="size-4" aria-hidden="true" />
              Accept (→ done)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={answer.isPending}
              onClick={() => setNoteOpen(value => !value)}
            >
              <Undo2 className="size-4" aria-hidden="true" />
              Send back with note…
            </Button>
          </div>
          {noteOpen && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Note for the session"
                placeholder="What is missing?"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                disabled={!note.trim() || answer.isPending}
                onClick={() => send('send-back', note.trim())}
              >
                Send back
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {request.options.map(option => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant="outline"
                disabled={answer.isPending}
                onClick={() => send('answer', option)}
              >
                {option}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOtherOpen(value => !value)}
            >
              Other answer…
            </Button>
          </div>
          {otherOpen && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Your answer"
                value={other}
                onChange={e => setOther(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                disabled={!other.trim() || answer.isPending}
                onClick={() => send('answer', other.trim())}
              >
                Answer
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  )
}

interface NodeGroup {
  nodeId: string | null
  changes: GraphChange[]
}

function groupByNode(changes: GraphChange[]): NodeGroup[] {
  const groups = new Map<string, NodeGroup>()
  for (const change of changes) {
    const key = change.nodeId ?? ''
    const group = groups.get(key) ?? { nodeId: change.nodeId, changes: [] }
    group.changes.push(change)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function ChangesColumn({
  graphId,
  changes,
  titleOf,
}: {
  graphId: string
  changes: GraphChange[]
  titleOf: (nodeId: string | null) => string
}) {
  const markSeen = useMarkGraphChangesSeen()
  const unseen = useMemo(() => changes.filter(c => !c.seen), [changes])
  const groups = useMemo(() => groupByNode(unseen), [unseen])
  const seen = useMemo(
    () => changes.filter(c => c.seen).slice(0, SEEN_LIMIT),
    [changes]
  )

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-sm font-semibold">
          <Eye className="size-4" aria-hidden="true" />
          Changes since you last looked
          <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
            {unseen.length}
          </span>
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={unseen.length === 0 || markSeen.isPending}
          onClick={() => markSeen.mutate({ graphId })}
        >
          <CheckCheck className="size-4" aria-hidden="true" />
          Mark all seen
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing new.</p>
      )}
      {groups.map(group => (
        <div
          key={group.nodeId ?? '__graph'}
          className="rounded-lg border"
          data-testid="unseen-group"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {titleOf(group.nodeId)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {group.changes.length}{' '}
                {group.changes.length === 1 ? 'change' : 'changes'}
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={markSeen.isPending}
              onClick={() =>
                markSeen.mutate({
                  graphId,
                  changeIds: group.changes.map(c => c.id),
                })
              }
            >
              <Check className="size-4" aria-hidden="true" />
              Seen
            </Button>
          </div>
          <ul className="divide-y">
            {group.changes.map(change => (
              <ChangeRow key={change.id} graphId={graphId} change={change} />
            ))}
          </ul>
        </div>
      ))}

      {seen.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            seen
            <span className="h-px flex-1 bg-border" />
          </div>
          <ul className="flex flex-col divide-y rounded-lg border opacity-60">
            {seen.map(change => (
              <ChangeRow
                key={change.id}
                graphId={graphId}
                change={change}
                nodeTitle={titleOf(change.nodeId)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ChangeRow({
  graphId,
  change,
  nodeTitle,
}: {
  graphId: string
  change: GraphChange
  /** Shown for seen changes, which are not grouped. */
  nodeTitle?: string
}) {
  const revert = useRevertGraphChange()
  const reverted = change.revertedBy !== null
  // Only node changes carry snapshots; graph-level ones (create, rename,
  // send-back) cannot be reverted, so they get no button.
  const revertable =
    change.nodeId !== null && (change.before !== null || change.after !== null)
  return (
    <li className="flex gap-2 px-3 py-2" data-testid="graph-change">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-sm', reverted && 'line-through')}>
          {nodeTitle && (
            <span className="text-muted-foreground">{nodeTitle}: </span>
          )}
          {change.summary}
        </span>
        {change.why && (
          <span className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Why:</span>{' '}
            {change.why}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Actor actor={change.actor} />
          <span>
            · <TimeAgo at={change.at} />
          </span>
        </span>
      </div>
      {(revertable || reverted) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0"
          disabled={reverted || revert.isPending}
          onClick={() => revert.mutate({ graphId, changeId: change.id })}
        >
          <Undo2 className="size-4" aria-hidden="true" />
          {reverted ? 'reverted' : 'Revert'}
        </Button>
      )}
    </li>
  )
}

/** Who made a change: You, or session name + agent badge + permission. */
function Actor({ actor }: { actor: GraphActor }): ReactNode {
  const agent = useAgentProfile(actor.kind === 'session' ? actor.agentId : null)
  if (actor.kind === 'user') return <span>You</span>
  return (
    <>
      <span>{actor.sessionName}</span>
      <AgentBadge agentId={actor.agentId} sessionName={actor.sessionName} />
      {agent && (
        <span
          className="rounded-full border px-1.5 text-[10px]"
          title="Permission of the agent profile"
        >
          {agent.permission}
        </span>
      )}
    </>
  )
}
