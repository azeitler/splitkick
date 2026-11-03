import { Bot, Play, Workflow } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import type { AppCommand } from './types'

/** Graph layer entries (docs/developer/graph-layer.md). */
export const graphCommands: AppCommand[] = [
  {
    id: 'graphs.new',
    label: 'New Graph…',
    description: 'Create a graph file (roadmap, release, …)',
    icon: Workflow,
    group: 'projects',
    keywords: ['graph', 'roadmap', 'new', 'create', 'plan'],
    execute: () => {
      useUIStore.getState().setNewGraphDialogOpen(true)
    },
  },
  {
    id: 'graphs.start-agent-session',
    label: 'Start Session from Agent…',
    description: 'Start a session from a saved agent profile',
    icon: Play,
    group: 'sessions',
    keywords: ['agent', 'session', 'start', 'persona', 'graph'],
    execute: () => {
      useUIStore.getState().setStartAgentSessionTarget({})
    },
  },
  {
    id: 'graphs.edit-agents',
    label: 'Edit Agents…',
    description: 'Open Settings → Agents',
    icon: Bot,
    group: 'settings',
    keywords: ['agent', 'persona', 'profile', 'settings', 'permission'],
    execute: () => {
      useUIStore.getState().openAgentEditor(null)
    },
  },
]
