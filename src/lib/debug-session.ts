/**
 * "Debug in new Session" for failed worktree setup and run scripts (#143).
 *
 * Failures surface in places that have no React hooks of their own (toast
 * actions, terminal listeners), so a button only dispatches a DOM event.
 * `useDebugSessionListener` (mounted once in MainWindow) creates the session
 * and sends the prompt built here.
 */

export type DebugFailureKind = 'setup-script' | 'worktree-create' | 'run-script'

export interface DebugSessionRequest {
  kind: DebugFailureKind
  /** Worktree to debug in. Omit when the worktree does not exist. */
  worktreeId?: string
  /** Fallback when there is no worktree: debug in the project's base session. */
  projectId?: string
  /** Script or command that failed. */
  command?: string | null
  /** Directory the failure happened in. */
  workdir?: string | null
  /** Exit code, signal or error summary. */
  exitLabel?: string | null
  /** Raw output / error text. ANSI codes and size are handled here. */
  output: string
}

export const DEBUG_SESSION_EVENT = 'debug-in-new-session'

/** Max characters of output put into the prompt (the tail is kept). */
export const DEBUG_OUTPUT_MAX_CHARS = 12000

export function requestDebugSession(request: DebugSessionRequest): void {
  window.dispatchEvent(
    new CustomEvent<DebugSessionRequest>(DEBUG_SESSION_EVENT, {
      detail: request,
    })
  )
}

// CSI sequences (colors, cursor moves) and OSC sequences (titles, links).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export function cleanDebugOutput(
  output: string,
  maxChars = DEBUG_OUTPUT_MAX_CHARS
): string {
  const text = output
    .replace(ANSI_RE, '')
    .replace(/\r\n/g, '\n')
    // A bare \r redraws the line (progress bars): keep only the final state.
    .split('\n')
    .map(line => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n')
    .trim()
  if (text.length <= maxChars) return text
  return `[… ${text.length - maxChars} earlier characters cut …]\n${text.slice(-maxChars)}`
}

const KIND_LABELS: Record<DebugFailureKind, string> = {
  'setup-script': 'The worktree setup script failed',
  'worktree-create': 'Creating a worktree failed',
  'run-script': 'The run script failed',
}

const SESSION_NAMES: Record<DebugFailureKind, string> = {
  'setup-script': 'Debug setup script',
  'worktree-create': 'Debug worktree creation',
  'run-script': 'Debug run script',
}

export function debugSessionName(kind: DebugFailureKind): string {
  return SESSION_NAMES[kind]
}

export function buildDebugPrompt(request: DebugSessionRequest): string {
  const lines = [
    `${KIND_LABELS[request.kind]}. Find the root cause and fix it.`,
    '',
  ]
  if (request.command) lines.push(`Command: \`${request.command}\``)
  if (request.workdir) lines.push(`Working directory: \`${request.workdir}\``)
  if (request.exitLabel) lines.push(`Result: ${request.exitLabel}`)
  const output = cleanDebugOutput(request.output)
  // Fence must be longer than any backtick run in the log.
  const longestRun = Math.max(
    2,
    ...(output.match(/`+/g) ?? []).map(run => run.length)
  )
  const fence = '`'.repeat(longestRun + 1)
  lines.push(
    '',
    'Output:',
    fence,
    output || '(no output)',
    fence,
    '',
    'Explain what went wrong, then fix it. If the fix is in the script or project configuration (splitkick.json or jean.json), change it there.'
  )
  return lines.join('\n')
}
