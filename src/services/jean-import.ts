import { useQuery } from '@tanstack/react-query'
import { isLocalBackend, isNativeApp } from '@/lib/environment'
import { invoke } from '@/lib/transport'
import { usePreferences } from '@/services/preferences'

/** An existing Jean data folder Splitkick can import (jean_core::jean_import). */
export interface ImportSource {
  path: string
  /** The folder holds JeanZ's own UI state, so the user ran JeanZ. */
  hasJeanzState: boolean
  projectCount: number
  worktreeCount: number
  sessionCount: number
  sizeBytes: number
  /** Unix seconds of the last change to projects.json. */
  lastModified: number | null
  /** Jean is running; the import refuses until it quits. */
  running: boolean
}

export interface ImportSummary {
  sourcePath: string
  copiedFiles: number
  copiedBytes: number
  changes: string[]
  legacyMcpMentions: string[]
}

export const jeanImportQueryKey = ['jean-import-sources'] as const

/** Only the local desktop app imports: it reads Jean's folder on this Mac. */
function canImport(): boolean {
  return isNativeApp() && isLocalBackend()
}

/**
 * Jean folders to offer, while the user has not chosen "Start fresh".
 * Empty once Splitkick has projects of its own.
 */
export function useJeanImportSources() {
  const { data: preferences } = usePreferences()
  const enabled =
    canImport() && !!preferences && !preferences.jean_import_offer_dismissed
  return useQuery({
    queryKey: jeanImportQueryKey,
    queryFn: () => invoke<ImportSource[]>('detect_import_sources'),
    enabled,
    staleTime: Infinity,
  })
}

/**
 * True while the import offer is unanswered (or still being checked).
 * First-run onboarding waits for it, so the two dialogs never compete.
 */
export function useJeanImportPending(): boolean {
  const { data: preferences } = usePreferences()
  const { data: sources, isPending } = useJeanImportSources()
  if (!canImport()) return false
  if (!preferences) return true
  if (preferences.jean_import_offer_dismissed) return false
  return isPending || (sources?.length ?? 0) > 0
}

export function importFromJean(
  sourcePath: string,
  useJeanzState: boolean
): Promise<ImportSummary> {
  return invoke<ImportSummary>('import_from_jean', {
    sourcePath,
    useJeanzState,
  })
}
