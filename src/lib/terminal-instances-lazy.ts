/**
 * `terminal-instances` behind a dynamic import, for code on the first-screen
 * path (services, global key handling). A static import there put xterm and
 * ghostty-web (266 KB gzipped) into every first load; now the terminal code
 * loads when a terminal is first used.
 */
import type * as TerminalInstances from '@/lib/terminal-instances'

const load = () => import('@/lib/terminal-instances')

export async function disposeTerminal(terminalId: string): Promise<void> {
  const terminal = await load()
  await terminal.disposeTerminal(terminalId)
}

export async function disposeAllWorktreeTerminals(
  worktreeId: string
): Promise<void> {
  const terminal = await load()
  terminal.disposeAllWorktreeTerminals(worktreeId)
}

export async function startHeadless(
  ...args: Parameters<typeof TerminalInstances.startHeadless>
): Promise<void> {
  const terminal = await load()
  terminal.startHeadless(...args)
}
