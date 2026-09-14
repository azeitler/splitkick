import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The project home mirrors the Home view: three equal container-query columns
// — recent sessions and activity, the worktrees, then the open issues.
describe('ProjectCanvasView home columns', () => {
  const source = readFileSync(
    `${process.cwd()}/src/components/dashboard/ProjectCanvasView.tsx`,
    'utf8'
  )

  it('gives the three columns the same width', () => {
    expect(source).toContain(
      "showHomeColumns && '@4xl:grid-cols-2 @7xl:grid-cols-3'"
    )
    // Container queries need a container: the canvas width, not the window's,
    // because the sidebar takes a variable share.
    expect(source).toContain('<div className="@container flex-1">')
  })

  it('reads overview, then worktrees, then issues', () => {
    const overview = source.indexOf('<ProjectOverviewColumn projectId=')
    const worktrees = source.indexOf('<WorktreeColumnFrame labelled=')
    const issues = source.indexOf('<ProjectIssuesColumn')

    expect(overview).toBeGreaterThan(-1)
    expect(worktrees).toBeGreaterThan(overview)
    expect(issues).toBeGreaterThan(worktrees)
  })

  it('lets the worktree column shrink instead of pushing the others out', () => {
    expect(source).toContain('<div className="flex min-w-0 flex-col">')
  })

  it('heads the worktree column like the two beside it', () => {
    expect(source).toContain('<WorktreeColumnFrame labelled={showHomeColumns}>')
    expect(source).toContain('<HomeSection title="Worktrees"')
  })

  it('drops the heading when the worktree list is the whole canvas', () => {
    // On its own the list needs no label: the project name sits above it.
    const start = source.indexOf('function WorktreeColumnFrame(')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\nfunction ', start + 10))
    expect(body).toContain('if (!labelled)')
  })

  it('runs the issues full width when two columns leave an odd cell', () => {
    expect(source).toContain('className="@4xl:col-span-2 @7xl:col-span-1"')
  })

  it('keeps the canvas full height, so the empty states stay centred', () => {
    expect(source).toContain("'grid min-h-full gap-x-6 gap-y-8 pb-16',")
  })

  it('hides the overview when the user closed it or is searching', () => {
    expect(source).toContain(
      'const showHomeColumns = !projectRailHidden && !searchQuery.trim()'
    )
    // With the columns up the canvas is never bare, so it keeps its padding.
    expect(source).toContain('!showHomeColumns &&')
    expect(source).toContain(
      'const projectRailHidden = useProjectsStore(state => state.projectRailHidden)'
    )
  })

  it('toggles the overview from the header', () => {
    expect(source).toContain(
      'useProjectsStore.getState().toggleProjectRailHidden()'
    )
  })
})
