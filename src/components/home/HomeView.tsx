import { memo } from 'react'
import type { Project } from '@/types/projects'
import { WelcomeProjectGrid } from '@/components/layout/WelcomeProjectGrid'
import { cn } from '@/lib/utils'
import { RecentSessionsSection } from './RecentSessionsSection'
import { StarredSessionsSection } from './StarredSessionsSection'
import { RecentActivitySection } from './RecentActivitySection'

interface HomeViewProps {
  projects: Project[]
  onProjectClick: (projectId: string) => void
  onAddProject: () => void
}

/**
 * The landing view: the sessions you starred and touched last, what happened
 * since, and your projects — side by side, so everything is visible at once.
 *
 * Home is the state where no project and no worktree is selected. The sidebar
 * Home row clears both, and the existing UI-state persistence of
 * `active_project_id` brings the same view back after a restart.
 *
 * The columns answer to the view's own width (container queries), not the
 * window's, because the sidebar takes a variable share of the window:
 * - narrow: one column, the page scrolls;
 * - `@2xl`: sessions beside activity, projects across the bottom;
 * - `@4xl`: three columns, each scrolling on its own under a fixed header.
 */
export const HomeView = memo(function HomeView({
  projects,
  onProjectClick,
  onAddProject,
}: HomeViewProps) {
  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col font-sans"
      data-testid="home-view"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 @4xl:overflow-hidden">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-foreground">Home</h1>
          <p className="text-sm text-muted-foreground">
            The sessions you touched last, what happened since, and your
            projects.
          </p>
        </header>

        <div className="grid gap-x-6 gap-y-8 @2xl:grid-cols-2 @4xl:min-h-0 @4xl:flex-1 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(14rem,0.9fr)] @4xl:grid-rows-[minmax(0,1fr)]">
          <HomeColumn testId="home-column-sessions">
            <StarredSessionsSection />
            <RecentSessionsSection />
          </HomeColumn>

          <HomeColumn testId="home-column-activity">
            <RecentActivitySection />
          </HomeColumn>

          <HomeColumn
            testId="home-column-projects"
            className="@2xl:col-span-2 @4xl:col-span-1"
          >
            <WelcomeProjectGrid
              projects={projects}
              onProjectClick={onProjectClick}
              onAddProject={onAddProject}
            />
          </HomeColumn>
        </div>
      </div>
    </div>
  )
})

/**
 * One Home column. In the three-column layout it scrolls on its own, so a
 * long activity feed never pushes the sessions out of view. The stable gutter
 * stops the content reflowing when a column starts to overflow.
 */
function HomeColumn({
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
      className={cn(
        'flex min-w-0 flex-col gap-8 @4xl:min-h-0 @4xl:overflow-y-auto @4xl:[scrollbar-gutter:stable]',
        className
      )}
    >
      {children}
    </div>
  )
}
