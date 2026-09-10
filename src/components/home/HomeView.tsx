import { memo } from 'react'
import type { Project } from '@/types/projects'
import { WelcomeProjectGrid } from '@/components/layout/WelcomeProjectGrid'
import { RecentSessionsSection } from './RecentSessionsSection'
import { StarredSessionsSection } from './StarredSessionsSection'
import { RecentActivitySection } from './RecentActivitySection'

interface HomeViewProps {
  projects: Project[]
  onProjectClick: (projectId: string) => void
  onAddProject: () => void
}

/**
 * The landing view: projects, the sessions you starred, the ones worked on most
 * recently across every project, and what happened since the last visit.
 *
 * Home is the state where no project and no worktree is selected. The sidebar
 * Home row clears both, and the existing UI-state persistence of
 * `active_project_id` brings the same view back after a restart.
 */
export const HomeView = memo(function HomeView({
  projects,
  onProjectClick,
  onAddProject,
}: HomeViewProps) {
  return (
    <div
      className="flex flex-1 flex-col items-center gap-8 overflow-y-auto px-6 py-10 font-sans"
      data-testid="home-view"
    >
      <div className="flex w-full max-w-4xl flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Home</h1>
        <p className="text-sm text-muted-foreground">
          Your projects, the sessions you touched last, and what happened since.
        </p>
      </div>

      <WelcomeProjectGrid
        projects={projects}
        onProjectClick={onProjectClick}
        onAddProject={onAddProject}
      />

      <StarredSessionsSection />
      <RecentSessionsSection />
      <RecentActivitySection />
    </div>
  )
})
