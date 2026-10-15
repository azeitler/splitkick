import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PRODUCT_NAME } from '@/lib/build-info'
import { formatRelativeTime, toMilliseconds } from '@/lib/relative-time'
import {
  importFromJean,
  useJeanImportSources,
  type ImportSource,
  type ImportSummary,
} from '@/services/jean-import'
import { usePatchPreferences } from '@/services/preferences'

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatModified(seconds: number | null): string | null {
  if (!seconds) return null
  const full = new Date(toMilliseconds(seconds)).toLocaleString()
  return `${formatRelativeTime(seconds)} (${full})`
}

/**
 * First-start offer to import a copy of an existing Jean (or JeanZ) data
 * folder. Shown until the user imports or chooses "Start fresh", and only
 * while this install has no projects of its own.
 */
export function ImportFromJeanDialog() {
  const { data: sources, refetch, isFetching } = useJeanImportSources()
  const patchPreferences = usePatchPreferences()
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const source: ImportSource | undefined = sources?.[0]
  const open = !!source || !!summary

  const startFresh = useCallback(() => {
    patchPreferences.mutate({ jean_import_offer_dismissed: true })
  }, [patchPreferences])

  const runImport = useCallback(async () => {
    if (!source) return
    setImporting(true)
    try {
      const result = await importFromJean(source.path)
      setSummary(result)
    } catch (error) {
      toast.error(`Import failed: ${error}`)
      void refetch()
    } finally {
      setImporting(false)
    }
  }, [source, refetch])

  const restart = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }, [])

  if (!open) return null

  if (summary) {
    return (
      <Dialog open>
        <DialogContent
          className="sm:max-w-lg"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Import ready</DialogTitle>
            <DialogDescription>
              Copied {summary.copiedFiles.toLocaleString()} files (
              {formatSize(summary.copiedBytes)}). Jean&apos;s folder was not
              changed. {PRODUCT_NAME} finishes the import when it restarts.
            </DialogDescription>
          </DialogHeader>
          {summary.changes.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Changed in the copy:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {summary.changes.map(change => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.legacyMcpMentions.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Some of your prompts still name Jean&apos;s MCP server (
              <code>mcp__jean__…</code>): {summary.legacyMcpMentions.join(', ')}
              . In {PRODUCT_NAME} the tools are <code>mcp__splitkick__…</code>.
            </p>
          )}
          <DialogFooter>
            <Button onClick={restart}>Restart {PRODUCT_NAME}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (!source) return null
  const modified = formatModified(source.lastModified)
  // Import chain: JeanZ's copy of every item wins over Jean's.
  const appName = source.hasJeanzState ? 'JeanZ' : 'Jean'

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Import from {appName}</DialogTitle>
          <DialogDescription>
            {PRODUCT_NAME} found {appName}&apos;s data on this Mac. Import a
            copy to keep your projects, sessions, chat history, settings and
            remote hosts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className="break-all font-mono text-xs">{source.path}</p>
          <p className="text-muted-foreground">
            {source.projectCount} projects · {source.worktreeCount} worktrees ·{' '}
            {source.sessionCount} sessions · {formatSize(source.sizeBytes)}
            {modified && <> · changed {modified}</>}
          </p>
        </div>

        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li>{appName}&apos;s data is only read, never changed or moved.</li>
          <li>
            Worktrees stay where they are. New worktrees go to ~/splitkick.
          </li>
          <li>
            Continue imported sessions in {PRODUCT_NAME} only, not in both apps.
          </li>
        </ul>

        {source.running && (
          <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            Jean is running. Quit Jean (and JeanZ), then check again.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={startFresh}
            disabled={importing || patchPreferences.isPending}
          >
            Start fresh
          </Button>
          {source.running ? (
            <Button onClick={() => refetch()} disabled={isFetching}>
              {isFetching && <Loader2 className="size-4 animate-spin" />}
              Check again
            </Button>
          ) : (
            <Button onClick={runImport} disabled={importing}>
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import a copy
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
