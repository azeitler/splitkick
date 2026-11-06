import { memo } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RunError } from '@/types/chat'
import { getRunErrorTitle, isRunAuthError } from './run-error'

interface RunErrorBannerProps {
  error: RunError
  /** Sends "continue" so the agent picks up where it stopped */
  onResume: () => void
  /** Focuses the composer so the user can write their own follow-up */
  onResumeWithMessage: () => void
  /** Sends the aborted message again */
  onRetry: (message: string) => void
  /** Opens the backend login flow */
  onLogin: () => void
}

/**
 * Shown when the last run ended with an error (API error, aborted send,
 * crash). Goes away once a new run starts.
 */
export const RunErrorBanner = memo(function RunErrorBanner({
  error,
  onResume,
  onResumeWithMessage,
  onRetry,
  onLogin,
}: RunErrorBannerProps) {
  const retryMessage = error.retry_message
  let actions
  if (isRunAuthError(error)) {
    actions = (
      <>
        <Button size="sm" variant="outline" onClick={onResume}>
          Resume
        </Button>
        <Button size="sm" onClick={onLogin}>
          Log in
        </Button>
      </>
    )
  } else if (error.kind === 'aborted') {
    actions = (
      <>
        <Button size="sm" variant="outline" onClick={onResumeWithMessage}>
          Edit message
        </Button>
        {retryMessage && (
          <Button size="sm" onClick={() => onRetry(retryMessage)}>
            Retry
          </Button>
        )}
      </>
    )
  } else {
    actions = (
      <>
        <Button size="sm" variant="outline" onClick={onResumeWithMessage}>
          Resume with message
        </Button>
        <Button size="sm" onClick={onResume}>
          Resume
        </Button>
      </>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-2 md:px-6">
      <div
        data-testid="run-error-banner"
        className="flex flex-wrap items-center gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <CircleAlert className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{getRunErrorTitle(error)}</p>
          {error.message.trim() && (
            <p className="mt-0.5 line-clamp-3 select-text break-words text-destructive/80">
              {error.message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">{actions}</div>
      </div>
    </div>
  )
})
