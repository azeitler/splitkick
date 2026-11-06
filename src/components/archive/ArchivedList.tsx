import { useCallback, useRef, type KeyboardEvent } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { ArchivedRow, type ArchivedRowActions } from './ArchivedRow'
import type { ArchivedGroup, ArchivedItem } from './archived-items'

interface ArchivedListProps extends ArchivedRowActions {
  groups: ArchivedGroup[]
  /** Rows in display order, for the keyboard cursor */
  rows: ArchivedItem[]
  selectedKeys: ReadonlySet<string>
  activeKey: string | null
  busy: boolean
  snippets: ReadonlyMap<string, string>
  /** Arrows, Space, Enter and Delete. Native desktop only. */
  keyboard: boolean
}

/**
 * The sections and rows. With `keyboard`, the arrows move a cursor, Space
 * selects, Enter restores and opens, Delete asks to delete.
 */
export function ArchivedList({
  groups,
  rows,
  selectedKeys,
  activeKey,
  busy,
  snippets,
  keyboard,
  ...actions
}: ArchivedListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const { onFocus, onToggleSelect, onRestoreAndOpen, onDelete } = actions

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Only keys pressed on a row itself; buttons and menus keep theirs.
      const target = event.target as HTMLElement
      if (target.getAttribute('role') !== 'option') return
      const index = rows.findIndex(row => row.key === activeKey)
      const active = rows[index]
      const moveTo = (next: number) => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, next))]
        if (!row) return
        event.preventDefault()
        listRef.current
          ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.key)}"]`)
          ?.focus()
      }
      switch (event.key) {
        case 'ArrowDown':
          moveTo(index + 1)
          return
        case 'ArrowUp':
          moveTo(index - 1)
          return
        case 'Home':
          moveTo(0)
          return
        case 'End':
          moveTo(rows.length - 1)
          return
      }
      if (!active) return
      if (event.key === ' ') {
        event.preventDefault()
        onToggleSelect(active)
      } else if (event.key === 'Enter' && !busy) {
        event.preventDefault()
        onRestoreAndOpen(active)
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !busy
      ) {
        event.preventDefault()
        onDelete(active)
      }
    },
    [rows, activeKey, busy, onToggleSelect, onRestoreAndOpen, onDelete]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        role="listbox"
        aria-label="Archived items"
        aria-multiselectable
        onKeyDown={keyboard ? handleKeyDown : undefined}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {groups.map(group => (
          <section
            key={group.key}
            aria-label={group.label || undefined}
            className="pb-3"
          >
            {group.label && (
              <h2 className="sticky top-0 z-10 bg-background px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {group.items.length}
                </span>
              </h2>
            )}
            {group.items.map(item => (
              <ArchivedRow
                key={item.key}
                item={item}
                selected={selectedKeys.has(item.key)}
                active={item.key === activeKey}
                disabled={busy}
                snippet={snippets.get(item.id)}
                {...actions}
                onFocus={onFocus}
              />
            ))}
          </section>
        ))}
      </div>
      {keyboard && rows.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t px-3 pt-2 text-xs text-muted-foreground">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Space</Kbd> select
          </span>
          <span>
            <Kbd>Enter</Kbd> restore and open
          </span>
          <span>
            <Kbd>Delete</Kbd> delete
          </span>
        </div>
      )}
    </div>
  )
}
