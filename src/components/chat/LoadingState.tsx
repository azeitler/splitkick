import { useEffect, useState } from 'react'
import { AlertCircle, Hourglass, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWsConnectionStatus, usesWebSocketBackend } from '@/lib/transport'
import { cn } from '@/lib/utils'
import {
  SLOW_LOADING_MS,
  describeLoadingState,
  loadingPhase,
} from './loading-state'

interface LoadingStateProps {
  /** What loads, for example "session". */
  subject: string
  /** The load failed and has no data to show. */
  error?: unknown
  /** Omit when a retry cannot help (a code chunk that still downloads). */
  onRetry?: () => void
  /** Optional way out, for example back to the list. */
  onBack?: () => void
  className?: string
}

/**
 * The loading view for a session or project that may take long (#161).
 *
 * The slow timer starts when this mounts: give it a `key` per loaded object
 * so a new load starts a new timer. With reduced motion the spinner gives way
 * to a still hourglass; the text carries the state either way.
 */
export function LoadingState({
  subject,
  error,
  onRetry,
  onBack,
  className,
}: LoadingStateProps) {
  const [isSlow, setIsSlow] = useState(false)
  const wsConnected = useWsConnectionStatus()
  const connected = !usesWebSocketBackend() || wsConnected

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), SLOW_LOADING_MS)
    return () => clearTimeout(timer)
  }, [])

  const isError = error != null
  const phase = loadingPhase({ isError, isSlow })
  const copy = describeLoadingState({
    phase,
    subject,
    connected,
    errorMessage: isError
      ? error instanceof Error
        ? error.message
        : String(error)
      : null,
  })

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      data-testid="loading-state"
      data-phase={phase}
      className={cn(
        'pointer-events-auto flex flex-col items-center justify-center gap-2 px-6 text-center',
        className
      )}
    >
      {isError ? (
        <AlertCircle className="size-5 text-destructive" aria-hidden />
      ) : (
        <>
          <Loader2
            className="size-5 animate-spin text-muted-foreground motion-reduce:hidden"
            aria-hidden
          />
          <Hourglass
            className="hidden size-5 text-muted-foreground motion-reduce:block"
            aria-hidden
          />
        </>
      )}
      <div className="text-sm font-medium">{copy.title}</div>
      {copy.detail && (
        <div className="max-w-xs break-words text-xs text-muted-foreground">
          {copy.detail}
        </div>
      )}
      {((copy.showRetry && onRetry) || onBack) && (
        <div className="mt-1 flex gap-2">
          {onBack && (
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          )}
          {copy.showRetry && onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
