import { useState, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatRelativeTime, toMilliseconds } from '@/lib/relative-time'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import {
  cancelSessionBackup,
  formatBytes,
  runSessionBackupNow,
  useSessionBackupProgress,
  useSessionBackupStatus,
} from '@/services/session-backup'
import { SettingsSection } from '../SettingsSection'
import { BackupProgressBar, SetupBackupDialog } from '../SetupBackupDialog'

const InlineField: FC<{
  label: string
  description?: ReactNode
  children: ReactNode
}> = ({ label, description, children }) => (
  <div className="settings-inline-field flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
    <div className="space-y-0.5 sm:w-56 sm:shrink-0 lg:w-72">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <div className="text-xs text-muted-foreground break-words">
          {description}
        </div>
      )}
    </div>
    {children}
  </div>
)

/** "4m ago (29.10.2026, 14:02)" */
function timeAgoWithDate(timestamp: number): string {
  return `${formatRelativeTime(timestamp)} (${new Date(
    toMilliseconds(timestamp)
  ).toLocaleString()})`
}

/**
 * Settings → General: the shared session backup. Off, it offers "Setup
 * Backup"; on, it shows the status, other devices and the per-device options.
 */
export const SessionBackupSection: FC = () => {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const { data: status } = useSessionBackupStatus()
  const progress = useSessionBackupProgress()
  const [setupOpen, setSetupOpen] = useState(false)
  const [deviceName, setDeviceName] = useState<string | null>(null)

  if (!preferences) return null
  const enabled = !!preferences.session_backup_dir
  const running =
    progress != null &&
    ['scanning', 'copying', 'digest'].includes(progress.phase)

  const handleBackupNow = () => {
    runSessionBackupNow().catch(error =>
      toast.error(`Could not start the backup: ${error}`)
    )
  }

  const saveDeviceName = () => {
    if (deviceName == null) return
    patchPreferences.mutate({
      session_backup_device_name: deviceName.trim() || null,
    })
    setDeviceName(null)
  }

  return (
    <SettingsSection
      title="Session backup"
      anchorId="pref-general-section-session-backup"
      description="Back up all sessions into a synced folder, and search the sessions of your other devices."
    >
      {!enabled ? (
        <InlineField
          label="Shared folder"
          description="Off. Pick a folder that iCloud Drive, Syncthing, Nextcloud or Dropbox keeps in step across your devices."
        >
          <Button onClick={() => setSetupOpen(true)}>Setup Backup</Button>
        </InlineField>
      ) : (
        <div className="space-y-4">
          <InlineField
            label="Shared folder"
            description={
              <span className="font-mono text-xs break-all">
                {preferences.session_backup_dir}
              </span>
            }
          >
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSetupOpen(true)}>
                Change
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  cancelSessionBackup().catch(() => undefined)
                  patchPreferences.mutate({ session_backup_dir: null })
                }}
              >
                Turn off
              </Button>
            </div>
          </InlineField>

          <InlineField
            label="Device name"
            description="Other devices show this name next to sessions from here."
          >
            <Input
              className="w-56"
              value={deviceName ?? status?.device_name ?? ''}
              onChange={event => setDeviceName(event.target.value)}
              onBlur={saveDeviceName}
              onKeyDown={event => {
                if (event.key === 'Enter') saveDeviceName()
              }}
            />
          </InlineField>

          <InlineField
            label="Search other devices"
            description="Show sessions from the other devices' backups in ⌘K → Other devices and in the MCP search tool. Info only: they open on their own device."
          >
            <Switch
              checked={preferences.session_backup_search_remote}
              onCheckedChange={checked =>
                patchPreferences.mutate({
                  session_backup_search_remote: checked,
                })
              }
            />
          </InlineField>

          <InlineField
            label="Status"
            description={
              status?.last_error
                ? `Last backup failed: ${status.last_error}`
                : status?.last_sync_at
                  ? `Last backup ${timeAgoWithDate(status.last_sync_at)} · ${status.files_copied.toLocaleString()} files (${formatBytes(status.bytes_copied)}) copied in ${(status.duration_ms / 1000).toFixed(1)} s`
                  : 'No backup yet since the app started. Runs every 10 minutes and after each run.'
            }
          >
            {running ? (
              <Button variant="outline" onClick={() => cancelSessionBackup()}>
                Stop
              </Button>
            ) : (
              <Button variant="outline" onClick={handleBackupNow}>
                Back up now
              </Button>
            )}
          </InlineField>
          {running && progress && <BackupProgressBar progress={progress} />}

          <div className="space-y-1 text-sm">
            <p className="font-medium">Other devices</p>
            {status?.other_instances.length ? (
              <ul className="space-y-0.5 text-muted-foreground">
                {status.other_instances.map(instance => (
                  <li key={instance.instance_id}>
                    {instance.device_name} — last backup{' '}
                    {timeAgoWithDate(instance.last_sync_at)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                None yet. Set up the backup with the same folder on your other
                devices.
              </p>
            )}
          </div>
        </div>
      )}
      <SetupBackupDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </SettingsSection>
  )
}
