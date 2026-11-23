import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Copy, Play, Plus, Trash2 } from 'lucide-react'
import {
  ROLE_COLORS,
  ROLE_TEMPLATES,
  GRAPH_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  profileFromTemplate,
} from '@/components/graphs/role-utils'
import { ServesPicker } from '@/components/graphs/ServesPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { usePatchPreferences, usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'
import type { RoleProfile, GraphPermission } from '@/types/graphs'
import {
  backendOptions,
  codexModelOptions,
  modelOptions,
} from '@/types/preferences'

/** Model choices for a backend, when Splitkick has a list for it. */
function modelChoicesFor(
  backend: string | null
): { value: string; label: string }[] | null {
  if (backend === 'claude') return modelOptions
  if (backend === 'codex') return codexModelOptions
  return null
}

function newProfile(): RoleProfile {
  return {
    id: crypto.randomUUID(),
    name: 'New role',
    color: ROLE_COLORS[0],
    persona: '',
    permission: 'read',
    backend: null,
    model: null,
    default_serves: null,
  }
}

/**
 * Settings → Agents (mockup screen 5c): saved agent profiles
 * (`AppPreferences.role_profiles`). The persona is read when a message is
 * sent, so an edit reaches every session of the agent from its next message.
 */
export function RolesPane() {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const profiles = preferences?.role_profiles ?? []

  // Opened on one agent (agent chip, "Edit agents…"): take it once.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const editingRoleId = useUIStore(state => state.editingRoleId)
  useEffect(() => {
    if (!editingRoleId) return
    setSelectedId(editingRoleId)
    useUIStore.setState({ editingRoleId: null })
  }, [editingRoleId])
  const selected = profiles.find(p => p.id === selectedId) ?? profiles[0]

  const save = (next: RoleProfile[]) =>
    patchPreferences.mutateAsync({ role_profiles: next })

  const add = async (profile: RoleProfile) => {
    await save([...profiles, profile])
    setSelectedId(profile.id)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A role is a session preset: persona, model and permissions. Any number
        of sessions can use it.
      </p>
      <div className="flex min-h-[28rem] gap-4" data-testid="agents-pane">
        <div className="flex w-52 shrink-0 flex-col gap-1">
          {profiles.map(profile => (
            <button
              key={profile.id}
              type="button"
              onClick={() => setSelectedId(profile.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50',
                selected?.id === profile.id && 'bg-accent'
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: profile.color }}
              />
              <span className="min-w-0 flex-1 truncate">{profile.name}</span>
              <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">
                {profile.permission}
              </span>
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => add(newProfile())}
          >
            <Plus className="size-4" aria-hidden="true" />
            New role
          </Button>
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <RoleEditor
              key={selected.id}
              profile={selected}
              saving={patchPreferences.isPending}
              onSave={profile =>
                save(profiles.map(p => (p.id === profile.id ? profile : p)))
              }
              onDuplicate={() =>
                add({
                  ...selected,
                  id: crypto.randomUUID(),
                  name: `${selected.name} copy`,
                })
              }
              onDelete={async () => {
                await save(profiles.filter(p => p.id !== selected.id))
                setSelectedId(null)
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                No roles yet. Start from a template, then change it as you need.
              </p>
              <div
                className="grid gap-2 sm:grid-cols-2"
                data-testid="agent-templates"
              >
                {ROLE_TEMPLATES.map(template => (
                  <button
                    key={template.name}
                    type="button"
                    disabled={patchPreferences.isPending}
                    onClick={() => add(profileFromTemplate(template))}
                    className="flex flex-col gap-1 rounded-md border px-3 py-2 text-left hover:bg-accent/50 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: template.color }}
                      />
                      {template.name}
                      <span className="ml-auto rounded-full border px-1.5 text-[10px] font-normal text-muted-foreground">
                        {template.permission}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {template.summary}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RoleEditor({
  profile,
  saving,
  onSave,
  onDuplicate,
  onDelete,
}: {
  profile: RoleProfile
  saving: boolean
  onSave: (profile: RoleProfile) => Promise<unknown>
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(profile)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = (patch: Partial<RoleProfile>) =>
    setDraft(current => ({ ...current, ...patch }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile)
  const models = modelChoicesFor(draft.backend)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={draft.name}
            onChange={e => update({ name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Colour</Label>
          <div className="flex h-9 items-center gap-1.5">
            {ROLE_COLORS.map(color => (
              <button
                key={color}
                type="button"
                aria-label={`Colour ${color}`}
                aria-pressed={draft.color === color}
                onClick={() => update({ color })}
                className={cn(
                  'size-6 rounded-md',
                  draft.color === color &&
                    'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-persona">
          Persona prompt{' '}
          <span className="font-normal text-muted-foreground">
            added to the system prompt of every session that uses this role
          </span>
        </Label>
        <Textarea
          id="agent-persona"
          rows={6}
          value={draft.persona}
          onChange={e => update({ persona: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          What a session with this role may decide lives here, in words. The
          code enforces only the permission below.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Graph permission</Label>
        <RadioGroup
          value={draft.permission}
          onValueChange={value =>
            update({ permission: value as GraphPermission })
          }
          className="gap-2"
        >
          {GRAPH_PERMISSIONS.map(level => (
            <label
              key={level}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2',
                draft.permission === level && 'border-foreground/60'
              )}
            >
              <RadioGroupItem
                value={level}
                className="mt-0.5"
                aria-label={level}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{level}</span>
                <span className="text-xs text-muted-foreground">
                  {PERMISSION_DESCRIPTIONS[level]}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-backend">Default backend</Label>
          <NativeSelect
            id="agent-backend"
            value={draft.backend ?? ''}
            onChange={e =>
              update({ backend: e.target.value || null, model: null })
            }
            className="w-full"
          >
            <NativeSelectOption value="">Session default</NativeSelectOption>
            {backendOptions.map(option => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent-model">Default model</Label>
          {models ? (
            <NativeSelect
              id="agent-model"
              value={draft.model ?? ''}
              onChange={e => update({ model: e.target.value || null })}
              className="w-full"
            >
              <NativeSelectOption value="">Session default</NativeSelectOption>
              {models.map(option => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id="agent-model"
              placeholder="Session default"
              value={draft.model ?? ''}
              onChange={e => update({ model: e.target.value || null })}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Default serves</Label>
        <ServesPicker
          value={draft.default_serves ?? ''}
          onChange={ref => update({ default_serves: ref || null })}
          allowNone
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          type="button"
          disabled={!dirty || saving || !draft.name.trim()}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
        >
          Save
        </Button>
        <Button type="button" variant="outline" onClick={onDuplicate}>
          <Copy className="size-4" aria-hidden="true" />
          Duplicate
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const ui = useUIStore.getState()
            ui.setPreferencesOpen(false)
            ui.setStartRoleSessionTarget({ roleId: profile.id })
          }}
        >
          <Play className="size-4" aria-hidden="true" />
          Start session…
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Edits reach every session with this role from its next message: the
        persona is read when a message is sent. A session keeps the permission
        it was started with.
      </p>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete role “${profile.name}”?`}
        description="Sessions started from it stay. They lose its persona and badge, and keep the permission they were started with."
        confirmLabel="Delete"
        onConfirm={onDelete}
      />
    </div>
  )
}
