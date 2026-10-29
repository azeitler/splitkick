import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The 2 px between a sidebar row and its children belongs to the row's sticky
 * block (#59). The stack's slots must step by row + gap, or a stuck selected
 * row's pill touches the next stuck row and the hairline. jsdom does no
 * layout, so these guard the CSS offsets and the one list the row tests mock.
 */
describe('sidebar sticky stack gap', () => {
  const css = readFileSync(resolve(__dirname, '../../App.css'), 'utf8')

  it('steps every child slot by the row height plus the gap', () => {
    expect(css).toMatch(/--sb-row-gap:\s*0\.125rem/)
    const step = (name: string, parent: string) =>
      new RegExp(
        `--sb-${name}-top: calc\\(\\s*var\\(--sb-${parent}-top\\) \\+ var\\(--sb-row-h\\) \\+ var\\(--sb-row-gap\\)\\s*\\)`,
        'g'
      )
    expect(css.match(step('project', 'folder'))).toHaveLength(1)
    // Folders and Projects sections.
    expect(css.match(step('worktree', 'project'))).toHaveLength(2)
  })

  it('lands a revealed session below the stuck block, gap included', () => {
    expect(css).toMatch(
      /scroll-margin-top: calc\(\s*var\(--sb-worktree-top, 0px\) \+ var\(--sb-row-h\) \+\s*var\(--sb-row-gap\) \+ 0\.5rem\s*\)/
    )
  })

  // #60: a project revealed upwards lands in its own sticky slot, below the
  // section headers, not under them.
  it('lands a revealed project below the stuck section headers', () => {
    expect(css).toMatch(
      /\[data-sidebar-row-id\^='project:'\] \{\s*scroll-margin-top: var\(--sb-project-top, 0px\);/
    )
  })

  it('drops the worktree list top padding when it follows the project block', () => {
    const source = readFileSync(resolve(__dirname, 'WorktreeList.tsx'), 'utf8')
    expect(source).toContain("sessionFilterOpen ? 'py-0.5' : 'pb-0.5'")
  })
})
