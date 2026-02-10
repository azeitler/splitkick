import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { Code, Terminal, Folder, Settings, Github } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { invoke } from '@/lib/transport'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import {
  useOpenWorktreeInFinder,
  useOpenWorktreeInTerminal,
  useOpenWorktreeInEditor,
  useOpenBranchOnGitHub,
  useProjects,
  useWorktree,
} from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { getEditorLabel, getTerminalLabel } from '@/types/preferences'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { isNativeApp } from '@/lib/environment'

type OpenOption = 'editor' | 'terminal' | 'finder' | 'github'

export function OpenInModal() {
  const { openInModalOpen, setOpenInModalOpen, openPreferencesPane } =
    useUIStore()
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: projects } = useProjects()
  // Track whether we've initialized the selection for this open
  const hasInitializedRef = useRef(false)
  const [selectedOption, setSelectedOption] = useState<OpenOption>('editor')

  const { data: worktree } = useWorktree(selectedWorktreeId)
  const openInFinder = useOpenWorktreeInFinder()
  const openInTerminal = useOpenWorktreeInTerminal()
  const openInEditor = useOpenWorktreeInEditor()
  const openOnGitHub = useOpenBranchOnGitHub()
  const { data: preferences } = usePreferences()

  // Build options with dynamic labels based on preferences
  // Native-only options (editor, terminal, finder) are hidden in web view
  const isNative = isNativeApp()

  const options = useMemo(() => {
    const allOptions: {
      id: OpenOption
      label: string
      icon: typeof Code
      key: string
      nativeOnly: boolean
    }[] = [
      {
        id: 'editor',
        label: getEditorLabel(preferences?.editor),
        icon: Code,
        key: 'E',
        nativeOnly: true,
      },
      {
        id: 'terminal',
        label: getTerminalLabel(preferences?.terminal),
        icon: Terminal,
        key: 'T',
        nativeOnly: true,
      },
      {
        id: 'finder',
        label: 'Finder',
        icon: Folder,
        key: 'F',
        nativeOnly: true,
      },
      {
        id: 'github',
        label: 'GitHub',
        icon: Github,
        key: 'G',
        nativeOnly: false,
      },
    ]

    // Filter out native-only options in web view
    return isNative ? allOptions : allOptions.filter(opt => !opt.nativeOnly)
  }, [preferences?.editor, preferences?.terminal, isNative])

  // Reset selection tracking when modal closes
  useEffect(() => {
    if (!openInModalOpen) {
      hasInitializedRef.current = false
    }
  }, [openInModalOpen])

  // Initialize selection when modal opens (via onOpenChange callback pattern)
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !hasInitializedRef.current) {
        // Default to first available option (editor in native, github in web)
        setSelectedOption(isNative ? 'editor' : 'github')
        hasInitializedRef.current = true
      }
      setOpenInModalOpen(open)
    },
    [setOpenInModalOpen, isNative]
  )

  const getTargetPath = useCallback(() => {
    // Try worktree path first
    if (selectedWorktreeId) {
      const path = useChatStore.getState().getWorktreePath(selectedWorktreeId)
      if (path) return path
    }
    // Fall back to project path
    if (selectedProjectId && projects) {
      const project = projects.find(p => p.id === selectedProjectId)
      if (project) return project.path
    }
    return null
  }, [selectedWorktreeId, selectedProjectId, projects])

  const executeAction = useCallback(
    (option: OpenOption) => {
      const targetPath = getTargetPath()
      if (!targetPath) {
        notify('No project or worktree selected', undefined, { type: 'error' })
        setOpenInModalOpen(false)
        return
      }

      switch (option) {
        case 'editor':
          openInEditor.mutate({
            worktreePath: targetPath,
            editor: preferences?.editor,
          })
          break
        case 'terminal':
          openInTerminal.mutate({
            worktreePath: targetPath,
            terminal: preferences?.terminal,
          })
          break
        case 'finder':
          openInFinder.mutate(targetPath)
          break
        case 'github': {
          const branch = worktree?.branch
          if (!branch) {
            // No worktree branch - open project GitHub page instead
            if (selectedProjectId) {
              invoke('open_project_on_github', { projectId: selectedProjectId })
            } else {
              notify('No project selected', undefined, { type: 'error' })
            }
            break
          }
          openOnGitHub.mutate({ repoPath: targetPath, branch })
          break
        }
      }

      setOpenInModalOpen(false)
    },
    [
      getTargetPath,
      openInEditor,
      openInTerminal,
      openInFinder,
      openOnGitHub,
      worktree,
      preferences,
      setOpenInModalOpen,
      selectedProjectId,
    ]
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const optionIds = options.map(opt => opt.id)

      // Quick select with shortcut keys (only for available options)
      const matchedOption = options.find(opt => opt.key.toLowerCase() === key)
      if (matchedOption) {
        e.preventDefault()
        executeAction(matchedOption.id)
      } else if (key === 'enter') {
        e.preventDefault()
        executeAction(selectedOption)
      } else if (key === 'arrowdown' || key === 'arrowup') {
        e.preventDefault()
        const currentIndex = optionIds.indexOf(selectedOption)
        const newIndex =
          key === 'arrowdown'
            ? (currentIndex + 1) % optionIds.length
            : (currentIndex - 1 + optionIds.length) % optionIds.length
        const newOptionId = optionIds[newIndex]
        if (newOptionId) {
          setSelectedOption(newOptionId)
        }
      }
    },
    [executeAction, selectedOption, options]
  )

  const handleOpenSettings = useCallback(() => {
    setOpenInModalOpen(false)
    openPreferencesPane('general')
  }, [setOpenInModalOpen, openPreferencesPane])

  return (
    <Dialog open={openInModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[280px] p-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-medium">Open in...</DialogTitle>
        </DialogHeader>

        <div className="pb-2">
          {options.map(option => {
            const Icon = option.icon
            const isSelected = selectedOption === option.id

            return (
              <button
                key={option.id}
                onClick={() => executeAction(option.id)}
                onMouseEnter={() => setSelectedOption(option.id)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2 text-sm transition-colors',
                  'hover:bg-accent focus:outline-none',
                  isSelected && 'bg-accent'
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>{option.label}</span>
                </div>
                <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {option.key}
                </kbd>
              </button>
            )
          })}
        </div>

        <div className="border-t px-4 py-2">
          <button
            onClick={handleOpenSettings}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-3 w-3" />
            <span>Change defaults in Settings</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default OpenInModal
