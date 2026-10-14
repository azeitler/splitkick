import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * The window toolbar belongs to whatever view is on screen. A view renders
 * `<ToolbarContent>` and its title, chips, actions and search field appear in
 * the toolbar, through portals: the view keeps its own state and handlers.
 *
 * Views stack (the session modal opens over the project canvas), so the newest
 * `ToolbarContent` owns the toolbar. When it unmounts, the one below shows
 * again. See docs/superpowers/specs/2026-10-14-unified-toolbar-design.md.
 */
export const TOOLBAR_SLOTS = [
  'title',
  'subtitle',
  'chips',
  'actions',
  'search',
] as const
export type ToolbarSlot = (typeof TOOLBAR_SLOTS)[number]

type SlotTargets = Partial<Record<ToolbarSlot, HTMLElement | null>>

interface ToolbarSlotsContextValue {
  targets: SlotTargets
  setTarget: (slot: ToolbarSlot, element: HTMLElement | null) => void
  owners: string[]
  register: (id: string) => void
  unregister: (id: string) => void
}

const ToolbarSlotsContext = createContext<ToolbarSlotsContextValue | null>(null)

export function ToolbarSlotsProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<SlotTargets>({})
  const [owners, setOwners] = useState<string[]>([])

  const setTarget = useCallback(
    (slot: ToolbarSlot, element: HTMLElement | null) =>
      setTargets(current =>
        current[slot] === element ? current : { ...current, [slot]: element }
      ),
    []
  )
  const register = useCallback(
    (id: string) =>
      setOwners(current => (current.includes(id) ? current : [...current, id])),
    []
  )
  const unregister = useCallback(
    (id: string) =>
      setOwners(current =>
        current.includes(id) ? current.filter(owner => owner !== id) : current
      ),
    []
  )

  const value = useMemo(
    () => ({ targets, setTarget, owners, register, unregister }),
    [targets, setTarget, owners, register, unregister]
  )
  return (
    <ToolbarSlotsContext.Provider value={value}>
      {children}
    </ToolbarSlotsContext.Provider>
  )
}

/** Whether a window toolbar is mounted: desktop only. A phone has none, so a
 * view keeps its own header there. */
export function useHasWindowToolbar(): boolean {
  return useContext(ToolbarSlotsContext) !== null
}

/** Whether any view fills the toolbar. Without one it shows the window title. */
export function useToolbarHasOwner(): boolean {
  return (useContext(ToolbarSlotsContext)?.owners.length ?? 0) > 0
}

/** Ref callback that makes an element the target of a slot. */
export function useToolbarSlotRef(slot: ToolbarSlot) {
  const setTarget = useContext(ToolbarSlotsContext)?.setTarget
  return useCallback(
    (element: HTMLElement | null) => setTarget?.(slot, element),
    [setTarget, slot]
  )
}

export type ToolbarContentProps = Partial<Record<ToolbarSlot, ReactNode>>

export function ToolbarContent(props: ToolbarContentProps) {
  const context = useContext(ToolbarSlotsContext)
  const id = useId()
  const register = context?.register
  const unregister = context?.unregister

  useEffect(() => {
    if (!register || !unregister) return
    register(id)
    return () => unregister(id)
  }, [id, register, unregister])

  if (!context || context.owners.at(-1) !== id) return null
  return (
    <>
      {TOOLBAR_SLOTS.map(slot => {
        const content = props[slot]
        const target = context.targets[slot]
        return content != null && target
          ? createPortal(content, target, slot)
          : null
      })}
    </>
  )
}
