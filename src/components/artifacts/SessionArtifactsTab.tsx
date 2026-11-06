import { useMemo, useState } from 'react'
import {
  ExternalLink,
  FileText,
  GitCompare,
  Globe,
  History,
  Image,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatRelativeTime } from '@/lib/relative-time'
import {
  useArtifactSnapshotDir,
  useEditArtifacts,
  useSessions,
} from '@/services/chat'
import { useWorktree } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import type { Artifact, ArtifactOp } from '@/types/chat'
import { ArtifactDiffModal } from './ArtifactDiffModal'
import {
  comparableVersions,
  latestAt,
  openArtifactVersion,
  versionsOf,
} from './artifact-versions'
import { isWebArtifact, openArtifact } from './open-artifact'

const EMPTY_ARTIFACTS: Artifact[] = []
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

/** The artifact list of one session, read from the worktree's session list. */
export function useSessionArtifacts(
  worktreeId: string | null,
  sessionId: string | null
) {
  const { data: worktree } = useWorktree(worktreeId)
  const worktreePath = worktree?.path ?? null
  const { data: sessions } = useSessions(worktreeId, worktreePath)
  const session = sessionId
    ? sessions?.sessions.find(s => s.id === sessionId)
    : undefined
  return {
    artifacts: session?.artifacts ?? EMPTY_ARTIFACTS,
    loaded: !!session,
    worktreePath,
  }
}

function ArtifactIcon({ target }: { target: string }) {
  const className = 'mt-0.5 size-3.5 shrink-0 text-muted-foreground'
  if (isWebArtifact(target)) return <Globe className={className} />
  if (IMAGE_RE.test(target)) return <Image className={className} />
  return <FileText className={className} />
}

/** A path inside the worktree reads shorter relative to it. */
export function displayTarget(target: string, worktreePath: string | null) {
  if (!worktreePath) return target
  const root = worktreePath.replace(/[\\/]+$/, '')
  const rest = target.slice(root.length)
  return target.startsWith(root) && /^[\\/]/.test(rest) ? rest.slice(1) : target
}

function formatAt(createdAt: number): string {
  return `${formatRelativeTime(createdAt)} (${new Date(createdAt).toLocaleString()})`
}

interface CompareRequest {
  artifact: Artifact
  initial?: { from: number; to: number }
}

/**
 * The Artifacts tab of the left panel: files and URLs the agent registered
 * with the MCP tool `add_artifact`, newest change first. Each item keeps its
 * versions (#108): open any of them, or compare two.
 */
export function SessionArtifactsTab({
  worktreeId,
  sessionId,
}: {
  worktreeId: string
  sessionId: string
}) {
  const isMobile = useIsMobile()
  const { artifacts, loaded, worktreePath } = useSessionArtifacts(
    worktreeId,
    sessionId
  )
  const edit = useEditArtifacts(sessionId, worktreeId, worktreePath)
  const { data: snapshotDir } = useArtifactSnapshotDir(sessionId)
  const [compare, setCompare] = useState<CompareRequest | null>(null)
  // Newest change first: the agent's latest output is what the user looks for.
  const sorted = useMemo(
    () => [...artifacts].sort((a, b) => latestAt(b) - latestAt(a)),
    [artifacts]
  )

  if (!loaded) {
    return <p className="px-3 py-6 text-sm text-muted-foreground">Loading…</p>
  }
  if (sorted.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        No artifacts yet. Agents add files and links here with the{' '}
        <code className="text-xs">add_artifact</code> tool.
      </p>
    )
  }

  // On a phone the panel is a drawer over the viewer: close it.
  const closeDrawer = () => {
    if (isMobile) useUIStore.getState().setFileBrowserVisible(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-1 text-xs text-muted-foreground">
        <span>
          {sorted.length} {sorted.length === 1 ? 'artifact' : 'artifacts'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => void edit({ kind: 'clear' })}
        >
          <Trash2 className="size-3" />
          Clear all
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul aria-label="Artifacts" className="py-1">
          {sorted.map(item => (
            <ArtifactRow
              key={item.id}
              item={item}
              worktreePath={worktreePath}
              onOpen={system => {
                openArtifact(item, worktreePath, { system })
                if (!system) closeDrawer()
              }}
              onOpenVersion={version => {
                openArtifactVersion(item, version, snapshotDir)
                closeDrawer()
              }}
              onCompare={initial => setCompare({ artifact: item, initial })}
              onEdit={edit}
            />
          ))}
        </ul>
      </ScrollArea>
      {compare && (
        <ArtifactDiffModal
          // A new request starts with its own versions picked.
          key={`${compare.artifact.id}-${compare.initial?.from}-${compare.initial?.to}`}
          artifact={compare.artifact}
          snapshotDir={snapshotDir}
          initial={compare.initial}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  )
}

function ArtifactRow({
  item,
  worktreePath,
  onOpen,
  onOpenVersion,
  onCompare,
  onEdit,
}: {
  item: Artifact
  worktreePath: string | null
  onOpen: (system: boolean) => void
  onOpenVersion: (version: ReturnType<typeof versionsOf>[number]) => void
  onCompare: (initial?: { from: number; to: number }) => void
  onEdit: (op: ArtifactOp) => Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const versions = versionsOf(item)
  const comparable = comparableVersions(item)
  const latest = versions.at(-1)
  const changed = versions.length > 1

  return (
    <li className="group/row">
      <div className="group flex items-start gap-1 px-1.5 hover:bg-sidebar-accent/70">
        <button
          type="button"
          onClick={() => onOpen(false)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1.5 text-left"
        >
          <ArtifactIcon target={item.target} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{item.title}</span>
            {item.note && (
              <span className="block text-xs text-muted-foreground">
                {item.note}
              </span>
            )}
            <span
              className="block truncate text-[11px] text-muted-foreground"
              title={item.target}
            >
              {displayTarget(item.target, worktreePath)}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {changed ? 'Updated ' : ''}
              {formatAt(latest?.created_at ?? item.created_at)}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 py-1">
          {changed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-1.5 text-[11px] font-medium md:h-6"
              aria-expanded={expanded}
              aria-label={`${versions.length} versions of ${item.title}`}
              title="Version history"
              onClick={() => setExpanded(open => !open)}
            >
              <History className="size-3" />v{latest?.version}
            </Button>
          )}
          <div className="flex items-center gap-0.5 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 md:size-6"
              aria-label={`Open ${item.title} outside Splitkick`}
              title={
                isWebArtifact(item.target)
                  ? 'Open in the system browser'
                  : 'Open in the default app'
              }
              onClick={() => onOpen(true)}
            >
              <ExternalLink className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 md:size-6"
              aria-label={`Remove ${item.title}`}
              title="Remove"
              onClick={() => void onEdit({ kind: 'remove', id: item.id })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mb-1 ml-7 border-l border-sidebar-border pl-2">
          <ol aria-label={`Versions of ${item.title}`}>
            {[...versions].reverse().map(version => {
              const previous = comparable
                .filter(v => v.version < version.version)
                .at(-1)
              return (
                <li
                  key={version.version}
                  className="flex items-start gap-1 py-1 text-[11px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">
                      v{version.version}
                      {version.change ? ` · ${version.change}` : ''}
                    </span>
                    <span className="block text-muted-foreground">
                      {formatAt(version.created_at)}
                    </span>
                  </span>
                  {version.snapshot && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-1.5 text-[11px] md:h-6"
                      aria-label={`Open v${version.version} of ${item.title}`}
                      onClick={() => onOpenVersion(version)}
                    >
                      Open
                    </Button>
                  )}
                  {version.snapshot && previous && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-1.5 text-[11px] md:h-6"
                      aria-label={`Compare v${version.version} of ${item.title} with v${previous.version}`}
                      title={`Compare with v${previous.version}`}
                      onClick={() =>
                        onCompare({
                          from: previous.version,
                          to: version.version,
                        })
                      }
                    >
                      <GitCompare className="size-3" />v{previous.version}
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
          {comparable.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-[11px]"
              onClick={() => onCompare()}
            >
              <GitCompare className="size-3" />
              Compare versions…
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
