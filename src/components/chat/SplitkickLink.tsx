import type { MouseEvent, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, GitBranch, MessageSquare } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { invoke } from '@/lib/transport'
import {
  openSplitkickLink,
  type SplitkickLinkRef,
  type SplitkickLinkTarget,
} from '@/lib/splitkick-links'

const ICONS = { session: MessageSquare, worktree: GitBranch, project: Folder }

/** Text of the rendered link children, to see if the author wrote any. */
function childText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children)
  }
  if (Array.isArray(children)) return children.map(childText).join('')
  return ''
}

/**
 * A `splitkick://` link in chat (#44). Resolves the target against this
 * window's backend, shows its name when the link text is only the raw link,
 * and marks a target that is archived or unknown here. A click opens it.
 */
export function SplitkickLink({
  href,
  linkRef,
  children,
}: {
  href: string
  linkRef: SplitkickLinkRef
  children: ReactNode
}) {
  const { data: target, isPending } = useQuery({
    queryKey: ['splitkick-link', linkRef.kind, linkRef.id],
    queryFn: () =>
      invoke<SplitkickLinkTarget | null>('resolve_splitkick_link', {
        kind: linkRef.kind,
        id: linkRef.id,
      }),
    staleTime: 60_000,
  })

  const Icon = ICONS[linkRef.kind]
  const text = childText(children).trim()
  const label = text && text !== href ? children : (target?.name ?? href)
  const badge = isPending
    ? null
    : !target
      ? 'not found'
      : target.archived
        ? 'archived'
        : null
  const path = target
    ? [target.projectName, target.kind !== 'project' && target.worktreeName]
        .concat(target.kind === 'session' ? target.name : [])
        .filter(Boolean)
        .join(' › ')
    : `Unknown ${linkRef.kind} in this instance`

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (isPending) return
    openSplitkickLink(linkRef, target)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          data-chat-link=""
          onClick={handleClick}
          className="underline underline-offset-2 hover:text-foreground"
        >
          <Icon className="mr-0.5 inline size-3.5 align-[-0.15em]" />
          {label}
          {badge && (
            <span className="ml-1 inline-block rounded-sm bg-muted px-1 text-[0.75em] text-muted-foreground">
              {badge}
            </span>
          )}
        </a>
      </TooltipTrigger>
      <TooltipContent>{path}</TooltipContent>
    </Tooltip>
  )
}
