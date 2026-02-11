import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chat-store'
import { AlertTriangle } from 'lucide-react'

interface ChatErrorFallbackProps {
  error: Error
  resetErrorBoundary: () => void
  activeWorktreeId?: string
}

export function ChatErrorFallback({
  error,
  resetErrorBoundary,
  activeWorktreeId,
}: ChatErrorFallbackProps) {
  const handleSwitchToCanvas = useCallback(() => {
    if (activeWorktreeId) {
      useChatStore.getState().setViewingCanvasTab(activeWorktreeId, true)
    }
    resetErrorBoundary()
  }, [activeWorktreeId, resetErrorBoundary])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="h-8 w-8 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">
          Something went wrong
        </span>
        <span className="text-xs text-muted-foreground max-w-sm">
          This session encountered a rendering error. You can try again, switch
          to the session overview, or reload the page.
        </span>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={resetErrorBoundary}>
          Try Again
        </Button>
        {activeWorktreeId && (
          <Button variant="outline" size="sm" onClick={handleSwitchToCanvas}>
            Session Overview
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>

      <details className="mt-2 w-full max-w-lg text-left">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Error details (for bug reports)
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded border bg-muted p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      </details>
    </div>
  )
}
