import { ChevronLeft, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HomeSessionEntry } from '@/components/home/home-utils'
import { RecentSessionRow } from '@/components/home/RecentSessionsSection'
import type { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'

/**
 * The frame of one tab: a large title, then content that scrolls on its own.
 *
 * The bottom padding keeps the last row clear of the floating tab bar, which
 * sits over the content rather than beside it. `action` sits at the right of
 * the title (Home's Settings button); `onBack` puts a back chevron before it,
 * for a page pushed over a tab.
 */
export function MobileTabPage({
  title,
  testId,
  action,
  onBack,
  children,
}: {
  title: string
  testId: string
  action?: React.ReactNode
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain font-sans"
      data-testid={testId}
    >
      <div className="flex flex-col gap-6 px-4 pt-4 pb-[calc(var(--safe-area-bottom)+6rem)]">
        <div className="flex items-center gap-1">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-3 size-11 shrink-0 text-muted-foreground"
              aria-label="Back"
              onClick={onBack}
            >
              <ChevronLeft className="size-6" />
            </Button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-3xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {action}
        </div>
        {children}
      </div>
    </div>
  )
}

/** A titled group within a tab. */
export function MobileTabSection({
  title,
  children,
  className,
}: {
  title?: string | null
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title && (
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

/**
 * Session rows, the same component Home uses on the desktop, so a session
 * reads and opens the same way everywhere.
 */
export function MobileSessionList({
  rows,
  storeState,
  testId,
}: {
  rows: readonly HomeSessionEntry[]
  storeState: ReturnType<typeof useCanvasStoreState>
  testId: string
}) {
  return (
    <ul
      className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border bg-muted/20"
      data-testid={testId}
    >
      {rows.map(row => (
        <RecentSessionRow
          key={row.session.id}
          row={row}
          storeState={storeState}
        />
      ))}
    </ul>
  )
}

/** What a tab shows when it has nothing to list. */
export function MobileEmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
