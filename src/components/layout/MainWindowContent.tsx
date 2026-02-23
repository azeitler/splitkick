import { useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ChatWindow } from '@/components/chat'
import { ProjectCanvasView } from '@/components/dashboard'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useProjects } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Plus, FolderOpen, Loader2 } from 'lucide-react'
import { isFolder } from '@/types/projects'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'

interface MainWindowContentProps {
  children?: React.ReactNode
  className?: string
}

export function MainWindowContent({
  children,
  className,
}: MainWindowContentProps) {
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const setAddProjectDialogOpen = useProjectsStore(
    state => state.setAddProjectDialogOpen
  )
  const { data: projects = [] } = useProjects()
  const { installedBackends, isLoading: backendsLoading } = useInstalledBackends()
  const realProjects = projects.filter(p => !isFolder(p))
  const setupIncomplete = !backendsLoading && installedBackends.length === 0

  const showWelcome = !activeWorktreePath && !selectedProjectId && !children
  const showAddButton = showWelcome && projects.length === 0 && !setupIncomplete

  const handleProjectClick = useCallback((projectId: string) => {
    const { selectProject, expandProject } = useProjectsStore.getState()
    selectProject(projectId)
    expandProject(projectId)
  }, [])

  // Enter key opens add project dialog on welcome screen
  useEffect(() => {
    if (!showAddButton) return
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if a modal is open
      if (useUIStore.getState().featureTourOpen) return
      // Don't intercept Enter from input elements (e.g. preferences font size)
      const tag = (e.target as HTMLElement)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return
      if (e.key === 'Enter') {
        e.preventDefault()
        setAddProjectDialogOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showAddButton, setAddProjectDialogOpen])

  return (
    <div
      className={cn(
        'flex h-full w-full min-w-0 flex-col overflow-hidden bg-background',
        className
      )}
    >
      {activeWorktreePath ? (
        <ChatWindow />
      ) : selectedProjectId ? (
        <ProjectCanvasView
          key={selectedProjectId}
          projectId={selectedProjectId}
        />
      ) : (
        children || (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 font-sans">
            <h1 className="text-4xl font-bold text-foreground">
              Welcome to Jean!
            </h1>
            {realProjects.length > 0 ? (
              <div className="flex w-full max-w-sm flex-col gap-1">
                {realProjects.map(project => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectClick(project.id)}
                    className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{project.name}</span>
                  </button>
                ))}
              </div>
            ) : backendsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Calling Jean…</span>
              </div>
            ) : setupIncomplete ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Complete setup to start adding projects.
                </p>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() =>
                    useUIStore.setState({
                      onboardingManuallyTriggered: true,
                      onboardingDismissed: false,
                      onboardingOpen: true,
                    })
                  }
                >
                  Complete Setup
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setAddProjectDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Project
                <Kbd className="ml-2 h-5 px-1.5 text-[10px]">↵</Kbd>
              </Button>
            )}
          </div>
        )
      )}
    </div>
  )
}

export default MainWindowContent
