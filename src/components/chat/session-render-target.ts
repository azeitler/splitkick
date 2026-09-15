export interface SessionRenderTarget {
  sessionId: string | null
  worktreeId: string | null
  worktreePath: string | null
}

/**
 * Keep deferred rendering only for tab changes inside one worktree. A worktree
 * change can also change the owning Jean server, so the old session ID must
 * never be combined with the new worktree ID and path.
 */
export function selectSessionRenderTarget(
  active: SessionRenderTarget,
  deferred: SessionRenderTarget
): SessionRenderTarget {
  return active.worktreeId === deferred.worktreeId ? deferred : active
}
