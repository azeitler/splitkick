import { FolderPlus, FolderGit, Bug, Keyboard } from 'lucide-react'
import type { AppCommand } from './types'
import { useUIStore } from '@/store/ui-store'

export const projectCommands: AppCommand[] = [
  {
    id: 'add-project',
    label: 'Add Project',
    description: 'Add an existing git repository as a project',
    icon: FolderPlus,
    group: 'projects',
    keywords: ['project', 'add', 'import', 'repository', 'git'],

    execute: context => {
      context.addProject()
    },
  },

  {
    id: 'init-project',
    label: 'Initialize Project',
    description: 'Create a new project from scratch',
    icon: FolderGit,
    group: 'projects',
    keywords: ['project', 'init', 'new', 'create', 'initialize'],

    execute: context => {
      context.initProject()
    },
  },

  {
    id: 'toggle-debug-mode',
    label: 'Toggle Debug Mode',
    description: 'Show/hide session debug panel',
    icon: Bug,
    group: 'settings',
    keywords: ['debug', 'developer', 'dev', 'panel', 'toggle'],

    execute: context => {
      context.toggleDebugMode()
    },
  },

  {
    id: 'help.feature-tour',
    label: 'Show Feature Tour',
    description: 'Learn essential keyboard shortcuts',
    icon: Keyboard,
    group: 'help',
    keywords: [
      'tour',
      'onboarding',
      'shortcuts',
      'keybindings',
      'help',
      'keyboard',
    ],

    execute: () => {
      useUIStore.getState().setFeatureTourOpen(true)
    },
  },
]
