import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'
import { activateConnection } from '@/lib/connection-windows'
import { isNativeApp } from '@/lib/environment'
import { getRemoteConnections } from '@/lib/remote-connections'
import {
  navigateToProject,
  navigateToSession,
  navigateToWorktree,
} from '@/lib/navigate-to-session'

/**
 * Links to Splitkick objects (#44): `splitkick://session/<id>`,
 * `splitkick://worktree/<id>`, `splitkick://project/<id>`,
 * `splitkick://agent/<id>` and `splitkick://connection/<id>`. A connection id
 * is the id that the MCP tools `list_instances` and `remote_tool` accept.
 *
 * Ids are only valid in the instance that made them, so a link resolves
 * against the backend of the window that shows it (`resolve_splitkick_link`
 * through the window's transport). Only chat knows the scheme; the OS does not.
 */
export type SplitkickLinkKind =
  | 'session'
  | 'worktree'
  | 'project'
  | 'agent'
  | 'connection'

export interface SplitkickLinkRef {
  kind: SplitkickLinkKind
  id: string
}

/** What `resolve_splitkick_link` returns for a known target. */
export interface SplitkickLinkTarget {
  kind: SplitkickLinkKind
  id: string
  name: string
  projectId: string
  projectName: string
  worktreeId?: string | null
  worktreeName?: string | null
  worktreePath?: string | null
  /** The target, or the worktree it lives in, is archived. */
  archived: boolean
  /** The session to open: the session itself, or an agent's current one. */
  sessionId?: string | null
  /** A remote connection's URL. Connections have no project (empty fields). */
  url?: string | null
}

const LINK_RE =
  /^splitkick:\/\/(session|worktree|project|agent|connection)\/([^/?#]+)\/?$/i

export function parseSplitkickLink(
  href: string | undefined
): SplitkickLinkRef | null {
  const match = href ? LINK_RE.exec(href) : null
  if (!match?.[1] || !match[2]) return null
  let id = match[2]
  try {
    id = decodeURIComponent(id)
  } catch {
    // Malformed percent-encoding: keep the raw id.
  }
  return { kind: match[1].toLowerCase() as SplitkickLinkKind, id }
}

export function splitkickLink(kind: SplitkickLinkKind, id: string): string {
  return `splitkick://${kind}/${encodeURIComponent(id)}`
}

export function splitkickMarkdownLink(
  kind: SplitkickLinkKind,
  id: string,
  name: string
): string {
  return `[${name.replace(/[[\]]/g, '\\$&')}](${splitkickLink(kind, id)})`
}

/**
 * Copy a link as markdown, so it pastes into a chat as a named link.
 * Used by the session, worktree and project context menus.
 */
export function copySplitkickLink(
  kind: SplitkickLinkKind,
  id: string,
  name: string
): void {
  void copyToClipboard(splitkickMarkdownLink(kind, id, name))
    .then(() => toast.success('Link copied'))
    .catch(() => toast.error('Failed to copy link'))
}

/**
 * Open a resolved link. A session, or an agent's current session, opens in the
 * modal on its project canvas. A connection opens its window (desktop) or
 * switches to it (Web Access, when this browser has it saved). An archived or
 * unknown target does not navigate: the link carries a badge, and the click
 * only says why nothing opens.
 */
export function openSplitkickLink(
  ref: SplitkickLinkRef,
  target: SplitkickLinkTarget | null | undefined
): void {
  if (!target) {
    toast.error(`This ${ref.kind} was not found here`)
    return
  }
  if (target.archived) {
    toast.info(`${target.name} is archived`)
    return
  }
  if (ref.kind === 'connection') {
    openConnection(ref.id, target.name)
    return
  }
  if (ref.kind === 'agent' && !target.sessionId) {
    toast.info(`${target.name} has no session`, {
      description: 'Restart it in the Agents tab.',
    })
    return
  }
  if ((ref.kind === 'session' || ref.kind === 'agent') && target.worktreeId) {
    navigateToSession({
      projectId: target.projectId,
      worktreeId: target.worktreeId,
      sessionId: target.sessionId ?? ref.id,
    })
  } else if (ref.kind === 'worktree') {
    navigateToWorktree(target.projectId, ref.id)
  } else {
    navigateToProject(target.projectId)
  }
}

/**
 * The link names a connection of the backend that resolved it. The desktop
 * app keeps the same list, so it opens the connection's window. A browser
 * keeps its own list (Web Access): it switches only when it has the id saved.
 */
function openConnection(id: string, name: string): void {
  const known = getRemoteConnections().some(connection => connection.id === id)
  if (known) {
    void activateConnection(id).catch(() =>
      toast.error(`Could not open ${name}`)
    )
    return
  }
  toast.info(
    `${name} is not saved in this ${isNativeApp() ? 'window' : 'browser'}`,
    {
      description: 'Add it under Server connections to open it here.',
    }
  )
}
