import { useMemo } from 'react'
import { useTerminalStore } from '@/store/terminal-store'
import { useTerminalListeningPorts } from '@/services/projects'
import type { TerminalPortInfo } from '@/services/projects'

export interface WorktreeTerminalStatus {
  hasRunningTerminal: boolean
  hasFailedTerminal: boolean
  showTerminalIndicator: boolean
  /** Lines to show in tooltip. null when no indicator to show. */
  tooltipLines: string[] | null
}

/**
 * Shared hook for per-worktree terminal status detection.
 * Tracks running/failed run-script terminals and discovered listening ports.
 */
export function useWorktreeTerminalStatus(
  worktreeId: string
): WorktreeTerminalStatus {
  const hasRunningTerminal = useTerminalStore(state => {
    const terminals = state.terminals[worktreeId] ?? []
    return terminals.some(
      t => !!t.command && state.runningTerminals.has(t.id)
    )
  })
  const hasFailedTerminal = useTerminalStore(state => {
    const terminals = state.terminals[worktreeId] ?? []
    return terminals.some(
      t => !!t.command && state.failedTerminals.has(t.id)
    )
  })
  const showTerminalIndicator = hasRunningTerminal || hasFailedTerminal

  // Poll for listening ports only when terminals are running
  const { data: listeningPorts = [] } =
    useTerminalListeningPorts(hasRunningTerminal)

  // Build tooltip lines on demand via getState() — no subscription needed
  // for tooltip content (stale-by-one-render is fine for hover-only UI)
  const tooltipLines = useMemo(() => {
    if (!showTerminalIndicator) return null
    const { terminals, runningTerminals, failedTerminals } =
      useTerminalStore.getState()
    const worktreeTerminals = terminals[worktreeId] ?? []
    const lines: string[] = []
    for (const t of worktreeTerminals) {
      if (!t.command) continue
      if (runningTerminals.has(t.id)) {
        const ports = (listeningPorts as TerminalPortInfo[])
          .filter(p => p.terminalId === t.id)
          .map(p => `:${p.port}`)
        const portSuffix = ports.length > 0 ? ` (${ports.join(', ')})` : ''
        lines.push(`${t.command}${portSuffix}`)
      } else if (failedTerminals.has(t.id)) {
        lines.push(`${t.command} (crashed)`)
      }
    }
    return lines
  }, [showTerminalIndicator, worktreeId, listeningPorts])

  return { hasRunningTerminal, hasFailedTerminal, showTerminalIndicator, tooltipLines }
}
