import { memo } from 'react'
import type { Project } from '@/types/projects'
import { WelcomeProjectGrid } from '@/components/layout/WelcomeProjectGrid'
import { cn } from '@/lib/utils'
import { RecentSessionsSection } from './RecentSessionsSection'
import { StarredSessionsSection } from './StarredSessionsSection'
import { TodoSessionsSection } from './TodoSessionsSection'
import { RecentActivitySection } from './RecentActivitySection'
import {
  ToolbarContent,
  useHasWindowToolbar,
} from '@/components/toolbar/toolbar-slots'
import { ToolbarPaletteSearch } from '@/components/toolbar/ToolbarSearchField'

const HOME_SUBTITLE = 'The sessions you touched last, and your projects.'

interface HomeViewProps {
  projects: Project[]
  onProjectClick: (projectId: string) => void
  onAddProject: () => void
}

/**
 * The landing view: the sessions that need you, the sessions you touched last,
 * and your projects grouped by the sidebar folders. The activity feed sits
 * closed under the recent sessions.
 *
 * Home is the state where no project and no worktree is selected. The sidebar
 * Home row clears both, and the existing UI-state persistence of
 * `active_project_id` brings the same view back after a restart.
 *
 * The columns answer to the view's own width (container queries), not the
 * window's, because the navigation takes a variable share of the window:
 * - narrow: one column, the page scrolls;
 * - `@3xl`: sessions beside projects, each column scrolling on its own;
 * - `@6xl`: three columns — To-Do and Starred, then Recent sessions and
 *   activity, then projects. The first goes away while it is empty, and the
 *   other two share the width.
 *
 * Every section is a column, not a full-width row: Recent sessions has no
 * length limit, so a row of it above the projects would push them out of view.
 */
export const HomeView = memo(function HomeView({
  projects,
  onProjectClick,
  onAddProject,
}: HomeViewProps) {
  // Desktop puts the heading in the window toolbar; without one (phone) the
  // view keeps its own.
  const hasToolbar = useHasWindowToolbar()
  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col font-sans"
      data-testid="home-view"
    >
      {/* Narrow, this is the one scroll area. From `@3xl` the columns scroll,
          and the right padding moves into the last column so its scroll bar
          sits at the window edge with the content clear of it. */}
      <div
        data-home-scroll
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-6 pb-8 [scrollbar-gutter:stable] @3xl:overflow-hidden @3xl:pr-0 @3xl:pb-0"
      >
        {hasToolbar ? (
          <ToolbarContent
            title="Home"
            subtitle={HOME_SUBTITLE}
            search={<ToolbarPaletteSearch />}
          />
        ) : (
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-foreground">Home</h1>
            <p className="text-sm text-muted-foreground">{HOME_SUBTITLE}</p>
          </header>
        )}

        <div
          data-testid="home-grid"
          className="grid gap-x-3 gap-y-8 @3xl:min-h-0 @3xl:flex-1 @3xl:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)] @3xl:grid-rows-[minmax(0,1fr)] @6xl:grid-flow-col @6xl:grid-cols-none @6xl:auto-cols-[minmax(0,1fr)]"
        >
          {/* From `@6xl` this wrapper dissolves and its two parts become
              columns of their own. */}
          <HomeColumn
            testId="home-column-sessions"
            scrollAt="3xl"
            className="@6xl:contents"
          >
            <HomeColumn
              testId="home-column-needs-you"
              scrollAt="6xl"
              className="empty:hidden"
            >
              <TodoSessionsSection />
              <StarredSessionsSection />
            </HomeColumn>
            <HomeColumn testId="home-column-recent" scrollAt="6xl">
              <RecentSessionsSection />
              <RecentActivitySection />
            </HomeColumn>
          </HomeColumn>

          <HomeColumn testId="home-column-projects" scrollAt="3xl" last>
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

// Literal class lists, so Tailwind finds them.
const SCROLL_CLASSES = {
  '3xl':
    '@3xl:min-h-0 @3xl:overflow-y-auto @3xl:pr-3 @3xl:pb-8 @3xl:[scrollbar-gutter:stable]',
  '6xl':
    '@6xl:min-h-0 @6xl:overflow-y-auto @6xl:pr-3 @6xl:pb-8 @6xl:[scrollbar-gutter:stable]',
} as const

/**
 * One Home column. From its breakpoint on it scrolls on its own, so a long
 * session list never pushes the projects out of view. The right padding keeps
 * the content clear of the scroll bar, overlay or always shown; the stable
 * gutter stops the content reflowing when a column starts to overflow.
 */
function HomeColumn({
  testId,
  scrollAt,
  last = false,
  className,
  children,
}: {
  testId: string
  scrollAt: keyof typeof SCROLL_CLASSES
  /** The rightmost column: it carries the view's right padding. */
  last?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      data-home-scroll
      className={cn(
        'flex min-w-0 flex-col gap-8',
        SCROLL_CLASSES[scrollAt],
        last && '@3xl:pr-6',
        className
      )}
    >
      {children}
    </div>
  )
}
