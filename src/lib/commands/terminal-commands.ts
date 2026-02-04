import { Terminal, Play } from 'lucide-react'
import type { AppCommand } from './types'

export const terminalCommands: AppCommand[] = [
  {
    id: 'open-terminal-panel',
    label: 'Open Terminal Panel',
    description: 'Open the embedded terminal panel',
    icon: Terminal,
    group: 'terminal',
    keywords: ['terminal', 'shell', 'console', 'panel', 'pty'],

    execute: context => {
      context.openTerminalPanel()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'run-script',
    label: 'Run Script',
    description: 'Run the configured script from jean.json',
    icon: Play,
    group: 'terminal',
    keywords: ['run', 'script', 'execute', 'jean', 'command'],

    execute: context => {
      context.runScript()
    },

    isAvailable: context =>
      context.hasActiveWorktree() && context.hasRunScript(),
  },
]
