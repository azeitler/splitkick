import { Bot, Link2, PanelLeft, Play, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { openLinkToGraph } from '@/lib/link-to-graph'
import {
  getActiveSessionFromCache,
  toggleActiveSessionGraphPanel,
} from '@/lib/session-graph-panel'
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
    // Visible for every session: one without a graph link gets the tab's
    // explanation and "Link to Graph…" (#84, #98).
    id: 'graphs.toggle-session-panel',
    label: 'Toggle Graph Panel',
    description: "Show or hide the session's graph in the left panel",
    icon: PanelLeft,
    group: 'sessions',
    keywords: ['graph', 'panel', 'node', 'serves', 'agent', 'toggle'],
    isAvailable: context => context.hasActiveSession(),
    execute: context => {
      toggleActiveSessionGraphPanel(context.queryClient)
    },
  },
  {
    // Every session, linked or not (#88).
    id: 'graphs.link-session',
    label: 'Link to Graph…',
    description: 'Link the session to a graph node or a whole graph',
    icon: Link2,
    group: 'sessions',
    keywords: ['graph', 'link', 'serves', 'node', 'roadmap', 'connect'],
    isAvailable: context => context.hasActiveSession(),
    execute: context => {
      const session = getActiveSessionFromCache(context.queryClient)
      if (!session) {
        toast.info('Open a session to link it to a graph.')
        return
      }
      openLinkToGraph(session)
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
