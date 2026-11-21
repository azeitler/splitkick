import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ScheduleDialog,
  type ScheduleFormValues,
} from '@/components/chat/ScheduleDialog'
import { useRoleProfiles } from '@/components/graphs/role-utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { isNativeApp } from '@/lib/environment'
import { formatMessageTimestamp, formatTimeUntil } from '@/lib/relative-time'
import {
  useCreateAgent,
  useMakeSessionAgent,
  useUpdateAgent,
} from '@/services/agents'
import { useProjects } from '@/services/projects'
import { createSchedule, schedulesQueryKeys } from '@/services/schedules'
import { useUIStore, type AgentDialogTarget } from '@/store/ui-store'
import { isFolder, isVisibleProject } from '@/types/projects'
import { defaultAgentFolder } from './agent-rows'

const close = () => useUIStore.getState().setAgentDialog(null)

type AgentFormTarget = Exclude<AgentDialogTarget, { mode: 'schedule' }>
type AgentScheduleTarget = Extract<AgentDialogTarget, { mode: 'schedule' }>

const COPY: Record<
  AgentFormTarget['mode'],
  { title: string; description: string; submit: string }
> = {
  new: {
    title: 'New agent',
    description:
      'An agent is one named session in a role. It exists once, and other sessions can send it work by name.',
    submit: 'Create agent',
  },
  make: {
    title: 'Make agent',
    description:
      'This session becomes an agent: it gets a name that other sessions can send work to.',
    submit: 'Make agent',
  },
  rename: {
    title: 'Rename agent',
    description: 'Other sessions find the agent by this name.',
    submit: 'Rename',
  },
}

/**
 * The agent dialog, mounted once in `MainWindow` and opened through
 * `ui-store.agentDialog`: create an agent, make a session an agent, rename
 * one, or schedule a prompt for one.
 */
export function AgentDialog() {
  const target = useUIStore(state => state.agentDialog)
  if (target?.mode === 'schedule') return <AgentSchedule target={target} />
  return (
    <Dialog
      open={target !== null}
      onOpenChange={open => {
        if (!open) close()
      }}
    >
      {target && <AgentForm target={target} />}
    </Dialog>
  )
}

/**
 * "New Schedule…" on an agent: a repeating prompt that belongs to the agent,
 * so it follows the agent into a fresh session after a restart.
 */
function AgentSchedule({ target }: { target: AgentScheduleTarget }) {
  const queryClient = useQueryClient()
  const onSubmit = async (values: ScheduleFormValues) => {
    const schedule = await createSchedule({
      sessionId: target.sessionId,
      prompt: values.prompt,
      fireAtUnix: values.fireAtUnix,
      recurrence: values.recurrence,
      name: values.name || undefined,
      target: 'agent',
    })
    await queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all })
    toast.success(
      `Scheduled for ${target.name} · ${formatTimeUntil(schedule.fire_at_unix)} (${formatMessageTimestamp(schedule.fire_at_unix)})`
    )
  }
  return (
    <ScheduleDialog
      open
      onOpenChange={open => {
        if (!open) close()
      }}
      kind="repeat"
      initial={{ prompt: '', target: 'agent' }}
      title={`New schedule for ${target.name}`}
      onSubmit={onSubmit}
    />
  )
}

function AgentForm({ target }: { target: AgentFormTarget }) {
  const copy = COPY[target.mode]
  const createAgent = useCreateAgent()
  const makeAgent = useMakeSessionAgent()
  const updateAgent = useUpdateAgent()
  const roles = useRoleProfiles()
  const { data: allProjects } = useProjects()
  const projects = useMemo(
    () => (allProjects ?? []).filter(p => !isFolder(p) && isVisibleProject(p)),
    [allProjects]
  )

  const [name, setName] = useState(
    target.mode === 'make'
      ? target.sessionName
      : target.mode === 'rename'
        ? target.name
        : ''
  )
  // 'project' means "this project" for a session, a picked one for a new agent.
  const [scope, setScope] = useState<'global' | 'project'>(
    target.mode === 'make' ? 'project' : 'global'
  )
  const [projectChoice, setProjectChoice] = useState<string | null>(null)
  const projectId = projectChoice ?? projects[0]?.id ?? ''
  const [roleId, setRoleId] = useState('')
  const [folder, setFolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()
  const needsProject = target.mode === 'new' && scope === 'project'
  const canSubmit = trimmed !== '' && !busy && (!needsProject || !!projectId)

  const browse = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select the folder the agent works in',
    })
    if (typeof selected === 'string') setFolder(selected)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (target.mode === 'make') {
        await makeAgent.mutateAsync({
          sessionId: target.sessionId,
          name: trimmed,
          global: scope === 'global',
        })
      } else if (target.mode === 'rename') {
        await updateAgent.mutateAsync({
          agentId: target.agentId,
          name: trimmed,
        })
      } else {
        await createAgent.mutateAsync({
          name: trimmed,
          ...(scope === 'project' ? { projectId } : {}),
          ...(roleId ? { roleId } : {}),
          ...(scope === 'global' && folder.trim()
            ? { folder: folder.trim() }
            : {}),
        })
      }
      close()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-dialog-name">Name</Label>
          <Input
            id="agent-dialog-name"
            value={name}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'agent-dialog-error' : undefined}
            onChange={e => {
              setName(e.target.value)
              setError(null)
            }}
          />
          {error && (
            <p
              id="agent-dialog-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        {target.mode !== 'rename' && (
          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <RadioGroup
              value={scope}
              onValueChange={value => {
                setScope(value === 'project' ? 'project' : 'global')
                setError(null)
              }}
              className="flex flex-col gap-1.5"
            >
              <ScopeChoice
                value="global"
                label="Global"
                hint="One in the whole app."
              />
              <ScopeChoice
                value="project"
                label={target.mode === 'make' ? 'This project' : 'Project'}
                hint="One per project."
              />
            </RadioGroup>
          </div>
        )}

        {target.mode === 'new' && scope === 'project' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-dialog-project">Project</Label>
            <NativeSelect
              id="agent-dialog-project"
              value={projectId}
              onChange={e => setProjectChoice(e.target.value)}
              className="w-full"
            >
              {projects.map(project => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              The agent runs in the base workspace of the project.
            </p>
          </div>
        )}

        {target.mode === 'new' && scope === 'global' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-dialog-folder">Folder</Label>
            <div className="flex gap-2">
              <Input
                id="agent-dialog-folder"
                value={folder}
                placeholder={defaultAgentFolder(trimmed || 'agent')}
                onChange={e => setFolder(e.target.value)}
              />
              {isNativeApp() && (
                <Button type="button" variant="outline" onClick={browse}>
                  Browse
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The agent works in this folder, for example your notes. Empty uses
              the folder shown. The agent shows in the Agents tab only.
            </p>
          </div>
        )}

        {target.mode === 'new' && roles.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-dialog-role">Role</Label>
            <NativeSelect
              id="agent-dialog-role"
              value={roleId}
              onChange={e => setRoleId(e.target.value)}
              className="w-full"
            >
              <NativeSelectOption value="">No role</NativeSelectOption>
              {roles.map(role => (
                <NativeSelectOption key={role.id} value={role.id}>
                  {role.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              A role is a session preset: persona, model and permissions.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {copy.submit}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function ScopeChoice({
  value,
  label,
  hint,
}: {
  value: 'global' | 'project'
  label: string
  hint: string
}) {
  const id = `agent-dialog-scope-${value}`
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="font-normal">
        {label} <span className="text-xs text-muted-foreground">{hint}</span>
      </Label>
    </div>
  )
}
