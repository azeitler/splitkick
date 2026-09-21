import {
  Settings,
  Palette,
  Keyboard,
  Wand2,
  Plug,
  Blocks,
  BarChart3,
  Puzzle,
  FlaskConical,
  Globe,
  Github,
  Rabbit,
  Sparkles,
  Terminal,
  type LucideIcon,
} from '@/components/icons/reicon'
import type { PreferencePane } from '@/store/ui-store'
import type { CliBackend } from '@/types/preferences'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { CodexIcon } from '@/components/icons/CodexIcon'
import { OpenCodeIcon } from '@/components/icons/OpenCodeIcon'
import { CursorIcon } from '@/components/icons/CursorIcon'
import { PiIcon } from '@/components/icons/PiIcon'
import { CommandCodeIcon } from '@/components/icons/CommandCodeIcon'
import { GrokIcon } from '@/components/icons/GrokIcon'
import { KimiIcon } from '@/components/icons/KimiIcon'
import { AntigravityIcon } from '@/components/icons/AntigravityIcon'

/*
 * The Preferences navigation model: which panes exist, in which sections, and
 * which are desktop-only. Its own module so the phone's Settings tab can list
 * the panes without pulling the lazily-loaded Preferences dialog into the main
 * bundle.
 */

export interface NavigationItem {
  type: 'item'
  id: PreferencePane
  name: string
  icon: LucideIcon
  backend?: CliBackend
  desktopOnly?: boolean
}

export interface NavigationSection {
  type: 'section'
  id: string
  label: string
}

export type NavigationEntry = NavigationItem | NavigationSection

export const navigationEntries: NavigationEntry[] = [
  { type: 'section', id: 'app-section', label: 'App' },
  {
    type: 'item',
    id: 'general',
    name: 'General',
    icon: Settings,
  },
  {
    type: 'item',
    id: 'appearance',
    name: 'Appearance',
    icon: Palette,
  },
  {
    type: 'item',
    id: 'keybindings',
    name: 'Keybindings',
    icon: Keyboard,
    desktopOnly: true,
  },
  { type: 'section', id: 'backends-section', label: 'Backends' },
  {
    type: 'item',
    id: 'claude',
    name: 'Claude',
    icon: ClaudeIcon,
  },
  {
    type: 'item',
    id: 'codex',
    name: 'Codex',
    icon: CodexIcon,
  },
  {
    type: 'item',
    id: 'opencode',
    name: 'OpenCode',
    icon: OpenCodeIcon,
  },
  {
    type: 'item',
    id: 'cursor',
    name: 'Cursor',
    icon: CursorIcon,
  },
  {
    type: 'item',
    id: 'pi',
    name: 'PI',
    icon: PiIcon,
    backend: 'pi',
  },
  {
    type: 'item',
    id: 'commandcode',
    name: 'Command Code',
    icon: CommandCodeIcon,
    backend: 'commandcode',
  },
  {
    type: 'item',
    id: 'grok',
    name: 'Grok',
    icon: GrokIcon,
    backend: 'grok',
  },
  {
    type: 'item',
    id: 'kimi',
    name: 'Kimi Code',
    icon: KimiIcon,
    backend: 'kimi',
  },
  {
    type: 'item',
    id: 'antigravity',
    name: 'Antigravity CLI',
    icon: AntigravityIcon,
    backend: 'antigravity',
  },
  {
    type: 'item',
    id: 'github',
    name: 'GitHub CLI',
    icon: Github,
  },
  {
    type: 'item',
    id: 'coderabbit',
    name: 'CodeRabbit CLI',
    icon: Rabbit,
  },
  { type: 'section', id: 'tools-section', label: 'Tools' },
  {
    type: 'item',
    id: 'terminal',
    name: 'Terminal',
    icon: Terminal,
  },
  {
    type: 'item',
    id: 'magic-prompts',
    name: 'Magic Prompts',
    icon: Wand2,
  },
  {
    type: 'item',
    id: 'opinionated',
    name: 'Opinionated',
    icon: Sparkles,
  },
  { type: 'section', id: 'connectivity-section', label: 'Connectivity' },
  {
    type: 'item',
    id: 'providers',
    name: 'Providers',
    icon: Blocks,
  },
  {
    type: 'item',
    id: 'web-access',
    name: 'Web Access',
    icon: Globe,
    desktopOnly: true,
  },
  {
    type: 'item',
    id: 'mcp-servers',
    name: 'MCP Servers',
    icon: Plug,
  },
  {
    type: 'item',
    id: 'integrations',
    name: 'Integrations',
    icon: Puzzle,
  },
  { type: 'section', id: 'account-section', label: 'Account' },
  {
    type: 'item',
    id: 'usage',
    name: 'Usage',
    icon: BarChart3,
  },
  { type: 'section', id: 'advanced-section', label: 'Advanced' },
  {
    type: 'item',
    id: 'experimental',
    name: 'Experimental',
    icon: FlaskConical,
  },
]

/**
 * Mobile select groups: section labels + non-desktop-only items. Also the list
 * of the phone layout's Settings tab, so both offer the same panes.
 */
export function getMobileNavigationGroups(): {
  id: string
  label: string
  items: NavigationItem[]
}[] {
  const groups: { id: string; label: string; items: NavigationItem[] }[] = []
  let current: { id: string; label: string; items: NavigationItem[] } | null =
    null

  for (const entry of navigationEntries) {
    if (entry.type === 'section') {
      current = { id: entry.id, label: entry.label, items: [] }
      groups.push(current)
      continue
    }
    if (entry.desktopOnly) continue
    if (!current) {
      current = { id: 'default', label: '', items: [] }
      groups.push(current)
    }
    current.items.push(entry)
  }

  return groups.filter(group => group.items.length > 0)
}
