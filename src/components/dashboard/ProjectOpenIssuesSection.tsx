import { memo, useCallback, useMemo, useState } from 'react'
import { CircleDot } from 'lucide-react'
import { HomeSection } from '@/components/home/HomeSection'
import { HOME_FILTER_MIN_ITEMS } from '@/components/home/home-utils'
import { IssuePreviewModal } from '@/components/worktree/IssuePreviewModal'
import { Input } from '@/components/ui/input'
import { formatRelativeTime } from '@/lib/relative-time'
import {
  filterIssues,
  isGhAuthError,
  isNewIssue,
  isUnsupportedGitHubRepoError,
  useGitHubIssues,
} from '@/services/github'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import type { GitHubIssue } from '@/types/github'

/**
 * Rows the rail shows before it hands the rest to the New Worktree modal. The
 * rail is a glance at the newest work, not a replacement for the issue list.
 */
const MAX_ISSUE_ROWS = 20

interface ProjectOpenIssuesSectionProps {
  projectId: string
  projectPath: string
}

/**
 * The project's open GitHub issues, newest first.
 *
 * The section hides itself when the project has no GitHub remote or the GitHub
 * CLI is not signed in. A project that is simply not on GitHub is a normal
 * state, not an error, and it must not show a broken panel (coollabsio/jean#354).
 */
export const ProjectOpenIssuesSection = memo(function ProjectOpenIssuesSection({
  projectId,
  projectPath,
}: ProjectOpenIssuesSectionProps) {
  const { data, isLoading, isError, error, refetch } = useGitHubIssues(
    projectPath,
    'open'
  )
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<number | null>(null)

  const issues = useMemo(() => data?.issues ?? [], [data?.issues])
  const visible = useMemo(
    () => filterIssues(issues, query).slice(0, MAX_ISSUE_ROWS),
    [issues, query]
  )

  const handleShowAll = useCallback(() => {
    useProjectsStore.getState().selectProject(projectId)
    const { setNewWorktreeModalDefaultTab, setNewWorktreeModalOpen } =
      useUIStore.getState()
    setNewWorktreeModalDefaultTab('issues')
    setNewWorktreeModalOpen(true)
  }, [projectId])

  // Not a GitHub repository, or no GitHub login: say nothing rather than show
  // an error the user cannot act on from here.
  if (
    isError &&
    (isUnsupportedGitHubRepoError(error) || isGhAuthError(error))
  ) {
    return null
  }

  if (isError) {
    return (
      <HomeSection title="Open issues">
        <p className="text-sm text-muted-foreground">
          Could not load issues.{' '}
          <button
            type="button"
            onClick={() => void refetch()}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Retry
          </button>
        </p>
      </HomeSection>
    )
  }

  if (isLoading) {
    return (
      <HomeSection title="Open issues">
        <p className="text-sm text-muted-foreground">Loading issues…</p>
      </HomeSection>
    )
  }

  if (issues.length === 0) return null

  // The field stays while it holds a query, so a filter can never be active
  // with no visible way to clear it.
  const showQueryField = issues.length >= HOME_FILTER_MIN_ITEMS || query !== ''
  const hidden = data ? data.totalCount - visible.length : 0

  return (
    <>
      <HomeSection
        title="Open issues"
        action={
          showQueryField ? (
            <Input
              placeholder="Filter issues..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="h-8 max-w-[12rem]"
            />
          ) : undefined
        }
      >
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No issue matches &ldquo;{query.trim()}&rdquo;
          </p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20"
            data-testid="project-open-issues"
          >
            {visible.map(issue => (
              <IssueRow
                key={issue.number}
                issue={issue}
                onOpen={() => setPreview(issue.number)}
              />
            ))}
          </ul>
        )}

        {hidden > 0 && (
          <button
            type="button"
            onClick={handleShowAll}
            className="self-start text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Show all {data?.totalCount} open issues
          </button>
        )}
      </HomeSection>

      {preview !== null && (
        <IssuePreviewModal
          open
          onOpenChange={open => {
            if (!open) setPreview(null)
          }}
          projectPath={projectPath}
          type="issue"
          number={preview}
        />
      )}
    </>
  )
})

/** Same two-line grid as the session and activity rows. */
function IssueRow({
  issue,
  onOpen,
}: {
  issue: GitHubIssue
  onOpen: () => void
}) {
  const createdAt = new Date(issue.created_at).getTime()

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <CircleDot
          className="size-3.5 shrink-0 text-green-600 dark:text-green-400"
          aria-hidden="true"
        />

        <span className="truncate text-sm">{issue.title}</span>

        <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
          {Number.isNaN(createdAt) ? '' : formatRelativeTime(createdAt)}
        </span>

        <span className="col-start-2 col-end-4 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">#{issue.number}</span>

          {isNewIssue(issue.created_at) && (
            <span className="shrink-0 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
              new
            </span>
          )}

          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {issue.labels.map(label => (
              <span
                key={label.name}
                className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  borderColor: `#${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
          </span>
        </span>
      </button>
    </li>
  )
}
