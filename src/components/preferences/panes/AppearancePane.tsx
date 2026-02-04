import React, { useCallback, useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTheme } from '@/hooks/use-theme'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  uiFontOptions,
  chatFontOptions,
  syntaxThemeDarkOptions,
  syntaxThemeLightOptions,
  fileEditModeOptions,
  FONT_SIZE_DEFAULT,
  type UIFont,
  type ChatFont,
  type SyntaxTheme,
  type FileEditMode,
} from '@/types/preferences'

// Helper to get valid font size, handling legacy string values or invalid numbers
function getValidFontSize(value: unknown): number {
  if (typeof value === 'number' && !isNaN(value) && value > 0) {
    return value
  }
  return FONT_SIZE_DEFAULT
}

// Font size input that only saves on blur to allow editing
const FontSizeInput: React.FC<{
  value: unknown
  onChange: (value: number) => void
  disabled?: boolean
}> = ({ value, onChange, disabled }) => {
  const validValue = getValidFontSize(value)
  const [localValue, setLocalValue] = useState(String(validValue))

  // Sync local state when external value changes
  useEffect(() => {
    setLocalValue(String(validValue))
  }, [validValue])

  const handleBlur = () => {
    const parsed = parseInt(localValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      onChange(parsed)
    } else {
      // Reset to valid value if invalid
      setLocalValue(String(validValue))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="w-20 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
      />
      <span className="text-sm text-muted-foreground">px</span>
    </div>
  )
}

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
  description?: string
  children: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="flex items-center gap-4">
    <div className="w-96 shrink-0 space-y-0.5">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
    {children}
  </div>
)

export const AppearancePane: React.FC = () => {
  const { theme, setTheme } = useTheme()
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  const handleThemeChange = useCallback(
    async (value: 'light' | 'dark' | 'system') => {
      // Update the theme provider immediately for instant UI feedback
      setTheme(value)

      // Persist the theme preference to disk
      if (preferences) {
        savePreferences.mutate({ ...preferences, theme: value })
      }
    },
    [setTheme, savePreferences, preferences]
  )

  const handleFontSizeChange = useCallback(
    (field: 'ui_font_size' | 'chat_font_size', value: number) => {
      if (preferences && !isNaN(value) && value > 0) {
        savePreferences.mutate({ ...preferences, [field]: value })
      }
    },
    [savePreferences, preferences]
  )

  const handleFontChange = useCallback(
    (field: 'ui_font' | 'chat_font', value: UIFont | ChatFont) => {
      if (preferences) {
        savePreferences.mutate({ ...preferences, [field]: value })
      }
    },
    [savePreferences, preferences]
  )

  const handleSessionGroupingChange = useCallback(
    (checked: boolean) => {
      if (preferences) {
        savePreferences.mutate({
          ...preferences,
          session_grouping_enabled: checked,
        })
      }
    },
    [savePreferences, preferences]
  )

  const handleCanvasEnabledChange = useCallback(
    (checked: boolean) => {
      if (preferences) {
        savePreferences.mutate({
          ...preferences,
          canvas_enabled: checked,
          // If disabling canvas, also disable canvas-only mode
          canvas_only_mode: checked ? preferences.canvas_only_mode : false,
        })
      }
    },
    [savePreferences, preferences]
  )

  const handleCanvasOnlyChange = useCallback(
    (checked: boolean) => {
      if (preferences) {
        savePreferences.mutate({
          ...preferences,
          canvas_only_mode: checked,
        })
      }
    },
    [savePreferences, preferences]
  )

  const handleKeybindingHintsChange = useCallback(
    (checked: boolean) => {
      if (preferences) {
        savePreferences.mutate({
          ...preferences,
          show_keybinding_hints: checked,
        })
      }
    },
    [savePreferences, preferences]
  )

  const handleSyntaxThemeChange = useCallback(
    (field: 'syntax_theme_dark' | 'syntax_theme_light', value: SyntaxTheme) => {
      if (preferences) {
        savePreferences.mutate({ ...preferences, [field]: value })
      }
    },
    [savePreferences, preferences]
  )

  const handleFileEditModeChange = useCallback(
    (value: FileEditMode) => {
      if (preferences) {
        savePreferences.mutate({ ...preferences, file_edit_mode: value })
      }
    },
    [savePreferences, preferences]
  )

  return (
    <div className="space-y-6">
      <SettingsSection title="Theme">
        <div className="space-y-4">
          <InlineField
            label="Color theme"
            description="Choose your preferred color scheme"
          >
            <Select
              value={theme}
              onValueChange={handleThemeChange}
              disabled={savePreferences.isPending}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Syntax theme (dark)"
            description="Highlighting theme for code in dark mode"
          >
            <Select
              value={preferences?.syntax_theme_dark ?? 'vitesse-black'}
              onValueChange={value =>
                handleSyntaxThemeChange(
                  'syntax_theme_dark',
                  value as SyntaxTheme
                )
              }
              disabled={savePreferences.isPending}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                {syntaxThemeDarkOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Syntax theme (light)"
            description="Highlighting theme for code in light mode"
          >
            <Select
              value={preferences?.syntax_theme_light ?? 'github-light'}
              onValueChange={value =>
                handleSyntaxThemeChange(
                  'syntax_theme_light',
                  value as SyntaxTheme
                )
              }
              disabled={savePreferences.isPending}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                {syntaxThemeLightOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Fonts">
        <div className="space-y-4">
          <InlineField label="UI font" description="Font for interface text">
            <Select
              value={preferences?.ui_font ?? 'inter'}
              onValueChange={value =>
                handleFontChange('ui_font', value as UIFont)
              }
              disabled={savePreferences.isPending}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                {uiFontOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField label="Chat font" description="Font for chat messages">
            <Select
              value={preferences?.chat_font ?? 'jetbrains-mono'}
              onValueChange={value =>
                handleFontChange('chat_font', value as ChatFont)
              }
              disabled={savePreferences.isPending}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                {chatFontOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField label="UI text size" description="Size in pixels">
            <FontSizeInput
              value={preferences?.ui_font_size}
              onChange={value => handleFontSizeChange('ui_font_size', value)}
              disabled={savePreferences.isPending}
            />
          </InlineField>

          <InlineField label="Chat text size" description="Size in pixels">
            <FontSizeInput
              value={preferences?.chat_font_size}
              onChange={value => handleFontSizeChange('chat_font_size', value)}
              disabled={savePreferences.isPending}
            />
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Layout">
        <div className="space-y-4">
          <InlineField
            label="Group sessions by status"
            description="Group session tabs into dropdowns when you have many sessions"
          >
            <Switch
              checked={preferences?.session_grouping_enabled ?? true}
              onCheckedChange={handleSessionGroupingChange}
              disabled={savePreferences.isPending}
            />
          </InlineField>

          <InlineField
            label="Canvas view"
            description="Show the canvas tab for session overview"
          >
            <Switch
              checked={preferences?.canvas_enabled ?? true}
              onCheckedChange={handleCanvasEnabledChange}
              disabled={savePreferences.isPending}
            />
          </InlineField>

          <InlineField
            label="Canvas only mode"
            description="Always show canvas view, hide session tabs"
          >
            <Switch
              checked={preferences?.canvas_only_mode ?? false}
              onCheckedChange={handleCanvasOnlyChange}
              disabled={
                savePreferences.isPending || !preferences?.canvas_enabled
              }
            />
          </InlineField>

          <InlineField
            label="Keybinding hints"
            description="Show keyboard shortcuts at the bottom of canvas views"
          >
            <Switch
              checked={preferences?.show_keybinding_hints ?? true}
              onCheckedChange={handleKeybindingHintsChange}
              disabled={savePreferences.isPending}
            />
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="File Viewer">
        <div className="space-y-4">
          <InlineField
            label="Edit files in"
            description="How to edit files when viewing them in Jean"
          >
            <Select
              value={preferences?.file_edit_mode ?? 'external'}
              onValueChange={value =>
                handleFileEditModeChange(value as FileEditMode)
              }
              disabled={savePreferences.isPending}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                {fileEditModeOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>
        </div>
      </SettingsSection>
    </div>
  )
}
