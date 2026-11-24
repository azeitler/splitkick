import { confirmAction } from '@/components/ui/confirm-dialog'
import type { RemovalBehavior } from '@/types/preferences'

/**
 * Confirmations for destructive actions that have more than one UI entry
 * point. Each resolves `true` when the user confirms.
 *
 * Actions that agents start through MCP do not go through these: an agent has
 * no one to click a dialog.
 */

const quote = (name: string) => `“${name}”`

export function confirmMergePr(
  prNumber: number,
  worktreeName: string,
  removalBehavior: RemovalBehavior | undefined
) {
  const cleanup =
    removalBehavior === 'delete'
      ? 'then deletes the worktree folder and its branch'
      : 'then archives the worktree'
  return confirmAction({
    title: `Merge PR #${prNumber} of ${quote(worktreeName)}?`,
    description: `This merges the pull request on GitHub, ${cleanup}. You cannot undo the merge.`,
    confirmLabel: 'Merge PR',
  })
}

export function confirmRemoveProject(projectName: string) {
  return confirmAction({
    title: `Remove project ${quote(projectName)}?`,
    description:
      'This removes the project from the app and permanently deletes its archived worktrees, their sessions and its agents. The repository folder on disk stays.',
    confirmLabel: 'Remove Project',
  })
}

export function confirmRemoveAgent(agentName: string) {
  return confirmAction({
    title: `Remove agent ${quote(agentName)}?`,
    description:
      'The agent name and its role binding are deleted. Its session and history stay as a normal session.',
    confirmLabel: 'Remove Agent',
  })
}

export function confirmDeleteSchedule(scheduleName: string) {
  return confirmAction({
    title: `Delete schedule ${quote(scheduleName)}?`,
    description:
      'The scheduled prompt and its repeat rule are deleted. You cannot undo this.',
    confirmLabel: 'Delete',
  })
}

/** A short display name for a schedule: its name, else its prompt. */
export function scheduleDisplayName(schedule: {
  name?: string
  prompt: string
}): string {
  const text =
    (schedule.name?.trim() || schedule.prompt.trim()).split('\n')[0] ?? ''
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}
