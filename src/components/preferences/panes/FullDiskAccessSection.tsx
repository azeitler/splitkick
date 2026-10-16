import { useEffect, useState, type FC } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PRODUCT_NAME } from '@/lib/build-info'
import {
  getFullDiskAccessStatus,
  openFullDiskAccessSettings,
  relaunchForFullDiskAccess,
  type FullDiskAccessStatus,
} from '@/services/full-disk-access'
import { SettingsSection } from '../SettingsSection'

/**
 * Settings → General opt-in for macOS Full Disk Access (issue #31).
 *
 * Opt-in only, never asked in onboarding: the grant is large, and the
 * recommended default is not to grant it. The risk text comes before the
 * buttons. The status cannot turn green while the app runs (TCC state is
 * fixed at launch), so "Relaunch now" is never gated on the probe.
 */
export const FullDiskAccessSection: FC = () => {
  const [status, setStatus] = useState<FullDiskAccessStatus | null>(null)
  const [isRelaunching, setIsRelaunching] = useState(false)

  useEffect(() => {
    let cancelled = false
    getFullDiskAccessStatus().then(result => {
      if (!cancelled) setStatus(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!status || status === 'not_applicable') return null

  const handleOpenSettings = () => {
    openFullDiskAccessSettings().catch(error => {
      toast.error(`Could not open System Settings: ${error}`)
    })
  }

  const handleRelaunch = () => {
    setIsRelaunching(true)
    relaunchForFullDiskAccess().catch(error => {
      setIsRelaunching(false)
      toast.error(`Could not relaunch ${PRODUCT_NAME}: ${error}`)
    })
  }

  return (
    <SettingsSection title="Full Disk Access (macOS)">
      <div className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Optional, and not recommended by default. Read this before you turn
            it on.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">What it grants:</span>{' '}
              {PRODUCT_NAME} and every program an agent starts can read all of
              your files, including Mail, Messages, Safari history, Documents
              and other apps’ data — not only your projects.
            </li>
            <li>
              <span className="text-foreground">Why it matters:</span> agents
              run commands you do not review one by one. A prompt injection from
              a web page, issue or dependency could read private data.
            </li>
            <li>
              <span className="text-foreground">What you get:</span> no more
              repeated “would like to access data from other apps” prompts.
            </li>
            <li>
              <span className="text-foreground">Without it:</span>{' '}
              {PRODUCT_NAME} works fine. macOS keeps asking per tool, and you
              can allow only the folders you need.
            </li>
            <li>
              <span className="text-foreground">To revoke:</span> System
              Settings → Privacy &amp; Security → Full Disk Access, turn{' '}
              {PRODUCT_NAME} off.
            </li>
          </ul>
        </div>

        <div className="settings-inline-field flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="space-y-0.5 sm:w-56 sm:shrink-0 lg:w-72">
            <Label className="text-sm text-foreground">Status</Label>
            <div className="text-xs text-muted-foreground break-words">
              {status === 'granted'
                ? 'Granted.'
                : // "in this session": macOS applies a grant only after a relaunch.
                  'Not granted in this session. After you turn it on, relaunch.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenSettings}>
              Open System Settings
            </Button>
            {status === 'denied' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRelaunch}
                disabled={isRelaunching}
              >
                {isRelaunching && <Loader2 className="h-4 w-4 animate-spin" />}
                Relaunch now
              </Button>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
