import { memo } from 'react'
import { cn } from '@/lib/utils'
import { RecentSessionsSection } from '@/components/home/RecentSessionsSection'
import { RecentActivitySection } from '@/components/home/RecentActivitySection'
import { ProjectOpenIssuesSection } from './ProjectOpenIssuesSection'

/**
 * The overview column of the project home: the sessions touched last, and what
 * happened since.
 *
 * It renders before the worktree column, so the reading order is what you did,
 * then what you can act on, then what is waiting. The sections themselves are
 * the Home ones, narrowed by `projectId`.
 */
export const ProjectOverviewColumn = memo(function ProjectOverviewColumn({
  projectId,
}: {
  projectId: string
}) {
  return (
    <ProjectHomeColumn testId="project-column-overview">
      <RecentSessionsSection projectId={projectId} />
      <RecentActivitySection projectId={projectId} />
    </ProjectHomeColumn>
  )
})

/**
 * The last column of the project home: the open GitHub issues.
 *
 * Unlike the other two this section is new, because Home spans every project
 * and an issue list belongs to one repository.
 */
export const ProjectIssuesColumn = memo(function ProjectIssuesColumn({
  projectId,
  projectPath,
  className,
}: {
  projectId: string
  projectPath: string
  className?: string
}) {
  return (
    <ProjectHomeColumn testId="project-column-issues" className={className}>
      <ProjectOpenIssuesSection
        projectId={projectId}
        projectPath={projectPath}
      />
    </ProjectHomeColumn>
  )
})

/**
 * One column of the project home.
 *
 * Unlike the Home columns these do not scroll on their own. The canvas scrolls
 * as one page, and a column that trapped the wheel would make the worktree
 * list hard to reach.
 */
function ProjectHomeColumn({
  testId,
  className,
  children,
}: {
  testId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className={cn('flex min-w-0 flex-col gap-8', className)}
    >
      {children}
    </div>
  )
}
