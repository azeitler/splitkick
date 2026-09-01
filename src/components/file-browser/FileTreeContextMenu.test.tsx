import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { FileTreeContextMenu } from './FileTreeContextMenu'
import type { FileTreeNode } from './build-file-tree'
import type { useFileMenuActions } from './useFileMenuActions'
import type * as Environment from '@/lib/environment'

const mocks = vi.hoisted(() => ({
  canOpenNativeApps: vi.fn(() => true),
  canOpenInEditor: vi.fn(() => true),
}))

vi.mock('@/lib/environment', async () => {
  const actual = await vi.importActual<typeof Environment>('@/lib/environment')
  return {
    ...actual,
    canOpenNativeApps: mocks.canOpenNativeApps,
    canOpenInEditor: mocks.canOpenInEditor,
  }
})

const fileNode: FileTreeNode = {
  name: 'main.rs',
  relativePath: 'src/main.rs',
  isDir: false,
  extension: 'rs',
  children: [],
}

const dirNode: FileTreeNode = {
  name: 'src',
  relativePath: 'src',
  isDir: true,
  extension: '',
  children: [],
}

function buildActions(): ReturnType<typeof useFileMenuActions> {
  return {
    fileManagerName: 'Finder',
    editorLabel: 'VS Code',
    terminalLabel: 'Terminal',
    handleReveal: vi.fn(),
    handleOpenInEditor: vi.fn(),
    handleOpenInDefaultApp: vi.fn(),
    handleOpenInTerminal: vi.fn(),
    handleCopyPath: vi.fn(),
    handleCopyRelativePath: vi.fn(),
    handleAddToChat: vi.fn(),
  }
}

function renderMenu(node: FileTreeNode, actions = buildActions()) {
  const onOpen = vi.fn()
  render(
    <FileTreeContextMenu node={node} actions={actions} onOpen={onOpen}>
      <button type="button">{node.name}</button>
    </FileTreeContextMenu>
  )
  fireEvent.contextMenu(screen.getByText(node.name))
  return { actions, onOpen }
}

describe('FileTreeContextMenu', () => {
  beforeEach(() => {
    mocks.canOpenNativeApps.mockReturnValue(true)
    mocks.canOpenInEditor.mockReturnValue(true)
  })

  it('shows the file items and reveals with the platform file manager name', async () => {
    const user = userEvent.setup()
    const { actions } = renderMenu(fileNode)

    const reveal = await screen.findByRole('menuitem', {
      name: /reveal in finder/i,
    })
    expect(screen.getByRole('menuitem', { name: /^open$/i })).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: /open in vs code/i })
    ).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: /open in default app/i })
    ).toBeTruthy()
    // A file has no terminal entry.
    expect(screen.queryByRole('menuitem', { name: /open in terminal/i })).toBe(
      null
    )

    await user.click(reveal)
    expect(actions.handleReveal).toHaveBeenCalledWith(fileNode)
  })

  it('offers Open in Terminal for directories but not Open or Default App', async () => {
    const user = userEvent.setup()
    const { actions } = renderMenu(dirNode)

    const terminal = await screen.findByRole('menuitem', {
      name: /open in terminal/i,
    })
    expect(screen.queryByRole('menuitem', { name: /^open$/i })).toBe(null)
    expect(
      screen.queryByRole('menuitem', { name: /open in default app/i })
    ).toBe(null)

    await user.click(terminal)
    expect(actions.handleOpenInTerminal).toHaveBeenCalledWith(dirNode)
  })

  it('keeps copy and chat items when the host cannot open native apps', async () => {
    mocks.canOpenNativeApps.mockReturnValue(false)
    mocks.canOpenInEditor.mockReturnValue(false)
    const user = userEvent.setup()
    const { actions } = renderMenu(fileNode)

    const copyRelative = await screen.findByRole('menuitem', {
      name: /copy relative path/i,
    })
    expect(screen.queryByRole('menuitem', { name: /reveal in/i })).toBe(null)
    expect(screen.queryByRole('menuitem', { name: /open in vs code/i })).toBe(
      null
    )
    expect(screen.getByRole('menuitem', { name: /add to chat/i })).toBeTruthy()

    await user.click(copyRelative)
    expect(actions.handleCopyRelativePath).toHaveBeenCalledWith(fileNode)
  })
})
