import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { navigateToSession } from '@/lib/navigate-to-session'
import { cn } from '@/lib/utils'
import { useCreateSession } from '@/services/chat'
import { useGraphs } from '@/services/graphs'
import { useProjects, useWorktrees } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { AgentProfile, GraphPermission } from '@/types/graphs'
import { isBaseSession, isFolder } from '@/types/projects'
import {
  capPermission,
  permissionsUpTo,
  PERMISSION_DESCRIPTIONS,
  GRAPH_PERMISSIONS,
  useAgentProfiles,
} from './agent-utils'
import { parseGraphRef } from './graph-utils'
import { ServesPicker } from './ServesPicker'

/**
 * "Start session from agent" (mockup screen 5b), mounted once in
 * `MainWindow` and opened through `ui-store.startAgentSessionTarget`.
 */
export function StartAgentSessionDialog() {
  const target = useUIStore(state => state.startAgentSessionTarget)
  return (
    <Dialog
      open={target !== null}
      onOpenChange={open => {
        if (!open) useUIStore.getState().setStartAgentSessionTarget(null)
      }}
    >
      {target && (
        <StartAgentSessionForm
          initialAgentId={target.agentId}
          initialServes={target.serves}
        />
      )}
    </Dialog>
  )
}

export function StartAgentSessionForm({
  initialAgentId,
  initialServes,
}: {
  initialAgentId?: string
  initialServes?: string
}) {
  const agents = useAgentProfiles()
  const { data: projects } = useProjects()
  const { data: graphs } = useGraphs()
  const createSession = useCreateSession()

  // null = follow the agent (its default serves, its level).
  const [agentId, setAgentId] = useState(initialAgentId ?? '')
  const agent: AgentProfile | undefined =
    agents.find(a => a.id === agentId) ?? agents[0]
  const [servesChoice, setServes] = useState<string | null>(
    initialServes ?? null
  )
  const serves = servesChoice ?? agent?.default_serves ?? ''
  const [permissionChoice, setPermission] = useState<GraphPermission | null>(
    null
  )
  const permission = agent
    ? capPermission(permissionChoice ?? agent.permission, agent.permission)
    : 'read'
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  // The graph's own project first, else the first project.
  const realProjects = useMemo(
    () => (projects ?? []).filter(p => !isFolder(p)),
    [projects]
  )
  const servedGraphId = serves ? parseGraphRef(serves).graphId : null
  const graphProjectId =
    graphs?.find(g => g.id === servedGraphId)?.projectId ?? null
  const [projectId, setProjectId] = useState<string | null>(null)
  const effectiveProjectId =
    projectId ??
    (realProjects.some(p => p.id === graphProjectId) ? graphProjectId : null) ??
    realProjects[0]?.id ??
    null
  const { data: worktrees } = useWorktrees(effectiveProjectId)
  const [worktreeId, setWorktreeId] = useState<string | null>(null)
  const sortedWorktrees = useMemo(
    () =>
      [...(worktrees ?? [])].sort(
        (a, b) => Number(isBaseSession(b)) - Number(isBaseSession(a))
      ),
    [worktrees]
  )
  const worktree =
    sortedWorktrees.find(w => w.id === worktreeId) ?? sortedWorktrees[0]

  // A new agent brings its level and default serves.
  const selectAgent = (id: string) => {
    setAgentId(id)
    setPermission(null)
    if (!initialServes) setServes(null)
  }

  const allowed = agent ? permissionsUpTo(agent.permission) : []

  const start = async () => {
    if (!agent || !worktree) return
    setBusy(true)
    try {
      // One call: the backend applies the agent's name, backend, model,
      // permission and serves (#109).
      const session = await createSession.mutateAsync({
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        agentId: agent.id,
        graphPermission: permission,
        serves: serves ? [serves] : [],
      })
      if (message.trim()) {
        useChatStore.getState().setInputDraft(session.id, message.trim())
      }
      useUIStore.getState().setStartAgentSessionTarget(null)
      navigateToSession({
        projectId: worktree.project_id,
        worktreeId: worktree.id,
        sessionId: session.id,
      })
    } catch {
      // Each mutation already toasted.
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Start session from agent</DialogTitle>
        <DialogDescription>
          A normal session: it shows in the sidebar like any other.
        </DialogDescription>
      </DialogHeader>

      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents yet.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              useUIStore.getState().setStartAgentSessionTarget(null)
              useUIStore.getState().openAgentEditor(null)
            }}
          >
            Create one in Settings → Agents
          </button>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-agent">Agent</Label>
            <NativeSelect
              id="start-agent"
              value={agent?.id ?? ''}
              onChange={e => selectAgent(e.target.value)}
              className="w-full"
            >
              {agents.map(a => (
                <NativeSelectOption key={a.id} value={a.id}>
                  {a.name} ({a.permission})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Where</Label>
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                aria-label="Project"
                value={effectiveProjectId ?? ''}
                onChange={e => {
                  setProjectId(e.target.value)
                  setWorktreeId(null)
                }}
                className="min-w-44"
              >
                {realProjects.map(p => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Worktree"
                value={worktree?.id ?? ''}
                onChange={e => setWorktreeId(e.target.value)}
                className="min-w-44"
              >
                {sortedWorktrees.length === 0 && (
                  <NativeSelectOption value="">
                    No open checkout
                  </NativeSelectOption>
                )}
                {sortedWorktrees.map(w => (
                  <NativeSelectOption key={w.id} value={w.id}>
                    {isBaseSession(w) ? 'base checkout' : w.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Serves</Label>
            <ServesPicker value={serves} onChange={setServes} allowNone />
            <p className="text-xs text-muted-foreground">
              Written as <code>serves</code> in the session&apos;s metadata. The
              graph never lists sessions.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Graph permission for this session</Label>
            <RadioGroup
              value={permission}
              onValueChange={value => setPermission(value as GraphPermission)}
              className="grid grid-cols-3 gap-2"
            >
              {GRAPH_PERMISSIONS.map(level => {
                const disabled = !allowed.includes(level)
                return (
                  <label
                    key={level}
                    title={PERMISSION_DESCRIPTIONS[level]}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                      permission === level && 'border-foreground/60',
                      disabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer'
                    )}
                  >
                    <RadioGroupItem
                      value={level}
                      disabled={disabled}
                      aria-label={level}
                    />
                    {level}
                  </label>
                )
              })}
            </RadioGroup>
            {agent && (
              <p className="text-xs text-muted-foreground">
                The profile allows up to <b>{agent.permission}</b>. You can
                lower it for one session, not raise it.
              </p>
            )}
          </div>

          {agent?.persona && (
            <div className="flex flex-col gap-1.5">
              <Label>Persona prompt</Label>
              <p className="max-h-28 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap">
                {agent.persona}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-agent-message">First message</Label>
            <Textarea
              id="start-agent-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Put into the chat input; you send it."
            />
          </div>
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => useUIStore.getState().setStartAgentSessionTarget(null)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!agent || !worktree || busy}
          onClick={start}
        >
          Start session
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
