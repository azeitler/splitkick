import React from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import { SettingsSection } from '../SettingsSection'
import { BrowserForAgentsSection } from './BrowserForAgentsSection'

/**
 * Settings → Web Browser: every way an agent can drive a browser.
 * "Browser for agents" (#104) works for all CLIs; "Claude in Chrome" adds
 * `--chrome` to Claude runs only and is off by default.
 */
export const WebBrowserPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()

  return (
    <div className="space-y-6">
      <BrowserForAgentsSection />
      <SettingsSection
        title="Claude in Chrome"
        anchorId="pref-web-browser-section-claude-chrome"
      >
        <div className="flex items-start justify-between gap-4 rounded-md border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="claude-chrome-switch" className="text-sm">
              Chrome browser integration
            </Label>
            <p className="text-xs text-muted-foreground">
              Adds --chrome to Claude runs. It uses Anthropic&apos;s Claude in
              Chrome extension (beta). Only Claude uses it.
            </p>
            <p
              className="text-xs text-muted-foreground"
              data-testid="claude-chrome-hint"
            >
              Recommended instead: Browser for agents above. It works for every
              CLI.
            </p>
          </div>
          <Switch
            id="claude-chrome-switch"
            checked={preferences?.chrome_enabled ?? false}
            disabled={!preferences}
            onCheckedChange={checked =>
              patchPreferences.mutate({ chrome_enabled: checked })
            }
          />
        </div>
      </SettingsSection>
    </div>
  )
}
