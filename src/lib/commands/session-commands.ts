import {
  Plus,
  X,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Edit,
  RotateCcw,
} from 'lucide-react'
import type { AppCommand } from './types'

export const sessionCommands: AppCommand[] = [
  {
    id: 'new-session',
    label: 'New Session',
    description: 'Create a new chat session',
    icon: Plus,
    group: 'sessions',
    shortcut: 'mod+t',
    keywords: ['session', 'tab', 'new', 'create', 'chat'],

    execute: context => {
      context.createSession()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'close-session',
    label: 'Close Session',
    description: 'Close the current chat session',
    icon: X,
    group: 'sessions',
    shortcut: 'mod+w',
    keywords: ['session', 'tab', 'close', 'remove'],

    execute: context => {
      context.closeSession()
    },

    isAvailable: context => context.hasActiveSession(),
  },

  {
    id: 'next-session',
    label: 'Next Session',
    description: 'Switch to the next session tab',
    icon: ChevronRight,
    group: 'sessions',
    shortcut: 'mod+alt+arrowright',
    keywords: ['session', 'tab', 'next', 'switch', 'right'],

    execute: context => {
      context.nextSession()
    },

    isAvailable: context => context.hasActiveSession(),
  },

  {
    id: 'previous-session',
    label: 'Previous Session',
    description: 'Switch to the previous session tab',
    icon: ChevronLeft,
    group: 'sessions',
    shortcut: 'mod+alt+arrowleft',
    keywords: ['session', 'tab', 'previous', 'switch', 'left'],

    execute: context => {
      context.previousSession()
    },

    isAvailable: context => context.hasActiveSession(),
  },

  {
    id: 'clear-session-history',
    label: 'Clear Chat History',
    description: 'Clear all messages in the current session',
    icon: Trash2,
    group: 'sessions',
    keywords: ['clear', 'history', 'messages', 'reset', 'chat'],

    execute: async context => {
      await context.clearSessionHistory()
    },

    isAvailable: context => context.hasActiveSession(),
  },

  {
    id: 'rename-session',
    label: 'Rename Session',
    description: 'Rename the current session',
    icon: Edit,
    group: 'sessions',
    keywords: ['rename', 'session', 'title', 'name'],

    execute: context => {
      context.renameSession()
    },

    isAvailable: context => context.hasActiveSession(),
  },

  {
    id: 'resume-session',
    label: 'Resume Session',
    description: 'Reconnect to detached Claude CLI process',
    icon: RotateCcw,
    group: 'sessions',
    keywords: ['resume', 'session', 'reconnect', 'continue', 'attach'],

    execute: async context => {
      await context.resumeSession()
    },

    isAvailable: context => context.hasActiveSession(),
  },
]
