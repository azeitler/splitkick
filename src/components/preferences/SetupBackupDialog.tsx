import { useEffect, useRef, useState, type FC } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DirectoryBrowser } from '@/components/projects/DirectoryBrowser'
import { isLocalBackend } from '@/lib/environment'
import { usePatchPreferences } from '@/services/preferences'
import {
  cancelSessionBackup,
  estimateSessionBackup,
  formatBytes,
  getDefaultDeviceName,
  progressPercent,
  runSessionBackupNow,
  useSessionBackupProgress,
  useSessionBackupStatus,
  type SessionBackupEstimate,
  type SessionBackupProgress,
} from '@/services/session-backup'

const PHASE_LABEL: Record<SessionBackupProgress['phase'], string> = {
  scanning: 'Looking for changes…',
  copying: 'Copying',
  digest: 'Building search index…',
  done: 'Done',
  cancelled: 'Stopped',
  failed: 'Failed',
}

export const BackupProgressBar: FC<{ progress: SessionBackupProgress }> = ({
  progress,
}) => {
  const percent = progressPercent(progress)
  return (
    <div className="space-y-1.5">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {PHASE_LABEL[progress.phase]}
        {progress.phase === 'copying' &&
          ` ${progress.files_done.toLocaleString()} / ${progress.files_total.toLocaleString()} files · ${formatBytes(progress.bytes_done)} / ${formatBytes(progress.bytes_total)} · ${percent}%`}
        {progress.phase === 'digest' &&
          ` ${progress.files_done.toLocaleString()} / ${progress.files_total.toLocaleString()} sessions`}
      </p>
    </div>
  )
}

type Step = 'choose' | 'running' | 'done'

/**
 * First-time setup of the shared session backup: pick a synced folder, name
 * this device, then run the initial backup with a progress bar. The folder is
 * saved when the backup starts, so a cancelled first run resumes in the
 * background (unchanged files are skipped).
 */
export const SetupBackupDialog: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
}> = ({ open, onOpenChange }) => {
  const patchPreferences = usePatchPreferences()
  const progress = useSessionBackupProgress()
  const { data: status } = useSessionBackupStatus()
  const [step, setStep] = useState<Step>('choose')
  const [dir, setDir] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [estimate, setEstimate] = useState<SessionBackupEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const startedAt = useRef(0)
  // The progress hook keeps the last event of any earlier run. Finish only
  // after this run (or the background run it joined) reported progress.
  const [sawActiveRun, setSawActiveRun] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep('choose')
    setDir('')
    setEstimate(null)
    getDefaultDeviceName()
      .then(setDeviceName)
      .catch(() => setDeviceName(''))
  }, [open])

  useEffect(() => {
    if (step !== 'running' || !progress) return
    if (['scanning', 'copying', 'digest'].includes(progress.phase)) {
      setSawActiveRun(true)
      return
    }
    if (!sawActiveRun) return
    if (progress.phase === 'done' || progress.phase === 'cancelled') {
      setStep('done')
    } else if (progress.phase === 'failed') {
      toast.error(`Backup failed: ${progress.current ?? 'unknown error'}`)
      setStep('choose')
    }
  }, [step, progress, sawActiveRun])

  const handleBrowse = async () => {
    // A remote backend backs up its own disk, so browse the server's folders;
    // the native picker only sees this machine.
    if (!isLocalBackend()) {
      setBrowserOpen(true)
      return
    }
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select a synced folder for the session backup',
    })
    if (typeof selected === 'string') await chooseDir(selected)
  }

  const chooseDir = async (selected: string) => {
    setDir(selected)
    setEstimate(null)
    setEstimating(true)
    try {
      setEstimate(await estimateSessionBackup(selected))
    } catch (error) {
      toast.error(`Could not read the folder: ${error}`)
    } finally {
      setEstimating(false)
    }
  }

  const handleStart = async () => {
    try {
      await patchPreferences.mutateAsync({
        session_backup_dir: dir,
        session_backup_device_name: deviceName.trim() || null,
      })
      startedAt.current = Date.now()
      setSawActiveRun(false)
      setStep('running')
      await runSessionBackupNow()
    } catch (error) {
      toast.error(`Could not start the backup: ${error}`)
      setStep('choose')
    }
  }

  const notEnoughSpace =
    estimate?.free_bytes != null && estimate.free_bytes < estimate.bytes_needed

  const timeLeft = (() => {
    if (!progress || progress.phase !== 'copying') return null
    const percent = progressPercent(progress)
    if (percent < 2) return null
    const elapsed = Date.now() - startedAt.current
    const seconds = Math.round((elapsed * (100 - percent)) / percent / 1000)
    return seconds < 60
      ? `about ${seconds} s left`
      : `about ${Math.round(seconds / 60)} min left`
  })()

  return (
    // The first backup is modal: no close button, Escape or outside click
    // until it is done or stopped. The open dialog also blocks the app's
    // keyboard shortcuts (useMainWindowEventListeners).
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && step === 'running') return
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={step !== 'running'}
        // Also stops ⌘K from opening the palette on top (CommandPalette).
        data-blocking-dialog={step === 'running' ? '' : undefined}
      >
        <DialogHeader>
          <DialogTitle>Setup Backup</DialogTitle>
          <DialogDescription>
            Back up all sessions into a folder that a sync service keeps in step
            across your devices (iCloud Drive, Syncthing, Nextcloud, Dropbox).
            Each device writes only its own subfolder, and every device can then
            search the sessions of the others.
          </DialogDescription>
        </DialogHeader>

        {step === 'choose' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Shared folder</Label>
              <div className="flex gap-2">
                <Input
                  value={dir}
                  readOnly
                  placeholder="No folder selected"
                  className="font-mono text-xs"
                />
                <Button variant="outline" onClick={handleBrowse}>
                  <FolderOpen className="size-4" />
                  Browse
                </Button>
              </div>
              {estimating && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Measuring…
                </p>
              )}
              {estimate && (
                <p
                  className={
                    notEnoughSpace
                      ? 'text-xs text-destructive'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  First backup: {formatBytes(estimate.bytes_needed)} in{' '}
                  {estimate.files.toLocaleString()} files
                  {estimate.free_bytes != null &&
                    ` · ${formatBytes(estimate.free_bytes)} free`}
                  {notEnoughSpace && ' — not enough space'}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-device-name">Device name</Label>
              <Input
                id="backup-device-name"
                value={deviceName}
                onChange={event => setDeviceName(event.target.value)}
                placeholder="This Mac"
              />
              <p className="text-xs text-muted-foreground">
                Other devices show this name next to sessions from here.
              </p>
            </div>
          </div>
        )}

        {step === 'running' && (
          <div className="space-y-2">
            {progress && sawActiveRun ? (
              <BackupProgressBar progress={progress} />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Starting…
              </p>
            )}
            {timeLeft && (
              <p className="text-xs text-muted-foreground">{timeLeft}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Wait until the first backup is done. Stop keeps the files copied
              so far; the next backup continues from there.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-2 text-sm">
            <p>
              {progress?.phase === 'cancelled'
                ? 'Backup stopped. It continues on the next background run (every 10 minutes); copied files are not copied again.'
                : 'Backup complete. New and changed sessions are backed up every 10 minutes and after each run.'}
            </p>
            <p className="text-muted-foreground">
              {status?.other_instances.length
                ? `Other devices in this folder: ${status.other_instances
                    .map(instance => instance.device_name)
                    .join(', ')}.`
                : 'No other devices in this folder yet. Set up the backup with the same folder on your other devices.'}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'choose' && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleStart}
                disabled={!dir || estimating || notEnoughSpace}
              >
                Start backup
              </Button>
            </>
          )}
          {step === 'running' && (
            <Button
              variant="outline"
              onClick={() => {
                cancelSessionBackup().catch(error =>
                  toast.error(`Could not stop the backup: ${error}`)
                )
              }}
            >
              Stop
            </Button>
          )}
          {step === 'done' && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
      <DirectoryBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={path => void chooseDir(path)}
        mode="select"
        title="Select a synced folder"
        description="The session backup goes into this folder on the server."
      />
    </Dialog>
  )
}
