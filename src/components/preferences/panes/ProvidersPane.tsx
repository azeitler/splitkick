import React, { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  type CustomCliProfile,
  PREDEFINED_CLI_PROFILES,
} from '@/types/preferences'

const SettingsSection: React.FC<{
  title: string
  description?: string
  children: React.ReactNode
}> = ({ title, description, children }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <Separator className="mt-2" />
    </div>
    {children}
  </div>
)

export const ProvidersPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  const profiles = preferences?.custom_cli_profiles ?? []

  const handleSaveProfiles = (updated: CustomCliProfile[]) => {
    if (preferences) {
      savePreferences.mutate({
        ...preferences,
        custom_cli_profiles: updated,
      })
    }
  }

  const defaultProvider = preferences?.default_provider ?? null

  const handleDefaultProviderChange = (value: string) => {
    if (preferences) {
      savePreferences.mutate({
        ...preferences,
        default_provider: value === 'default' ? null : value,
      })
    }
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Claude CLI"
        description="Custom settings profiles for the Claude CLI. Each profile can override the API endpoint, authentication, and model routing."
      >
        <CliProfilesEditor profiles={profiles} onSave={handleSaveProfiles} />

        {profiles.length > 0 && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Default Provider</p>
              <p className="text-xs text-muted-foreground">
                Provider used for new sessions
              </p>
            </div>
            <Select
              value={defaultProvider ?? 'default'}
              onValueChange={handleDefaultProviderChange}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                {profiles.map(p => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

/** CLI Profiles editor */
const CliProfilesEditor: React.FC<{
  profiles: CustomCliProfile[]
  onSave: (profiles: CustomCliProfile[]) => void
}> = ({ profiles, onSave }) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editName, setEditName] = useState('')
  const [editJson, setEditJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const existingNames = new Set(profiles.map(p => p.name))
  const availableTemplates = PREDEFINED_CLI_PROFILES.filter(
    t => !existingNames.has(t.name)
  )

  const validateAndSave = () => {
    const name = editName.trim()
    if (!name) {
      setJsonError('Name is required')
      return
    }
    try {
      JSON.parse(editJson)
    } catch {
      setJsonError('Invalid JSON')
      return
    }
    setJsonError(null)

    const newProfile: CustomCliProfile = { name, settings_json: editJson }
    if (editingIndex !== null) {
      const updated = [...profiles]
      updated[editingIndex] = newProfile
      onSave(updated)
      setEditingIndex(null)
    } else {
      onSave([...profiles, newProfile])
      setIsAdding(false)
    }
    setEditName('')
    setEditJson('')
  }

  const startEdit = (index: number) => {
    const profile = profiles[index]
    if (!profile) return
    setEditingIndex(index)
    setEditName(profile.name)
    setEditJson(profile.settings_json)
    setJsonError(null)
    setIsAdding(false)
  }

  const startAdd = (template?: CustomCliProfile) => {
    setIsAdding(true)
    setEditName(template?.name ?? '')
    setEditJson(template?.settings_json ?? '{\n  "env": {\n    \n  }\n}')
    setJsonError(null)
    setEditingIndex(null)
  }

  const cancelEdit = () => {
    setEditingIndex(null)
    setIsAdding(false)
    setEditName('')
    setEditJson('')
    setJsonError(null)
  }

  const deleteProfile = (index: number) => {
    onSave(profiles.filter((_, i) => i !== index))
    if (editingIndex === index) cancelEdit()
  }

  return (
    <div className="space-y-3">
      {/* Existing profiles */}
      {profiles.map((profile, index) => (
        <div
          key={profile.name}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
        >
          <span className="flex-1 text-sm font-medium">{profile.name}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => startEdit(index)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => deleteProfile(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {/* Edit/Add form */}
      {(isAdding || editingIndex !== null) && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Input
            placeholder="Profile name"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            className="h-8"
          />
          <Textarea
            placeholder='{"env": {"ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "..."}}'
            value={editJson}
            onChange={e => {
              setEditJson(e.target.value)
              setJsonError(null)
            }}
            className="min-h-[120px] font-mono text-xs"
          />
          {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={validateAndSave}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Add buttons */}
      {!isAdding && editingIndex === null && (
        <div className="flex flex-wrap gap-2">
          {availableTemplates.map(template => (
            <Button
              key={template.name}
              variant="outline"
              size="sm"
              onClick={() => startAdd(template)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {template.name}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => startAdd()}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Custom
          </Button>
        </div>
      )}
    </div>
  )
}
