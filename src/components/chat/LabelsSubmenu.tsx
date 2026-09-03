import { Tag } from 'lucide-react'
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { useChatStore } from '@/store/chat-store'
import {
  getKnownLabels,
  isLabelSelected,
  toggleLabelInList,
} from '@/lib/labels'
import type { LabelData } from '@/types/chat'

interface LabelsSubmenuBaseProps {
  /** Every selectable label, already resolved (color + pinned). Order kept. */
  labels: LabelData[]
  /** Submenu trigger text. */
  triggerLabel?: string
  /** Opens the label modal. The footer item is hidden when this is absent. */
  onManage?: () => void
  /** Footer item text. */
  manageLabel?: string
  disabled?: boolean
  /** Width class for the sub content. */
  contentClassName?: string
}

export type LabelsSubmenuProps =
  | (LabelsSubmenuBaseProps & {
      mode: 'single'
      selected: LabelData | null
      /** `null` clears the label. The menu closes after the pick. */
      onSelect: (label: LabelData | null) => void
    })
  | (LabelsSubmenuBaseProps & {
      mode: 'multi'
      selected: LabelData[]
      /** The full next list after the toggle. The menu stays open. */
      onChange: (next: LabelData[]) => void
    })

/**
 * Context-menu submenu that applies and removes labels in one click.
 *
 * It holds no store, does no async work and knows no query keys — it reports
 * the result and the host writes it. Creating a label, changing its color,
 * pinning it and deleting it stay in `LabelModal`, reached through the
 * "Manage labels…" footer item.
 *
 * In multi mode `onSelect` calls `preventDefault()`. Radix skips its close
 * handler on a prevented `menu.itemSelect`, but `MenuCheckboxItem` composes our
 * handler with `checkForDefaultPrevented: false`, so `onCheckedChange` still
 * fires. That combination keeps the menu open across several toggles.
 */
export function LabelsSubmenu(props: LabelsSubmenuProps) {
  const {
    labels,
    triggerLabel = 'Labels',
    onManage,
    manageLabel = 'Manage labels…',
    disabled = false,
    contentClassName = 'w-52',
  } = props

  const isMulti = props.mode === 'multi'
  const selectedLabels = isMulti
    ? props.selected
    : props.selected
      ? [props.selected]
      : []

  const apply = (label: LabelData, checked: boolean) => {
    if (props.mode === 'multi') {
      props.onChange(toggleLabelInList(props.selected, label))
      return
    }
    // Re-picking the applied label clears it. `setSessionLabel` ignores an
    // identical value, so the caller must receive `null` here.
    props.onSelect(checked ? label : null)
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <Tag className="mr-2 h-4 w-4" />
        {triggerLabel}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className={contentClassName}>
        <ContextMenuCheckboxItem
          checked={selectedLabels.length === 0}
          onSelect={isMulti ? event => event.preventDefault() : undefined}
          onCheckedChange={() => {
            if (props.mode === 'multi') props.onChange([])
            else props.onSelect(null)
          }}
        >
          <span className="flex-1 truncate text-muted-foreground">
            {isMulti ? 'No labels' : 'No label'}
          </span>
        </ContextMenuCheckboxItem>
        {labels.length > 0 && <ContextMenuSeparator />}
        {labels.map(label => {
          const checked = isLabelSelected(selectedLabels, label.name)
          return (
            <ContextMenuCheckboxItem
              key={label.name}
              checked={checked}
              onSelect={isMulti ? event => event.preventDefault() : undefined}
              onCheckedChange={next => apply(label, next)}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="flex-1 truncate">{label.name}</span>
            </ContextMenuCheckboxItem>
          )
        })}
        {onManage && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem inset onSelect={onManage}>
              {manageLabel}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

interface SessionLabelsSubmenuProps {
  sessionId: string
  /** Pass `card.label` — it already reads the same store entry. */
  currentLabel: LabelData | null
  /** Opens the label modal. The "Manage labels…" item hides when absent. */
  onManage?: () => void
}

/** Store-connected `LabelsSubmenu` for a single session label. */
export function SessionLabelsSubmenu({
  sessionId,
  currentLabel,
  onManage,
}: SessionLabelsSubmenuProps) {
  const sessionLabels = useChatStore(state => state.sessionLabels)
  const labels = getKnownLabels({
    sessionLabels,
    selected: currentLabel ? [currentLabel] : [],
  })

  return (
    <LabelsSubmenu
      mode="single"
      labels={labels}
      selected={currentLabel}
      onSelect={label =>
        useChatStore.getState().setSessionLabel(sessionId, label)
      }
      onManage={onManage}
    />
  )
}
