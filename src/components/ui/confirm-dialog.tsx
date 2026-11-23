import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Name the object: `Delete session "Acme"?` */
  title: ReactNode
  /** One sentence of consequence. */
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  onConfirm: () => void
  /** Red confirm button. Default true. */
  destructive?: boolean
  /** Keep the dialog open after confirm (the caller closes it when done). */
  closeOnConfirm?: boolean
  confirmDisabled?: boolean
  /** Extra content below the description (options, lists). */
  children?: ReactNode
  contentClassName?: string
}

const isTextEntry = (el: EventTarget | null) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable)

/**
 * Keyboard and focus rules of every destructive confirmation. Spread
 * `contentProps` on `AlertDialogContent`, put `confirmRef` on the confirm
 * button and `cancelRef` on the cancel button.
 *
 * - The confirm button gets focus, so Return confirms. Esc cancels.
 * - Keys that were already down when the dialog opened are ignored: the key
 *   press that opened it cannot also confirm, nor can auto-repeat.
 * - `confirm()` runs `onConfirm` at most once per opening.
 */
export function useConfirmKeyboard({
  open,
  onConfirm,
  disabled = false,
}: {
  open: boolean
  onConfirm: () => void
  disabled?: boolean
}) {
  // `open` may also be one step of a larger dialog (the final approval).
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // A key counts only after its keydown reached the open dialog.
  const freshKeyRef = useRef(false)
  const firedRef = useRef(false)

  useEffect(() => {
    if (open) {
      freshKeyRef.current = false
      firedRef.current = false
      // A step inside an already open dialog (no onOpenAutoFocus) still
      // moves focus to its confirm button.
      confirmRef.current?.focus()
    }
  }, [open])

  // A busy action that ends with the dialog still open may be confirmed again.
  useEffect(() => {
    if (!disabled) firedRef.current = false
  }, [disabled])

  const confirm = () => {
    if (firedRef.current || disabled) return
    firedRef.current = true
    onConfirm()
  }
  /** Allow one more confirm (for dialogs that stay open on failure). */
  const rearm = () => {
    firedRef.current = false
  }

  const contentProps = {
    'data-confirm-dialog': '',
    onOpenAutoFocus: (e: Event) => {
      if (!confirmRef.current) return
      e.preventDefault()
      confirmRef.current.focus()
    },
    // Do not let Esc reach window-level handlers (close modal, cancel run).
    onEscapeKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
    onKeyDownCapture: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (open && !e.repeat) freshKeyRef.current = true
    },
    // Key presses that began before the dialog opened must not activate the
    // focused confirm button (WebKit: keypress; Space: keyup).
    onKeyPressCapture: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (open && !freshKeyRef.current) e.preventDefault()
    },
    onKeyUpCapture: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (open && !freshKeyRef.current) e.preventDefault()
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!open) return
      // The dialog is portalled, but React still bubbles its keys to the
      // component that rendered it (list/modal shortcuts). Keep them here.
      e.stopPropagation()
      if (e.key !== 'Enter') return
      if (e.target === cancelRef.current || isTextEntry(e.target)) return
      // Other buttons (a close X, a link) keep their own Enter.
      if (
        e.target instanceof HTMLButtonElement &&
        e.target !== confirmRef.current
      )
        return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat || e.nativeEvent.isComposing) return
      confirm()
    },
  }

  return { contentProps, confirmRef, cancelRef, confirm, rearm }
}

/**
 * The one confirmation dialog for destructive actions. See
 * `useConfirmKeyboard` for the keyboard rules.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  destructive = true,
  closeOnConfirm = true,
  confirmDisabled = false,
  children,
  contentClassName,
}: ConfirmDialogProps) {
  const { contentProps, confirmRef, cancelRef, confirm, rearm } =
    useConfirmKeyboard({
      open,
      disabled: confirmDisabled,
      onConfirm: () => {
        onConfirm()
        if (closeOnConfirm) onOpenChange(false)
        else rearm()
      },
    })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={contentClassName} {...contentProps}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">
              Confirm or cancel.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} data-confirm-cancel="">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            data-confirm-action=""
            disabled={confirmDisabled}
            onClick={e => {
              e.preventDefault()
              confirm()
            }}
            className={cn(destructive && DESTRUCTIVE_BUTTON_CLASS)}
          >
            {confirmLabel}
            <kbd aria-hidden="true" className="ml-1.5 text-xs opacity-70">
              ↵
            </kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export const DESTRUCTIVE_BUTTON_CLASS =
  'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40'

// ---------------------------------------------------------------------------
// Imperative API: `if (!(await confirmAction({...}))) return`
// ---------------------------------------------------------------------------

export interface ConfirmActionOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  destructive?: boolean
}

interface ConfirmState {
  open: boolean
  /** Kept after close so the text stays during the close animation. */
  options: ConfirmActionOptions | null
  resolve: ((confirmed: boolean) => void) | null
}

let state: ConfirmState = { open: false, options: null, resolve: null }
const listeners = new Set<() => void>()
const setState = (next: ConfirmState) => {
  state = next
  listeners.forEach(l => l())
}

/**
 * Ask the user to confirm a destructive action. Resolves `true` on confirm,
 * `false` on cancel/Esc. Needs `<ConfirmDialogHost />` mounted once.
 * A new request cancels an open one.
 */
export function confirmAction(options: ConfirmActionOptions): Promise<boolean> {
  state.resolve?.(false)
  return new Promise(resolve => {
    setState({ open: true, options, resolve })
  })
}

function settle(confirmed: boolean) {
  const { resolve } = state
  if (!resolve) return
  setState({ open: false, options: state.options, resolve: null })
  resolve(confirmed)
}

export function ConfirmDialogHost() {
  const { open, options } = useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={next => {
        if (!next) settle(false)
      }}
      title={options?.title ?? ''}
      description={options?.description}
      confirmLabel={options?.confirmLabel ?? 'Confirm'}
      cancelLabel={options?.cancelLabel}
      destructive={options?.destructive ?? true}
      onConfirm={() => settle(true)}
    />
  )
}
