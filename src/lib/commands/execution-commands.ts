import { FileText, Hammer, Rocket, RefreshCw } from 'lucide-react'
import type { AppCommand } from './types'

export const executionCommands: AppCommand[] = [
  {
    id: 'execution-plan',
    label: 'Execution Mode: Plan',
    description:
      'Claude creates a plan and waits for approval before executing',
    icon: FileText,
    group: 'execution',
    keywords: ['execution', 'mode', 'plan', 'approve'],

    execute: context => {
      context.setExecutionMode('plan')
    },

    isAvailable: context =>
      context.hasActiveSession() &&
      context.getCurrentExecutionMode() !== 'plan',
  },

  {
    id: 'execution-build',
    label: 'Execution Mode: Build',
    description: 'Claude executes automatically without waiting for approval',
    icon: Hammer,
    group: 'execution',
    keywords: ['execution', 'mode', 'build', 'auto'],

    execute: context => {
      context.setExecutionMode('build')
    },

    isAvailable: context =>
      context.hasActiveSession() &&
      context.getCurrentExecutionMode() !== 'build',
  },

  {
    id: 'execution-yolo',
    label: 'Execution Mode: Yolo',
    description: 'Minimal planning, direct execution',
    icon: Rocket,
    group: 'execution',
    keywords: ['execution', 'mode', 'yolo', 'fast'],

    execute: context => {
      context.setExecutionMode('yolo')
    },

    isAvailable: context =>
      context.hasActiveSession() &&
      context.getCurrentExecutionMode() !== 'yolo',
  },

  {
    id: 'cycle-execution-mode',
    label: 'Cycle Execution Mode',
    description: 'Cycle through Plan, Build, and Yolo modes',
    icon: RefreshCw,
    group: 'execution',
    shortcut: 'shift+tab',
    keywords: ['execution', 'mode', 'cycle', 'toggle', 'switch'],

    execute: context => {
      context.cycleExecutionMode()
    },

    isAvailable: context => context.hasActiveSession(),
  },
]
