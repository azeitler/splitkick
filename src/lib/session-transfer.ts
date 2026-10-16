/**
 * Transfer a session, with its history, to another Jean (issue #35).
 *
 * This window's backend exports the session (`export_session_bundle`, via
 * `invoke`); the chosen connection imports it (`import_session_bundle`, via
 * `remoteInvoke`). The source session is not changed. See "Transfer to a remote
 * Jean" in `docs/developer/session-forking.md`.
 */

import { useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import {
  getActiveConnectionId,
  useRemoteConnections,
  type RemoteConnection,
} from './remote-connections'
import { remoteInvoke } from './remote-invoke'
import { invoke } from './transport'

/** A bundle carries run logs and pasted images, so give the upload time. */
const IMPORT_TIMEOUT_MS = 10 * 60_000

export interface TransferSessionTarget {
  worktreeId: string
  sessionId: string
}

/** Connections a session can go to: every saved remote except this window's. */
export function getTransferTargets(
  connections: RemoteConnection[],
  activeConnectionId: string
): RemoteConnection[] {
  return connections.filter(connection => connection.id !== activeConnectionId)
}

/** Live list of transfer targets for this window. */
export function useTransferTargets(): RemoteConnection[] {
  const connections = useRemoteConnections()
  return useMemo(
    () => getTransferTargets(connections, getActiveConnectionId()),
    [connections]
  )
}

/**
 * The session the command palette acts on. Same order as `hasActiveSession`
 * in `use-command-context.ts`: the open session modal, then the active
 * worktree, then the selected one.
 */
export function getActiveSessionTarget(): TransferSessionTarget | null {
  const chatState = useChatStore.getState()
  const uiState = useUIStore.getState()
  const worktreeId =
    (uiState.sessionChatModalOpen
      ? uiState.sessionChatModalWorktreeId
      : null) ??
    chatState.activeWorktreeId ??
    useProjectsStore.getState().selectedWorktreeId
  if (!worktreeId) return null
  const sessionId = chatState.getActiveSession(worktreeId)
  return sessionId ? { worktreeId, sessionId } : null
}

/** Copy a session to `targetWorktreeId` on `connection`. Returns the new remote session. */
export async function transferSession({
  worktreeId,
  sessionId,
  connection,
  targetWorktreeId,
}: TransferSessionTarget & {
  connection: RemoteConnection
  targetWorktreeId: string
}): Promise<Session> {
  const bundle = await invoke<unknown>('export_session_bundle', {
    worktreeId,
    sessionId,
  })
  return remoteInvoke<Session>(
    connection,
    'import_session_bundle',
    { worktreeId: targetWorktreeId, bundle },
    { timeoutMs: IMPORT_TIMEOUT_MS }
  )
}
