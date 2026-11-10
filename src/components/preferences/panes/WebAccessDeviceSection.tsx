import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import { isNativeApp } from '@/lib/environment'
import { formatRelativeTime } from '@/lib/relative-time'
import {
  canUseServiceWorker,
  isServiceWorkerActive,
  resetAppCache,
} from '@/lib/service-worker'
import {
  clearWebReloadLog,
  countStarts,
  getWebReloadLog,
  type WebStartEntry,
  type WebStartKind,
} from '@/lib/web-reload-log'
import { SettingsSection } from '../SettingsSection'

const DAY_MS = 24 * 60 * 60 * 1000
const SHOWN_ENTRIES = 20

const KIND_LABELS: Record<WebStartKind, string> = {
  'background-end': 'Ended in the background',
  'foreground-end': 'Ended on screen',
  reload: 'Browser reload',
  start: 'New start',
  'app-reload': 'Reload by the app',
  first: 'First start',
}

function formatGap(ms: number | null): string {
  if (ms === null) return ''
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return `${Math.round(ms / 1000)} s after`
  if (minutes < 120) return `${minutes} min after`
  return `${Math.round(minutes / 60)} h after`
}

function describeStart(entry: WebStartEntry): string {
  const gap = formatGap(entry.gapMs)
  const reason = entry.reason ? ` (${entry.reason})` : ''
  return `${KIND_LABELS[entry.kind]}${reason}${gap ? `, ${gap} the last page event` : ''}`
}

/**
 * Settings → Web Access, this browser only (#72): how often the page started
 * again and why, and the app cache (service worker). Hidden in the native
 * app, which has neither.
 */
export function WebAccessDeviceSection() {
  const [entries, setEntries] = useState<WebStartEntry[]>(() =>
    getWebReloadLog()
  )
  const [persisted, setPersisted] = useState<boolean | null>(null)
  // The time this pane opened; the list is a snapshot of that moment.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    if (!navigator.storage?.persisted) return
    navigator.storage.persisted().then(setPersisted, () => setPersisted(null))
  }, [])

  const handleCopy = useCallback(() => {
    void copyToClipboard(JSON.stringify(getWebReloadLog(), null, 2)).then(
      () => toast.success('Reload log copied'),
      error => toast.error(`Copy failed: ${error}`)
    )
  }, [])

  const handleClear = useCallback(() => {
    clearWebReloadLog()
    setEntries([])
  }, [])

  if (isNativeApp()) return null

  const lastDay = countStarts(entries, 'background-end', now - DAY_MS)
  const lastWeek = countStarts(entries, 'background-end', now - 7 * DAY_MS)
  const shown = entries.slice(-SHOWN_ENTRIES).reverse()
  const cacheState = isServiceWorkerActive()
    ? 'On'
    : canUseServiceWorker()
      ? 'On after the next start'
      : 'Off: needs HTTPS'

  return (
    <SettingsSection
      title="This device"
      description="Only this browser. Other devices keep their own values."
      anchorId="pref-web-access-section-device"
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-1">
          <div className="font-medium">Reloads by the system</div>
          <p className="text-muted-foreground">
            Starts after the page ended in the background. On an iPhone, iOS
            ends a Home Screen app in the background, and the next open loads it
            again.
          </p>
          <p data-testid="web-reload-counts">
            {lastDay} in the last 24 hours, {lastWeek} in the last 7 days
          </p>
        </div>

        {shown.length > 0 && (
          <ul
            className="space-y-1 text-muted-foreground"
            data-testid="web-reload-log"
          >
            {shown.map(entry => (
              <li key={`${entry.at}-${entry.kind}`}>
                <span className="text-foreground">
                  {formatRelativeTime(entry.at, now)}
                </span>{' '}
                ({new Date(entry.at).toLocaleString()}): {describeStart(entry)}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            Copy log
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            Clear log
          </Button>
        </div>

        <div className="space-y-1">
          <div className="font-medium">App cache</div>
          <p className="text-muted-foreground">
            Keeps the app on this device, so it starts fast and opens also when
            the server cannot be reached. Sessions still need the server.
          </p>
          <p data-testid="web-app-cache-state">
            {cacheState}
            {persisted !== null &&
              ` · Storage ${persisted ? 'kept' : 'can be cleared by the system'}`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void resetAppCache()}
          >
            Reset app cache
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
