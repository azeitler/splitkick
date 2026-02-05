import { FolderPlus, FolderGit, Bug } from 'lucide-react'
import type { AppCommand } from './types'

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
]
