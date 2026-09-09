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
 * Inline session rename: the row swaps its name for a text input, and Enter or
 * blur commits.
 *
 * The target is captured at start rather than bound at hook time, so one hook
 * serves rows from several worktrees (the pinned section). Only one rename is
 * ever open, so `submitRename` and `handleRenameKeyDown` need no session id.
 *
 * Pass the live name to `submitRename` / `handleRenameKeyDown` when you have
 * it, so an unchanged name is compared against the current value rather than
 * the value from when the menu opened.
 */
export function useSessionRename() {
  const renameSession = useRenameSession()
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const targetRef = useRef<SessionRenameTarget | null>(null)
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus and select the input as soon as it mounts.
  const renameInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus()
      node.select()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (startTimerRef.current) clearTimeout(startTimerRef.current)
    }
  }, [])

  const startRenameImmediate = useCallback((target: SessionRenameTarget) => {
    targetRef.current = target
    setRenameValue(target.currentName)
    setRenamingSessionId(target.sessionId)
  }, [])

  // Delay rename start so the input renders after the context menu fully closes
  // (Radix restores focus to the trigger on close, which would steal focus).
  const startRename = useCallback((target: SessionRenameTarget) => {
    targetRef.current = target
    setRenameValue(target.currentName)
    if (startTimerRef.current) clearTimeout(startTimerRef.current)
    startTimerRef.current = setTimeout(
      () => setRenamingSessionId(target.sessionId),
      200
    )
  }, [])

  const cancelRename = useCallback(() => {
    if (startTimerRef.current) clearTimeout(startTimerRef.current)
    targetRef.current = null
    setRenamingSessionId(null)
  }, [])

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
    startRenameImmediate,
    submitRename,
    cancelRename,
    handleRenameKeyDown,
  }
}
