import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import type { MobileProjectSegment } from '@/types/ui-state'

const SEGMENTS: { id: MobileProjectSegment; label: string }[] = [
  { id: 'worktrees', label: 'Worktrees' },
  { id: 'recent', label: 'Recent' },
]

/**
 * The Worktrees / Recent switch of a project on the phone, the counterpart of
 * the desktop sidebar's Projects / Recent tabs.
 *
 * Recent puts the project's latest sessions one tap away instead of above a
 * long worktree list. Same look as the phone Home tab's switch.
 */
export function MobileProjectSegments() {
  const segment = useUIStore(state => state.mobileProjectSegment)

  return (
    <div
      role="tablist"
      aria-label="Project"
      data-testid="mobile-project-segments"
      className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1"
    >
      {SEGMENTS.map(({ id, label }) => {
        const selected = id === segment
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`mobile-project-segment-${id}`}
            onClick={() => useUIStore.getState().setMobileProjectSegment(id)}
            className={cn(
              'h-10 rounded-full text-sm font-medium transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground active:bg-background/60'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
