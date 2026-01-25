import React from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { modelOptions, type ClaudeModel } from '@/types/preferences'

const SettingsSection: React.FC<{
  title: string
  children: React.ReactNode
}> = ({ title, children }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <Separator className="mt-2" />
    </div>
    {children}
  </div>
)

const InlineField: React.FC<{
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="flex items-center gap-4">
    <div className="w-96 shrink-0 space-y-0.5">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </div>
    {children}
  </div>
)

export const ExperimentalPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
        <p className="text-sm text-muted-foreground">
          These features are experimental and may change or be removed in future
          versions. Use at your own risk.
        </p>
      </div>

      <SettingsSection title="AI Behavior">
        <div className="space-y-4">
          <InlineField
            label="Parallel execution prompting"
            description="Add system prompt encouraging sub-agent parallelization for faster task execution"
          >
            <Switch
              checked={preferences?.parallel_execution_prompt_enabled ?? false}
              onCheckedChange={checked => {
                if (preferences) {
                  savePreferences.mutate({
                    ...preferences,
                    parallel_execution_prompt_enabled: checked,
                  })
                }
              }}
            />
          </InlineField>

          <InlineField
            label="Session recap"
            description="Show AI-generated summary when returning to unfocused sessions"
          >
            <Switch
              checked={preferences?.session_recap_enabled ?? false}
              onCheckedChange={checked => {
                if (preferences) {
                  savePreferences.mutate({
                    ...preferences,
                    session_recap_enabled: checked,
                  })
                }
              }}
            />
          </InlineField>

          {preferences?.session_recap_enabled && (
            <InlineField
              label="Recap model"
              description="Claude model for generating session summaries"
            >
              <Select
                value={preferences?.session_recap_model ?? 'haiku'}
                onValueChange={(value: ClaudeModel) => {
                  if (preferences) {
                    savePreferences.mutate({
                      ...preferences,
                      session_recap_model: value,
                    })
                  }
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
          )}
        </div>
      </SettingsSection>
    </div>
  )
}
