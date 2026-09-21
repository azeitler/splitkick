import { useCallback, useEffect, useRef, useState } from 'react'
import { useRenameSession } from '@/services/chat'

/** The session an inline rename edits, captured when the rename starts. */
export interface SessionRenameTarget {
  sessionId: string
  worktreeId: string
  worktreePath: string
  currentName: string
}

/**
 * Inline session rename: the row swaps its name for a text input. Enter or a
 * real move elsewhere commits; Escape cancels.
 *
 * The target is captured at start rather than bound at hook time, so one hook
 * serves rows from several worktrees (the pinned section). Only one rename is
 * ever open, so `submitRename` and `handleRenameKeyDown` need no session id.
 *
 * Pass the live name to `submitRename` / `handleRenameKeyDown` when you have
 * it, so an unchanged name is compared against the current value rather than
 * the value from when the menu opened.
 *
 * Starting from the session context menu needs no delay:
 * `SessionContextMenuItems` calls `onRename` from the menu's
 * `onCloseAutoFocus`, after the menu has unmounted, and cancels the focus
 * return that used to steal focus from the input (azeitler/jean#29).
 */
export function useSessionRename() {
  const renameSession = useRenameSession()
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null
  )
  const [renameValue, setRenameValue] = useState('')
  const targetRef = useRef<SessionRenameTarget | null>(null)
  const inputNodeRef = useRef<HTMLInputElement | null>(null)

  // Focus and select the input as soon as it mounts.
  const renameInputRef = useCallback((node: HTMLInputElement | null) => {
    inputNodeRef.current = node
    if (node) {
      node.focus()
      node.select()
    }
  }, [])

  const startRename = useCallback((target: SessionRenameTarget) => {
    targetRef.current = target
    setRenameValue(target.currentName)
    setRenamingSessionId(target.sessionId)
  }, [])

  const cancelRename = useCallback(() => {
    targetRef.current = null
    setRenamingSessionId(null)
  }, [])

  // A right-click anywhere but the input cancels the rename. It opens a menu,
  // the menu takes focus, and the blur would otherwise save a half-typed name.
  // It must run on pointerdown, in the capture phase: Chromium moves focus to
  // the clicked row on mousedown, before any contextmenu event. A right-click
  // inside the input is left alone, so its own cut / copy / paste menu works.
  useEffect(() => {
    if (!renamingSessionId) return
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return
      const input = inputNodeRef.current
      if (input && e.target instanceof Node && input.contains(e.target)) return
      cancelRename()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [renamingSessionId, cancelRename])

  const submitRename = useCallback(
    (currentName?: string) => {
      const target = targetRef.current
      const newName = renameValue.trim()
      const previous = currentName ?? target?.currentName
      if (target && newName && newName !== previous) {
        renameSession.mutate({
          worktreeId: target.worktreeId,
          worktreePath: target.worktreePath,
          sessionId: target.sessionId,
          newName,
        })
      }
      targetRef.current = null
      setRenamingSessionId(null)
    },
    [renameValue, renameSession]
  )

  // Losing focus to a menu is not a decision to save. That covers a touch
  // long-press and the keyboard menu key, which the right-click guard above
  // does not see.
  const handleRenameBlur = useCallback(
    (e: React.FocusEvent, currentName?: string) => {
      const next = e.relatedTarget
      if (next instanceof Element && next.closest('[role="menu"]')) {
        cancelRename()
        return
      }
      submitRename(currentName)
    },
    [cancelRename, submitRename]
  )

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, currentName?: string) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submitRename(currentName)
      } else if (e.key === 'Escape') {
        cancelRename()
      }
    },
    [submitRename, cancelRename]
  )

  return {
    renamingSessionId,
    renameValue,
    setRenameValue,
    renameInputRef,
    startRename,
    submitRename,
    cancelRename,
    handleRenameBlur,
    handleRenameKeyDown,
  }
}
