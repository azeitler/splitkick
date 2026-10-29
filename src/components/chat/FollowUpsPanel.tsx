import { memo, useEffect, useRef, useState } from 'react'
import {
  Check,
  CornerDownLeft,
  GripVertical,
  ListPlus,
  Pencil,
  X,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { isImeComposingEvent } from '@/lib/ime-composition'
import type { FollowUp, FollowUpOp } from '@/types/chat'
import type { FollowUpsPlacement } from './follow-ups-placement'

interface FollowUpsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: FollowUp[]
  /** Queue is offered only while a run is active; an idle session would send at once. */
  isSessionBusy: boolean
  onEdit: (op: FollowUpOp) => Promise<boolean>
  /** Put the text into the composer. */
  onUse: (item: FollowUp) => void
  /** Move the item into the message queue. */
  onQueue: (item: FollowUp) => void
  /** Desktop only: in the side column beside the chat, or above the composer. */
  placement?: FollowUpsPlacement
}

/** Ids in the new order after moving `id` to the place of `targetId`. */
export function moveFollowUp(
  items: FollowUp[],
  id: string,
  targetId: string
): string[] {
  const ids = items.map(item => item.id)
  const from = ids.indexOf(id)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return ids
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  return ids
}

const iconButton =
  'rounded p-2 md:p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'

/**
 * Follow-up list (#46): notes for future turns, never sent automatically.
 * On desktop it sits beside the chat column when there is room (#66) and
 * floats above the composer otherwise; on phones it is a bottom sheet.
 */
export const FollowUpsPanel = memo(function FollowUpsPanel(
  props: FollowUpsPanelProps
) {
  const isMobile = useIsMobile()
  const { open, onOpenChange, placement = 'above' } = props

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[75svh] min-h-0 flex-col overflow-hidden rounded-t-xl p-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
          showCloseButton={false}
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <SheetTitle className="text-base">Follow-ups</SheetTitle>
            <SheetDescription className="sr-only">
              Notes for later turns. They are never sent automatically.
            </SheetDescription>
          </SheetHeader>
          <FollowUpList {...props} isMobile />
        </SheetContent>
      </Sheet>
    )
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Follow-ups"
      data-placement={placement}
      onKeyDown={e => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          onOpenChange(false)
        }
      }}
      className={cn(
        'flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md',
        placement === 'above' && 'absolute right-0 bottom-full z-20 mb-2'
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium">Follow-ups</span>
        <button
          type="button"
          aria-label="Close follow-ups"
          onClick={() => onOpenChange(false)}
          className={iconButton}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <FollowUpList {...props} isMobile={false} />
    </div>
  )
})

function FollowUpList({
  items,
  isSessionBusy,
  onEdit,
  onUse,
  onQueue,
  isMobile,
}: FollowUpsPanelProps & { isMobile: boolean }) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  // The add-follow-up shortcut also targets an already open list.
  useEffect(() => {
    const focus = () => addInputRef.current?.focus()
    window.addEventListener('focus-follow-up-input', focus)
    return () => window.removeEventListener('focus-follow-up-input', focus)
  }, [])

  const hasDone = items.some(item => item.done)

  const add = async () => {
    const text = draft.trim()
    if (!text) return
    if (await onEdit({ kind: 'add', text })) setDraft('')
  }

  const saveEditing = async () => {
    const text = editingText.trim()
    if (!editingId || !text) return
    if (await onEdit({ kind: 'update', id: editingId, text })) {
      setEditingId(null)
    }
  }

  const moveBy = (index: number, delta: number) => {
    const target = items[index + delta]
    const item = items[index]
    if (!target || !item) return
    void onEdit({
      kind: 'reorder',
      ids: moveFollowUp(items, item.id, target.id),
    })
  }

  return (
    <>
      <div
        role="list"
        aria-label="Follow-up items"
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {items.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Notes for later turns. They are never sent automatically.
          </p>
        )}
        {items.map((item, index) => {
          const isEditing = editingId === item.id
          return (
            <div
              key={item.id}
              role="listitem"
              tabIndex={0}
              aria-label={item.text}
              draggable={!isMobile && !isEditing}
              onDragStart={e => {
                setDragId(item.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={e => {
                if (dragId) e.preventDefault()
              }}
              onDrop={e => {
                e.preventDefault()
                if (dragId && dragId !== item.id) {
                  void onEdit({
                    kind: 'reorder',
                    ids: moveFollowUp(items, dragId, item.id),
                  })
                }
                setDragId(null)
              }}
              onDragEnd={() => setDragId(null)}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return
                if (e.altKey && e.key === 'ArrowUp') {
                  e.preventDefault()
                  moveBy(index, -1)
                } else if (e.altKey && e.key === 'ArrowDown') {
                  e.preventDefault()
                  moveBy(index, 1)
                }
              }}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1 text-xs outline-none hover:bg-muted/30 focus-visible:bg-muted/60',
                dragId === item.id && 'opacity-50'
              )}
            >
              {!isMobile && (
                <GripVertical
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50"
                />
              )}
              <input
                type="checkbox"
                aria-label={item.done ? 'Mark as open' : 'Mark as done'}
                checked={item.done}
                onChange={() =>
                  void onEdit({ kind: 'update', id: item.id, done: !item.done })
                }
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
              {isEditing ? (
                <input
                  aria-label="Follow-up text"
                  value={editingText}
                  onChange={e => setEditingText(e.target.value)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (isImeComposingEvent(e)) return
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingId(null)
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      void saveEditing()
                    }
                  }}
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />
              ) : (
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words',
                    item.done && 'text-muted-foreground line-through'
                  )}
                >
                  {item.text}
                </span>
              )}
              <div
                className={cn(
                  'flex shrink-0 items-center gap-0.5 transition-opacity',
                  !isEditing &&
                    '[@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:group-hover:opacity-100 [@media(pointer:fine)]:group-focus-within:opacity-100'
                )}
              >
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      aria-label="Save follow-up"
                      disabled={!editingText.trim()}
                      onClick={() => void saveEditing()}
                      className={cn(iconButton, 'disabled:opacity-40')}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel edit"
                      onClick={() => setEditingId(null)}
                      className={iconButton}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <ActionButton
                      label="Use in message"
                      onClick={() => onUse(item)}
                    >
                      <CornerDownLeft className="h-3.5 w-3.5" />
                    </ActionButton>
                    {isSessionBusy && (
                      <ActionButton
                        label="Queue for after this turn"
                        onClick={() => onQueue(item)}
                      >
                        <ListPlus className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                    <ActionButton
                      label="Edit follow-up"
                      onClick={() => {
                        setEditingId(item.id)
                        setEditingText(item.text)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ActionButton
                      label="Delete follow-up"
                      onClick={() =>
                        void onEdit({ kind: 'remove', id: item.id })
                      }
                      destructive
                    >
                      <X className="h-3.5 w-3.5" />
                    </ActionButton>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-2">
        <input
          ref={addInputRef}
          aria-label="New follow-up"
          placeholder="Add a follow-up…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (isImeComposingEvent(e)) return
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
          autoFocus={!isMobile}
          className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {hasDone && (
          <button
            type="button"
            onClick={() => void onEdit({ kind: 'clear_done' })}
            className="shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Clear done
          </button>
        )}
      </div>
    </>
  )
}

function ActionButton({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            iconButton,
            destructive && 'hover:bg-destructive hover:text-white'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
