import { useMemo } from 'react'
import { ExternalLink, FileText, Globe, Image, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatRelativeTime } from '@/lib/relative-time'
import { useEditArtifacts, useSessions } from '@/services/chat'
import { useWorktree } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import type { Artifact } from '@/types/chat'
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

function formatAddedAt(createdAt: number): string {
  return `${formatRelativeTime(createdAt)} (${new Date(createdAt).toLocaleString()})`
}

/**
 * The Artifacts tab of the left panel: files and URLs the agent registered
 * with the MCP tool `add_artifact`, newest first.
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
  // Newest first: the agent's latest output is what the user looks for.
  const sorted = useMemo(
    () => [...artifacts].sort((a, b) => b.created_at - a.created_at),
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

  const open = (item: Artifact, system = false) => {
    openArtifact(item, worktreePath, { system })
    // On a phone the panel is a drawer over the viewer: close it.
    if (isMobile && !system) {
      useUIStore.getState().setFileBrowserVisible(false)
    }
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
            <li
              key={item.id}
              className="group flex items-start gap-1 px-1.5 hover:bg-sidebar-accent/70"
            >
              <button
                type="button"
                onClick={() => open(item)}
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
                    {formatAddedAt(item.created_at)}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 py-1 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
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
                  onClick={() => open(item, true)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 md:size-6"
                  aria-label={`Remove ${item.title}`}
                  title="Remove"
                  onClick={() => void edit({ kind: 'remove', id: item.id })}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
