import { Archive, ArchiveRestore, FolderArchive } from 'lucide-react'
import type { AppCommand } from './types'

export const archiveCommands: AppCommand[] = [
  {
    id: 'archive-session',
    label: 'Archive Session',
    description: 'Archive the current session',
    icon: Archive,
    group: 'archive',
    keywords: ['archive', 'close', 'hide', 'session'],

    execute: () => {
      // Reuse existing close-session-or-worktree event which handles archiving
      window.dispatchEvent(new CustomEvent('close-session-or-worktree'))
    },

    isAvailable: context => context.hasActiveSession(),
  },

  {
    id: 'restore-last-archived',
    label: 'Restore Last Archived',
    description: 'Restore the most recently archived item',
    icon: ArchiveRestore,
    group: 'archive',
    shortcut: 'mod+shift+t',
    keywords: ['restore', 'undo', 'archive', 'reopen', 'last'],

    execute: context => {
      context.restoreLastArchived()
    },
  },

  {
    id: 'view-archived',
    label: 'View Archived',
    description: 'Browse all archived sessions and worktrees',
    icon: FolderArchive,
    group: 'archive',
    keywords: ['archived', 'browse', 'history', 'view', 'list'],

    execute: context => {
      context.openArchivedModal()
    },
  },
]
