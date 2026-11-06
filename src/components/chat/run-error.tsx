import { CircleAlert } from 'lucide-react'
import type { RunError } from '@/types/chat'
import { isCliAuthError } from '@/lib/cli-auth'

/** True when the run failed because the backend login expired. */
export function isRunAuthError(error: RunError): boolean {
  return isCliAuthError(error.message)
}

/** Short title for a failed run — "Login expired", "Request failed", … */
export function getRunErrorTitle(error: RunError): string {
  if (isRunAuthError(error)) return 'Login expired'
  switch (error.kind) {
    case 'aborted':
      return 'Message not sent'
    case 'crashed':
      return 'Run stopped unexpectedly'
    default:
      return 'Request failed'
  }
}

/** "Request failed: API Error: 500 …", shortened for tooltips. */
export function formatRunError(error: RunError): string {
  const title = getRunErrorTitle(error)
  const message = error.message.trim()
  if (!message) return title
  const short = message.length > 200 ? `${message.slice(0, 200)}…` : message
  return `${title}: ${short}`
}

/** The small red alert that marks a session whose last run failed. */
export function RunErrorGlyph({ error }: { error: RunError }) {
  const label = formatRunError(error)
  return (
    <CircleAlert
      data-testid="run-error-glyph"
      aria-label={label}
      className="size-3 shrink-0 text-destructive"
    >
      <title>{label}</title>
    </CircleAlert>
  )
}
