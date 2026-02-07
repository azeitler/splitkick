import { cn } from '@/lib/utils'
import { ChatWindow } from '@/components/chat'
import { WorktreeDashboard } from '@/components/dashboard'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useProjects } from '@/services/projects'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

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
        <WorktreeDashboard key={selectedProjectId} projectId={selectedProjectId} />
      ) : (
        children || (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 font-sans">
            <h1 className="text-4xl font-bold text-foreground">
              Welcome to Jean!
            </h1>
            {projects.length === 0 && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setAddProjectDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Project
              </Button>
            )}
          </div>
        )
      )}
    </div>
  )
}

export default MainWindowContent
