import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ProjectsSidebar server filter', () => {
  it('uses a compact dropdown that blends into the sidebar', () => {
    const source = readFileSync(
      'src/components/projects/ProjectsSidebar.tsx',
      'utf8'
    )

    expect(source).toContain('className="px-3 pb-1 pt-2"')
    expect(source).toContain('<DropdownMenuTrigger')
    expect(source).toContain('aria-label="Filter projects by server"')
    expect(source).toContain('border-transparent bg-transparent')
    expect(source).not.toContain('<SelectTrigger')
  })

  it('opens Jean connections from the server dropdown', () => {
    const source = readFileSync(
      'src/components/projects/ProjectsSidebar.tsx',
      'utf8'
    )

    expect(source).toContain('Jean connections')
    expect(source).toContain('setConnectionsOpen(true)')
    expect(source).toContain('<RemoteConnectionsDialog')
  })

  it('does not expose server feature surfaces in the footer', () => {
    const source = readFileSync(
      'src/components/projects/ProjectsSidebar.tsx',
      'utf8'
    )

    expect(source).not.toContain('ServerFeatureSurfaces')
    expect(source).not.toContain('>Features<')
  })

  it('shows only an accessible plus button in the footer', () => {
    const source = readFileSync(
      'src/components/projects/ProjectsSidebar.tsx',
      'utf8'
    )

    expect(source).toContain('aria-label="New"')
    expect(source).toContain('<Plus className="size-4" />')
    expect(source).not.toContain('command:open-archived-modal')
    expect(source).not.toContain('Archived')
  })
})
