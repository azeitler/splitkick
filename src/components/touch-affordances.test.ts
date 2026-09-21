import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/**
 * Row actions revealed only by `group-hover` are invisible and unreachable on a
 * phone. The repo convention is the CSS-only `[@media(pointer:fine)]` variant
 * (see MessageItem / CheckpointTurnRestoreButton): no hook, no re-render, and
 * correct on touch laptops too.
 */
const CONVERTED = [
  'src/components/chat/QueuedPromptsPanel.tsx',
  'src/components/chat/LabelModal.tsx',
  'src/components/archive/ArchivedModal.tsx',
  'src/components/chat/CommitsTabView.tsx',
  'src/components/magic/LoadContextItems.tsx',
  'src/components/magic/LinearItemsTab.tsx',
  'src/components/worktree/LinearIssueItem.tsx',
  'src/components/chat/TerminalView.tsx',
] as const

describe('touch affordances', () => {
  it.each(CONVERTED)('%s reveals its row actions on a coarse pointer', path => {
    const source = read(path)
    expect(source).toContain('[@media(pointer:fine)]:group-hover:opacity-')
    // No bare group-hover:opacity-* may survive.
    expect(
      source.match(/(?<!fine\)\]:)group-hover:opacity-\d+/g),
      path
    ).toBeNull()
  })

  it('keeps the active terminal tab close button visible on desktop', () => {
    // The unprefixed isActive opacity-50 and the variant would both survive
    // twMerge, and the variant wins the cascade — so the active tab's close
    // button would disappear on a fine pointer. Branch instead of stacking.
    const source = read('src/components/chat/TerminalView.tsx')
    expect(source).toMatch(
      /isActive\s*\n?\s*\? 'opacity-50'\s*\n?\s*: '\[@media\(pointer:fine\)\]:opacity-0/
    )
  })

  it('reaches the queued-prompt actions with a finger', () => {
    // Three 44px targets plus the prompt text do not fit a 375px row; ~30px is
    // the compromise that needs no redesign.
    const source = read('src/components/chat/QueuedPromptsPanel.tsx')
    expect(source).toContain('p-2 md:p-0.5')
    expect(source).not.toContain('rounded p-0.5 text-muted-foreground')
  })

  it('suppresses tooltips on coarse pointers', () => {
    // Radix opens tooltips on focus, so a tap left one stuck over the UI.
    expect(read('src/components/ui/tooltip.tsx')).toContain(
      "'[@media(pointer:coarse)]:hidden'"
    )
  })

  it('gives the dialog and sheet close buttons a 44px hit area', () => {
    // Visual box stays 28px, so no desktop dialog reflows.
    for (const path of [
      'src/components/ui/dialog.tsx',
      'src/components/ui/sheet.tsx',
    ]) {
      expect(read(path), path).toContain(
        'after:absolute after:-inset-2 md:after:hidden'
      )
    }
  })
})

describe('chat breakpoint parity', () => {
  it('still pairs md: with the mobile breakpoint', () => {
    // md: is only the right partner for useIsMobile while this holds.
    expect(read('src/hooks/use-mobile.ts')).toContain('MOBILE_BREAKPOINT = 768')
  })

  it('does not mix the sm: card with the isMobile padding', () => {
    // At 640-767px the composer showed the desktop floating card *and* the
    // mobile safe-area padding, i.e. a detached card with a gap under it.
    const source = read('src/components/chat/ChatWindow.tsx')
    expect(source).toContain('relative md:mx-auto md:mb-3 md:max-w-3xl')
    expect(source).toContain('md:rounded-lg md:border')
    expect(source).toContain("'md:rounded-t-none'")
    expect(source).not.toMatch(
      /sm:(mx-auto|max-w-3xl|rounded-lg|rounded-t-none)/
    )
  })

  it('keeps touch-reachable tab actions out of hover-only territory', () => {
    // A landscape phone is ~844px, so sm: made these hover-only.
    const source = read('src/components/chat/SessionChatModal.tsx')
    expect(source).toContain('md:opacity-0 md:group-hover/tab:opacity-60')
    expect(source).toContain('hidden md:flex')
  })

  it('hides the keyboard focus hint where there is no keyboard', () => {
    const source = read('src/components/chat/ChatInput.tsx')
    expect(source).toContain('{showHint && !zenMode && isNativeApp() && (')
    expect(source).toContain('hidden md:flex')
    // 50vh overshoots the visible viewport on iOS Safari.
    expect(source).toContain("'max-h-[50dvh]'")
  })
})

describe('command palette touch targets', () => {
  it('grows the mode tabs on a phone without wrapping them onto three rows', () => {
    // Swipe-down opens the palette, so it is a real mobile path. The tabs live
    // in a flex-wrap row, so forcing a full 44px would push them above the
    // result list — ~34px is the compromise.
    expect(read('src/components/command-palette/CommandPalette.tsx')).toContain(
      "'shrink-0 rounded-md px-3 py-2 md:px-2 md:py-1 text-xs transition-colors'"
    )
  })
})
