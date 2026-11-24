import { Bot, Folder, GitBranch, MessageSquare, Server } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SplitkickLinkKind } from '@/lib/splitkick-links'

/** One icon per link kind: chat links and the `@` picker use the same. */
export const SPLITKICK_LINK_ICONS: Record<SplitkickLinkKind, LucideIcon> = {
  session: MessageSquare,
  worktree: GitBranch,
  project: Folder,
  agent: Bot,
  connection: Server,
}
