import { useEffect, useState } from 'react'
import { AlertCircle, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
  /**
   * `page`: a whole screen (header, body, composer), opaque, takes every tap.
   * `inline`: the body only, inside a view that has its own header.
   */
  layout?: 'page' | 'inline'
  /** The shape of the body: chat messages or a list of rows. */
  body?: 'messages' | 'list'
  className?: string
}

/** Chat messages: the user's on the right, the assistant's on the left. */
function MessagesSkeleton() {
  return (
    <div className="flex w-full flex-col gap-5" aria-hidden>
      <Skeleton className="ml-auto h-9 w-3/5 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <Skeleton className="ml-auto h-9 w-2/5 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3" aria-hidden>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className={cn('h-4', i % 2 ? 'w-1/2' : 'w-2/3')} />
        </div>
      ))}
    </div>
  )
}

/**
 * The loading view for a session or project that may take long (#161).
 *
 * A skeleton of the view while it loads, with the state in words below it.
 * After `SLOW_LOADING_MS` the words explain the wait and offer Retry; a failed
 * load replaces the skeleton with the error. The slow timer starts when this
 * mounts: give it a `key` per loaded object so a new load starts a new timer.
 */
export function LoadingState({
  subject,
  error,
  onRetry,
  onBack,
  layout = 'inline',
  body = 'messages',
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
  const isPage = layout === 'page'

  const status = (
    <div className="flex flex-col items-center gap-2 text-center">
      {isError && (
        <AlertCircle className="size-5 text-destructive" aria-hidden />
      )}
      <div
        className={cn(
          'text-sm',
          isError ? 'font-medium' : 'text-muted-foreground'
        )}
      >
        {copy.title}
      </div>
      {copy.detail && (
        <div className="max-w-xs break-words text-xs text-muted-foreground">
          {copy.detail}
        </div>
      )}
      {copy.showRetry && (onRetry || (!isPage && onBack)) && (
        <div className="mt-1 flex gap-2">
          {!isPage && onBack && (
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
          )}
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      data-testid="loading-state"
      data-phase={phase}
      className={cn(
        'pointer-events-auto flex w-full flex-col',
        isPage && 'h-full bg-background',
        className
      )}
    >
      {isPage && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 text-muted-foreground"
              aria-label="Back"
              onClick={onBack}
            >
              <ChevronLeft className="size-5" />
            </Button>
          ) : null}
          {!isError && <Skeleton className="h-4 w-32" aria-hidden />}
        </div>
      )}
      <div
        className={cn(
          'flex flex-col gap-8 px-4 py-6',
          isPage && 'min-h-0 flex-1',
          isError && 'flex-1 items-center justify-center'
        )}
      >
        {!isError &&
          (body === 'list' ? <ListSkeleton /> : <MessagesSkeleton />)}
        {status}
      </div>
      {isPage && !isError && body === 'messages' && (
        <div className="shrink-0 border-t px-4 py-3" aria-hidden>
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}
