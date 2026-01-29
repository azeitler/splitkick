import {
  Sidebar,
  Settings,
  Sun,
  Moon,
  Monitor,
  MessageSquare,
  LayoutGrid,
} from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { projectsQueryKeys } from '@/services/projects'
import type { Worktree } from '@/types/projects'
import type { AppCommand } from './types'

export const navigationCommands: AppCommand[] = [
  {
    id: 'show-left-sidebar',
    label: 'Show Left Sidebar',
    description: 'Show the left sidebar',
    icon: Sidebar,
    group: 'navigation',
    shortcut: 'mod+b',
    keywords: ['sidebar', 'left', 'panel', 'show'],

    execute: () => {
      useUIStore.getState().setLeftSidebarVisible(true)
    },

    isAvailable: () => !useUIStore.getState().leftSidebarVisible,
  },

  {
    id: 'hide-left-sidebar',
    label: 'Hide Left Sidebar',
    description: 'Hide the left sidebar',
    icon: Sidebar,
    group: 'navigation',
    shortcut: 'mod+b',
    keywords: ['sidebar', 'left', 'panel', 'hide'],

    execute: () => {
      useUIStore.getState().setLeftSidebarVisible(false)
    },

    isAvailable: () => useUIStore.getState().leftSidebarVisible,
  },

  {
    id: 'open-preferences',
    label: 'Open Preferences',
    description: 'Open the application preferences',
    icon: Settings,
    group: 'settings',
    shortcut: 'mod+comma',
    keywords: ['preferences', 'settings', 'config', 'options'],

    execute: context => {
      context.openPreferences()
    },
  },

  // Theme commands
  {
    id: 'theme-light',
    label: 'Theme: Light',
    description: 'Switch to light theme',
    icon: Sun,
    group: 'theme',
    keywords: ['theme', 'light', 'bright', 'appearance'],

    execute: context => {
      context.setTheme('light')
    },

    isAvailable: context => context.getCurrentTheme() !== 'light',
  },

  {
    id: 'theme-dark',
    label: 'Theme: Dark',
    description: 'Switch to dark theme',
    icon: Moon,
    group: 'theme',
    keywords: ['theme', 'dark', 'night', 'appearance'],

    execute: context => {
      context.setTheme('dark')
    },

    isAvailable: context => context.getCurrentTheme() !== 'dark',
  },

  {
    id: 'theme-system',
    label: 'Theme: System',
    description: 'Use system theme preference',
    icon: Monitor,
    group: 'theme',
    keywords: ['theme', 'system', 'auto', 'appearance'],

    execute: context => {
      context.setTheme('system')
    },

    isAvailable: context => context.getCurrentTheme() !== 'system',
  },

  // Focus commands
  {
    id: 'focus-chat-input',
    label: 'Focus Chat Input',
    description: 'Focus the chat input field',
    icon: MessageSquare,
    group: 'navigation',
    shortcut: 'mod+l',
    keywords: ['focus', 'chat', 'input', 'message', 'type'],

    execute: context => {
      context.focusChatInput()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  // Session board
  {
    id: 'show-session-board',
    label: 'Show Session Board',
    description: 'Show the session board for the current project',
    icon: LayoutGrid,
    group: 'navigation',
    keywords: ['session', 'board', 'sessions', 'overview', 'project'],

    execute: context => {
      const { selectedWorktreeId, selectProject, selectWorktree } =
        useProjectsStore.getState()

      // Get the worktree's project_id before clearing selection
      if (selectedWorktreeId) {
        const worktree = context.queryClient.getQueryData<Worktree>([
          ...projectsQueryKeys.all,
          'worktree',
          selectedWorktreeId,
        ])
        if (worktree?.project_id) {
          selectProject(worktree.project_id)
        }
      }

      useChatStore.getState().clearActiveWorktree()
      selectWorktree(null)
    },

    isAvailable: context =>
      context.hasActiveWorktree() || context.hasSelectedProject(),
  },
]
