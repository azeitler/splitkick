import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/**
 * Regression net for the phone treatment of dialogs. The repo convention is
 * `!w-screen !h-dvh !max-w-screen !rounded-none … sm:…` for the large ones, and
 * for the small ones: never leave a `max-w-*` unprefixed, so `DialogContent`'s
 * base `max-w-[calc(100%-2rem)]` keeps the 16px phone gutter.
 */
const FULL_SCREEN = [
  'src/components/chat/PlanDialog.tsx',
  'src/components/github-dashboard/GitHubDashboardModal.tsx',
] as const

const GUTTER_ONLY = [
  'src/components/magic/ReleaseNotesDialog.tsx',
  'src/components/worktree/TeardownOutputDialog.tsx',
  'src/components/layout/UpdateAvailableModal.tsx',
] as const

const NO_RAW_VH = [
  ...FULL_SCREEN,
  ...GUTTER_ONLY,
  'src/components/chat/NativeCliSessionsModal.tsx',
  'src/components/onboarding/OnboardingDialog.tsx',
] as const

describe('mobile dialog sizing', () => {
  it.each(FULL_SCREEN)('%s is full-screen on phones', path => {
    const source = read(path)
    expect(source).toContain('!w-screen')
    expect(source).toContain('!h-dvh')
    expect(source).toContain('!rounded-none')
    // Every desktop size override must be behind a breakpoint.
    expect(source).not.toMatch(/className="[^"]*[^:]!w-\[calc\(100vw/)
  })

  it('does not let a min-width defeat the phone gutter', () => {
    // min-w-[90vw] beat DialogContent's base max-w-[calc(100%-2rem)] and forced
    // horizontal overflow at 375px.
    for (const path of [...FULL_SCREEN, ...GUTTER_ONLY]) {
      expect(read(path), path).not.toMatch(/min-w-\[\d+vw\]/)
    }
  })

  it.each(GUTTER_ONLY)('%s keeps the base phone gutter', path => {
    const source = read(path)
    // An unprefixed max-w-* on DialogContent overrides the base gutter.
    const unprefixed =
      source.match(/<DialogContent[^>]*className="[^"]*"/g) ?? []
    for (const tag of unprefixed) {
      expect(tag, path).not.toMatch(
        /(?<![a-z]:)(?<![a-z]:!)!?max-w-(sm|md|lg|xl)\b/
      )
    }
  })

  it.each(NO_RAW_VH)('%s uses dvh, not vh, for its height', path => {
    const source = read(path)
    // iOS Safari's vh exceeds the visible viewport, which clips a centred
    // dialog top and bottom.
    expect(source).not.toMatch(/\b(h|max-h)-\[[^\]]*\d+vh/)
  })
})
