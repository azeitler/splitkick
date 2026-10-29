import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'
import {
  navigateToProject,
  navigateToSession,
  navigateToWorktree,
} from '@/lib/navigate-to-session'

/**
 * Links to Splitkick objects (#44): `splitkick://session/<id>`,
 * `splitkick://worktree/<id>` and `splitkick://project/<id>`.
 *
 * Ids are only valid in the instance that made them, so a link resolves
 * against the backend of the window that shows it (`resolve_splitkick_link`
 * through the window's transport). Only chat knows the scheme; the OS does not.
 */
export type SplitkickLinkKind = 'session' | 'worktree' | 'project'

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
}

const LINK_RE = /^splitkick:\/\/(session|worktree|project)\/([^/?#]+)\/?$/i

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
 * Open a resolved link. A session opens in the modal on its project canvas.
 * An archived or unknown target does not navigate: the link carries a badge,
 * and the click only says why nothing opens.
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
  if (ref.kind === 'session' && target.worktreeId) {
    navigateToSession({
      projectId: target.projectId,
      worktreeId: target.worktreeId,
      sessionId: ref.id,
    })
  } else if (ref.kind === 'worktree') {
    navigateToWorktree(target.projectId, ref.id)
  } else {
    navigateToProject(target.projectId)
  }
}
