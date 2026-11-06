/**
 * Shared cases for issue #89: which machine-bound actions each menu shows in
 * each client mode. The test files own the `vi.mock` calls (hoisting is per
 * file) and keep `@/lib/environment` real; this module only sets the mode
 * and asserts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { setNativeOpenAllowed, setWsConnected } from '@/lib/environment'
import {
  addRemoteConnection,
  LOCAL_CONNECTION_ID,
  selectConnection,
} from '@/lib/remote-connections'
import { getFileManagerName } from '@/lib/platform'
import { HOST_ONLY_REASON } from '@/components/ui/host-only-hint'
import { WorktreeContextMenu } from '@/components/projects/WorktreeContextMenu'
import { ProjectContextMenu } from '@/components/projects/ProjectContextMenu'
import { FileTreeContextMenu } from '@/components/file-browser/FileTreeContextMenu'
import type { useFileMenuActions } from '@/components/file-browser/useFileMenuActions'
import type { useWorktreeMenuActions } from '@/components/projects/useWorktreeMenuActions'
import { MessageThreadContextMenu } from '@/components/chat/message-thread-context-menu'
import { FileContentModal } from '@/components/chat/FileContentModal'
import { useChatStore } from '@/store/chat-store'
import type { Project } from '@/types/projects'

export type ClientMode =
  | 'local desktop'
  | 'native + remote (public URL, host allows open)'
  | 'Web Access on localhost (host allows open)'
  | 'Web Access from another machine (host allows open)'

export interface Expected {
  /** Finder / terminal / default app / worktrees folder enabled (else disabled, "Host only") */
  native: boolean
  /** Open in editor enabled (host-native or local Zed via ssh://) */
  editor: boolean
}

export async function setClientMode(mode: ClientMode): Promise<void> {
  if (mode === 'local desktop' || mode.startsWith('native')) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: vi.fn() },
    })
  }
  if (mode.startsWith('native')) {
    const remote = await addRemoteConnection({
      name: 'Studio Mac',
      url: 'https://studio.example.com',
      token: 'test-token',
    })
    selectConnection(remote.id)
  }
  if (mode !== 'local desktop') {
    // The desktop app hosting Web Access always reports nativeOpenAllowed.
    setNativeOpenAllowed(true)
    setWsConnected(true)
  }
}

export function resetClientMode(): void {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__
  setNativeOpenAllowed(false)
  setWsConnected(false)
  selectConnection(LOCAL_CONNECTION_ID)
}

const fileManager = () =>
  new RegExp(`(reveal|open) in ${getFileManagerName()}`, 'i')

/** The item is always there; off actions are disabled and say why. */
function expectItem(name: RegExp, enabled: boolean) {
  const item = screen.getByRole('menuitem', { name })
  if (enabled) {
    expect(item).not.toHaveAttribute('aria-disabled')
    expect(item).not.toHaveTextContent(HOST_ONLY_REASON)
  } else {
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent(HOST_ONLY_REASON)
  }
}

function worktreeActions(): ReturnType<typeof useWorktreeMenuActions> {
  return {
    showDeleteConfirm: false,
    setShowDeleteConfirm: vi.fn(),
    isBase: false,
    hasMessages: false,
    runScripts: [],
    preferences: undefined,
    gitClient: null,
    handleRun: vi.fn(),
    handleRunCommand: vi.fn(),
    handleOpenTerminalPanel: vi.fn(),
    handleOpenInFinder: vi.fn(),
    handleOpenInTerminal: vi.fn(),
    handleOpenInEditor: vi.fn(),
    handleOpenInGitClient: vi.fn(),
    handleArchiveOrClose: vi.fn(),
    handleDelete: vi.fn(),
    handleCopyLink: vi.fn(),
  } as unknown as ReturnType<typeof useWorktreeMenuActions>
}

function fileActions(): ReturnType<typeof useFileMenuActions> {
  return {
    fileManagerName: getFileManagerName(),
    editorLabel: 'VS Code',
    terminalLabel: 'Terminal',
    isBrowsable: vi.fn(() => false),
    handleBrowse: vi.fn(),
    handleReveal: vi.fn(),
    handleOpenInEditor: vi.fn(),
    handleOpenInDefaultApp: vi.fn(),
    handleOpenInTerminal: vi.fn(),
    handleCopyPath: vi.fn(),
    handleCopyRelativePath: vi.fn(),
    handleAddToChat: vi.fn(),
  }
}

const project = {
  id: 'project-1',
  name: 'demo',
  path: '/repo/demo',
  default_branch: 'main',
  added_at: 0,
  order: 0,
} as Project

export function describeMenusIn(mode: ClientMode, expected: Expected): void {
  describe(`machine-bound menu actions — ${mode}`, () => {
    afterEach(resetClientMode)

    it('worktree context menu', async () => {
      await setClientMode(mode)
      render(
        <WorktreeContextMenu actions={worktreeActions()}>
          <button type="button">feature</button>
        </WorktreeContextMenu>
      )
      fireEvent.contextMenu(screen.getByText('feature'))

      expectItem(/open in .*(editor|code|zed|cursor)/i, expected.editor)
      expectItem(fileManager(), expected.native)
      expectItem(/open in terminal/i, expected.native)
      expectItem(/copy link/i, true)
    })

    it('project context menu (sidebar)', async () => {
      await setClientMode(mode)
      render(
        <ProjectContextMenu project={project}>
          <button type="button">demo</button>
        </ProjectContextMenu>
      )
      fireEvent.contextMenu(screen.getByText('demo'))

      expectItem(/open in .*(editor|code|zed|cursor)/i, expected.editor)
      expectItem(fileManager(), expected.native)
      expectItem(/open in terminal/i, expected.native)
      expectItem(/open worktrees folder/i, expected.native)
      expectItem(/open on github/i, true)
    })

    it('file tree context menu: file and folder', async () => {
      await setClientMode(mode)
      const actions = fileActions()
      render(
        <>
          <FileTreeContextMenu
            node={{
              name: 'main.rs',
              relativePath: 'src/main.rs',
              isDir: false,
              extension: 'rs',
              children: [],
            }}
            actions={actions}
            onOpen={vi.fn()}
          >
            <button type="button">main.rs</button>
          </FileTreeContextMenu>
        </>
      )
      fireEvent.contextMenu(screen.getByText('main.rs'))

      expectItem(/open in vs code/i, expected.editor)
      expectItem(/open in default app/i, expected.native)
      expectItem(fileManager(), expected.native)
      expectItem(/^copy path$/i, true)
      expectItem(/copy relative path/i, true)
    })

    it('file tree context menu: folder terminal', async () => {
      await setClientMode(mode)
      render(
        <FileTreeContextMenu
          node={{
            name: 'src',
            relativePath: 'src',
            isDir: true,
            extension: '',
            children: [],
          }}
          actions={fileActions()}
          onOpen={vi.fn()}
        >
          <button type="button">src</button>
        </FileTreeContextMenu>
      )
      fireEvent.contextMenu(screen.getByText('src'))

      expectItem(/open in terminal/i, expected.native)
      expectItem(/^copy path$/i, true)
    })

    it('message context menu: Reveal on a file link', async () => {
      await setClientMode(mode)
      useChatStore.setState({ activeWorktreePath: '/repo/wt' })
      render(
        <MessageThreadContextMenu messageText="See the notes">
          <a href="docs/notes.md">notes</a>
        </MessageThreadContextMenu>
      )
      fireEvent.contextMenu(screen.getByText('notes'))

      // The menu itself is open in every mode (Copy is always there).
      expect(
        (await screen.findAllByRole('menuitem', { name: /copy/i })).length
      ).toBeGreaterThan(0)
      expectItem(/reveal in/i, expected.native)
    })

    it('file viewer: Open in Editor button', async () => {
      await setClientMode(mode)
      render(
        <FileContentModal filePath="/repo/src/index.ts" onClose={vi.fn()} />
      )

      await screen.findByTestId('highlighted')
      const button = await screen.findByRole('button', {
        name: /open in editor/i,
      })
      if (expected.editor) {
        expect(button).toBeEnabled()
        expect(button).not.toHaveTextContent(HOST_ONLY_REASON)
      } else {
        expect(button).toBeDisabled()
        expect(button).toHaveTextContent(HOST_ONLY_REASON)
      }
    })

    it('⌘K: no command opens Finder, a terminal app or an editor', async () => {
      await setClientMode(mode)
      // Every registered command, available or not: the palette reaches
      // these only through the Open In modal, which applies the predicates.
      const commands = await import('@/lib/commands')
      const labels = [
        commands.appearanceCommands,
        commands.notificationCommands,
        commands.projectCommands,
        commands.githubCommands,
        commands.maintenanceCommands,
        commands.windowCommands,
        commands.graphCommands,
      ]
        .flat()
        .map(command => command.label)

      expect(labels.length).toBeGreaterThan(0)
      expect(
        labels.filter(label =>
          /finder|explorer|reveal|open in (terminal|editor)/i.test(label)
        )
      ).toEqual([])
    })
  })
}
