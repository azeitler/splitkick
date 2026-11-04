import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Ban, Play, Plus, Trash2, X } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { isNativeApp } from '@/lib/environment'
import { navigateToSession } from '@/lib/navigate-to-session'
import { formatRelativeTime } from '@/lib/relative-time'
import {
  useDeleteGraphNode,
  useMarkGraphChangesSeen,
  useUpdateGraphNode,
} from '@/services/graphs'
import {
  NODE_STATES,
  RELATION_KINDS,
  type GraphAttachment,
  type GraphChange,
  type GraphDetail,
  type GraphNode,
  type GraphNodePatch,
  type GraphRelation,
  type NodeState,
  type RelationKind,
} from '@/types/graphs'
import { useUIStore } from '@/store/ui-store'
import { AgentBadge } from './AgentBadge'
import {
  BlockedBadge,
  NodeStateChip,
  NodeStateGlyph,
  NotFound,
} from './graph-badges'
import { attachmentUrl, INCOMING_LABELS, resolveRef } from './graph-utils'

export const ATTACHMENT_KINDS = [
  'issue',
  'pr',
  'milestone',
  'link',
  'file',
  'session',
  'note',
] as const

interface GraphNodeDetailProps {
  graphId: string
  detail: GraphDetail
  nodeId: string
  changes: GraphChange[] | undefined
  onClose: () => void
}

/**
 * Node detail, the panel right of a graph tab. Stored fields are editable
 * (the user always has `manage`); derived ones (blocked, serving sessions,
 * incoming relations) are read-only. Mount it with `key={nodeId}` so the
 * local drafts start over per node.
 */
export function GraphNodeDetail({
  graphId,
  detail,
  nodeId,
  changes,
  onClose,
}: GraphNodeDetailProps) {
  const node = detail.nodes.find(n => n.id === nodeId)
  const derived = detail.derived[nodeId]
  const updateNode = useUpdateGraphNode()
  const markSeen = useMarkGraphChangesSeen()

  const nodeChanges = useMemo(
    () => (changes ?? []).filter(c => c.nodeId === nodeId),
    [changes, nodeId]
  )

  // Looking at a node is seeing its changes.
  // Joined, so a refetch with the same unseen changes does not send again.
  const unseenKey = nodeChanges
    .filter(c => !c.seen)
    .map(c => c.id)
    .join(',')
  const markSeenMutate = markSeen.mutate
  useEffect(() => {
    if (unseenKey) {
      markSeenMutate({ graphId, changeIds: unseenKey.split(',') })
    }
  }, [graphId, unseenKey, markSeenMutate])

  const patch = useCallback(
    (changes: GraphNodePatch) =>
      updateNode.mutate({ graphId, nodeId, patch: changes }),
    [graphId, nodeId, updateNode]
  )

  if (!node) {
    return (
      <aside className="flex w-[400px] shrink-0 flex-col border-l p-4 text-sm text-muted-foreground">
        This node no longer exists.
        <Button variant="ghost" size="sm" className="w-fit" onClick={onClose}>
          Close
        </Button>
      </aside>
    )
  }

  return (
    <aside
      className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l"
      data-testid="graph-node-detail"
    >
      <header className="flex flex-col gap-1 border-b p-4">
        <div className="flex items-center gap-2">
          <NodeStateChip state={node.state} />
          {derived?.blocked && <BlockedBadge blockers={derived.blockers} />}
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Close node detail"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <TitleField value={node.title} onSave={title => patch({ title })} />
        <p className="font-mono text-xs text-muted-foreground">
          id {node.id} · {detail.summary.title}
        </p>
      </header>

      <Section title="Description">
        <DescriptionField
          value={node.description}
          onSave={description => patch({ description })}
        />
      </Section>

      <Section title="State">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={node.state}
          onValueChange={value => {
            if (value && value !== node.state) {
              patch({ state: value as NodeState })
            }
          }}
          className="w-full"
          aria-label="Node state"
        >
          {NODE_STATES.map(state => (
            <ToggleGroupItem
              key={state}
              value={state}
              aria-label={state}
              className="min-w-0 gap-1 px-1.5 text-xs"
            >
              <NodeStateGlyph state={state} className="size-3.5" />
              {state}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {derived?.blocked && derived.blockers.length > 0 && (
          <p className="mt-2 flex items-start gap-1 text-xs text-red-500">
            <Ban className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Derived blocked: {derived.blockers.join('; ')}
          </p>
        )}
      </Section>

      <Section title="Properties">
        <PropertiesEditor
          properties={node.properties}
          onChange={properties => patch({ properties })}
        />
      </Section>

      <Section title="Relations">
        <RelationsEditor
          node={node}
          detail={detail}
          onChange={relations => patch({ relations })}
        />
        <IncomingList detail={detail} nodeId={node.id} />
      </Section>

      <Section title="Attachments">
        <AttachmentsEditor
          attachments={node.attachments}
          onChange={attachments => patch({ attachments })}
        />
      </Section>

      <Section title="Serving sessions">
        {derived && derived.serving.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {derived.serving.map(session => (
              <li key={session.sessionId}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-accent/50"
                  onClick={() =>
                    navigateToSession({
                      projectId: session.projectId,
                      worktreeId: session.worktreeId,
                      sessionId: session.sessionId,
                    })
                  }
                >
                  <span className="truncate">{session.sessionName}</span>
                  <AgentBadge
                    agentId={session.agentId}
                    sessionName={session.sessionName}
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    {session.worktreeName} · {session.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No session serves this node.
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 -ml-2"
          onClick={() =>
            useUIStore
              .getState()
              .setStartAgentSessionTarget({ serves: `${graphId}#${node.id}` })
          }
        >
          <Play className="size-3.5" aria-hidden="true" />
          Start session for this node…
        </Button>
      </Section>

      <Section title="History">
        {nodeChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="graph-node-history">
            {nodeChanges.map(change => (
              <li key={change.id} className="grid grid-cols-[7rem_1fr] gap-2">
                <span className="text-xs text-muted-foreground">
                  {change.actor.kind === 'user'
                    ? 'You'
                    : change.actor.sessionName}
                  <br />
                  <span title={new Date(change.at).toLocaleString()}>
                    {formatRelativeTime(change.at)}
                  </span>
                </span>
                <span className="text-sm">
                  {change.summary}
                  {change.why && (
                    <span className="block text-xs text-muted-foreground">
                      Why: {change.why}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="p-4">
        <DeleteNodeButton graphId={graphId} node={node} onDeleted={onClose} />
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A text field that saves on blur or Enter, and only when it changed. */
function TitleField({
  value,
  onSave,
}: {
  value: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
  }
  return (
    <input
      aria-label="Node title"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      className="rounded bg-transparent text-lg font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

function DescriptionField({
  value,
  onSave,
}: {
  value: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <Textarea
      aria-label="Description"
      value={draft}
      placeholder="What this node is about"
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft)
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') setDraft(value)
      }}
      className="min-h-20 text-sm"
    />
  )
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  )
}

function PropertiesEditor({
  properties,
  onChange,
}: {
  properties: [string, string][]
  onChange: (properties: [string, string][]) => void
}) {
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const add = () => {
    const key = newKey.trim()
    if (!key) return
    const entry: [string, string] = [key, newValue.trim()]
    // An existing key keeps its place.
    onChange(
      properties.some(([k]) => k === key)
        ? properties.map(p => (p[0] === key ? entry : p))
        : [...properties, entry]
    )
    setNewKey('')
    setNewValue('')
  }

  return (
    <div className="flex flex-col gap-1">
      {properties.map(([key, value], index) => (
        // Keyed by value too: an outside change remounts the uncontrolled
        // input with the new value.
        <div
          key={`${index}:${key}:${value}`}
          className="flex items-center gap-2"
        >
          <span className="w-28 shrink-0 truncate text-sm text-muted-foreground">
            {key}
          </span>
          <Input
            aria-label={`Property ${key}`}
            defaultValue={value}
            className="h-7 flex-1 text-sm"
            onKeyDown={e => {
              if (e.key === 'Escape') e.currentTarget.value = value
            }}
            onBlur={e => {
              const next = e.target.value.trim()
              if (next === value) return
              const updated = properties.map((entry, i): [string, string] =>
                i === index ? [key, next] : entry
              )
              onChange(updated)
            }}
          />
          <RemoveButton
            label={`Remove property ${key}`}
            onClick={() => onChange(properties.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        <Input
          aria-label="New property key"
          placeholder="key"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          className="h-7 w-28 text-sm"
        />
        <Input
          aria-label="New property value"
          placeholder="value"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          className="h-7 flex-1 text-sm"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Add property"
          disabled={!newKey.trim()}
          onClick={add}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}

const OTHER_TARGET = '__other__'

function RelationsEditor({
  node,
  detail,
  onChange,
}: {
  node: GraphNode
  detail: GraphDetail
  onChange: (relations: GraphRelation[]) => void
}) {
  const [kind, setKind] = useState<RelationKind>('depends-on')
  const [target, setTarget] = useState('')
  const [otherText, setOtherText] = useState('')
  const candidates = detail.nodes.filter(n => n.id !== node.id)

  const resolvedTarget = target === OTHER_TARGET ? otherText.trim() : target
  // Free text is only valid for blocked-by; elsewhere a cross-graph ref.
  const valid =
    !!resolvedTarget &&
    (target !== OTHER_TARGET ||
      kind === 'blocked-by' ||
      resolvedTarget.includes('#'))

  const add = () => {
    if (!valid) return
    onChange([...node.relations, { kind, target: resolvedTarget }])
    setTarget('')
    setOtherText('')
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Stored on this node
      </p>
      {node.relations.length === 0 && (
        <p className="text-sm text-muted-foreground">None.</p>
      )}
      {node.relations.map((relation, index) => {
        const resolved = resolveRef(detail, relation.target)
        const local = detail.nodes.find(n => n.id === relation.target)
        return (
          <div
            key={`${relation.kind}-${relation.target}-${index}`}
            className="flex items-center gap-2 text-sm"
            data-testid="graph-relation"
          >
            <span className="w-24 shrink-0 text-muted-foreground">
              {relation.kind}
            </span>
            {local ? (
              <NodeStateGlyph state={local.state} className="size-3.5" />
            ) : resolved.freeText ? (
              <Ban className="size-3.5 shrink-0 text-red-500" />
            ) : null}
            <span className="flex-1 truncate">{resolved.title}</span>
            {resolved.graphTitle && (
              <span className="shrink-0 text-xs text-blue-500">
                ↗ {resolved.graphTitle}
              </span>
            )}
            {resolved.notFound && <NotFound />}
            <RemoveButton
              label={`Remove ${relation.kind} ${resolved.title}`}
              onClick={() =>
                onChange(node.relations.filter((_, i) => i !== index))
              }
            />
          </div>
        )
      })}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Relation kind"
          value={kind}
          onChange={e => setKind(e.target.value as RelationKind)}
          className="h-7 w-32 py-0 text-xs"
        >
          {RELATION_KINDS.map(k => (
            <NativeSelectOption key={k} value={k}>
              {k}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Relation target"
          value={target}
          onChange={e => setTarget(e.target.value)}
          className="h-7 w-44 py-0 text-xs"
        >
          <NativeSelectOption value="">Choose node…</NativeSelectOption>
          {candidates.map(n => (
            <NativeSelectOption key={n.id} value={n.id}>
              {n.title}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={OTHER_TARGET}>
            Other graph or decision…
          </NativeSelectOption>
        </NativeSelect>
        {target === OTHER_TARGET && (
          <Input
            aria-label="Relation target text"
            placeholder={
              kind === 'blocked-by'
                ? 'decision: … or graphId#nodeId'
                : 'graphId#nodeId'
            }
            value={otherText}
            onChange={e => setOtherText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            className="h-7 flex-1 text-sm"
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={!valid}
          onClick={add}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add relation
        </Button>
      </div>
    </div>
  )
}

function IncomingList({
  detail,
  nodeId,
}: {
  detail: GraphDetail
  nodeId: string
}) {
  const incoming = detail.incoming[nodeId] ?? []
  if (incoming.length === 0) return null
  return (
    <div className="mt-3 flex flex-col gap-1" data-testid="graph-incoming">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Computed from other nodes
      </p>
      {incoming.map(relation => {
        const resolved = resolveRef(detail, relation.source)
        return (
          <div
            key={`${relation.kind}-${relation.source}`}
            className="flex items-center gap-2 text-sm"
          >
            <span className="w-24 shrink-0 italic text-muted-foreground">
              {INCOMING_LABELS[relation.kind]}
            </span>
            <span className="flex-1 truncate">{resolved.title}</span>
            {relation.external && (
              <span className="shrink-0 text-xs text-blue-500">
                ↗ {resolved.graphTitle ?? 'other graph'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AttachmentValue({ attachment }: { attachment: GraphAttachment }) {
  const url = attachmentUrl(attachment)
  if (!url) return <span className="flex-1 truncate">{attachment.value}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex-1 truncate text-blue-500 hover:underline"
      onClick={e => {
        if (!isNativeApp()) return
        e.preventDefault()
        void openUrl(url)
      }}
    >
      {attachment.value}
    </a>
  )
}

function AttachmentsEditor({
  attachments,
  onChange,
}: {
  attachments: GraphAttachment[]
  onChange: (attachments: GraphAttachment[]) => void
}) {
  const [kind, setKind] = useState<string>('issue')
  const [value, setValue] = useState('')

  const add = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onChange([...attachments, { kind, value: trimmed }])
    setValue('')
  }

  return (
    <div className="flex flex-col gap-1">
      {attachments.map((attachment, index) => (
        <div
          key={`${attachment.kind}-${attachment.value}-${index}`}
          className="flex items-center gap-2 text-sm"
          data-testid="graph-attachment"
        >
          <span className="w-24 shrink-0 text-muted-foreground">
            {attachment.kind}
          </span>
          <AttachmentValue attachment={attachment} />
          <RemoveButton
            label={`Remove ${attachment.kind} ${attachment.value}`}
            onClick={() => onChange(attachments.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        <NativeSelect
          aria-label="Attachment kind"
          value={kind}
          onChange={e => setKind(e.target.value)}
          className="h-7 w-28 py-0 text-xs"
        >
          {ATTACHMENT_KINDS.map(k => (
            <NativeSelectOption key={k} value={k}>
              {k}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          aria-label="Attachment value"
          placeholder={
            kind === 'issue' || kind === 'pr' ? 'owner/repo#123' : 'value'
          }
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          className="h-7 flex-1 text-sm"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Add attachment"
          disabled={!value.trim()}
          onClick={add}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function DeleteNodeButton({
  graphId,
  node,
  onDeleted,
}: {
  graphId: string
  node: GraphNode
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const deleteNode = useDeleteGraphNode()
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Delete node
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{node.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The node and the relations to it in this graph are removed. The
              change log keeps it, so you can revert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteNode.mutate(
                  { graphId, nodeId: node.id },
                  { onSuccess: onDeleted }
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
