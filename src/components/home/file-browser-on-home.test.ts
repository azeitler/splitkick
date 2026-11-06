import { readFileSync } from 'node:fs'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useContextPanelShown } from '@/components/layout/use-context-panel-shown'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

// MainWindow and WindowToolbar are too heavy to mount here; like the other tests of
// these two files, this pins the wiring in the source. The shared hook is
// tested for its behaviour below.
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('side panel (Files | Network | Graph) on Home (#98)', () => {
  it('is not rendered by MainWindow while Home is showing', () => {
    const source = read('src/components/layout/MainWindow.tsx')
    expect(source).toMatch(/fileBrowserVisible = useContextPanelShown\(\)/)
  })

  it('has a disabled, unpressed Files toggle in the toolbar on Home', () => {
    const source = read('src/components/toolbar/WindowToolbar.tsx')
    expect(source).toContain('disabled={isHomeActive}')
    expect(source).toContain('useContextPanelShown()')
  })

  describe('useContextPanelShown', () => {
    beforeEach(() => {
      useProjectsStore.setState({ selectedProjectId: null })
      useChatStore.setState({ activeWorktreeId: null })
      useUIStore.setState({
        fileBrowserVisible: true,
        contextPanelTab: 'files',
        sessionNetworkSessionId: null,
      })
    })

    const shown = () => renderHook(() => useContextPanelShown()).result.current

    it('hides the panel on Home without changing the stored visibility', () => {
      expect(shown()).toBe(false)
      expect(useUIStore.getState().fileBrowserVisible).toBe(true)
    })

    it('shows a network pinned from a sidebar row on Home', () => {
      useUIStore.setState({
        contextPanelTab: 'network',
        sessionNetworkSessionId: 's1',
      })
      expect(shown()).toBe(true)
    })

    it('shows the panel in a project', () => {
      useProjectsStore.setState({ selectedProjectId: 'p1' })
      expect(shown()).toBe(true)
    })
  })
})
