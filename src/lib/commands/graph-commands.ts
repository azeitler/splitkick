import { Bot, PanelRight, Play, Workflow } from 'lucide-react'
import { toggleActiveSessionGraphPanel } from '@/lib/session-graph-panel'
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
    // Visible for every session: one without a graph link gets an
    // explanation instead of an empty panel (#84).
    id: 'graphs.toggle-session-panel',
    label: 'Toggle Graph Panel',
    description:
      "Show or hide the session's graph panel (desktop only; needs a graph link)",
    icon: PanelRight,
    group: 'sessions',
    keywords: ['graph', 'panel', 'node', 'serves', 'agent', 'toggle'],
    isAvailable: context => context.hasActiveSession(),
    execute: context => {
      toggleActiveSessionGraphPanel(context.queryClient)
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
