import { vi } from 'vitest'
import type * as Transport from '@/lib/transport'
import type * as FileReference from '@/lib/file-reference'
import type * as Projects from '@/services/projects'
import type * as Preferences from '@/services/preferences'
import { describeMenusIn } from './remote-capabilities.cases'

// The mocks stub data and side effects only; '@/lib/environment' stays real.
vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: vi.fn(async (command: string) =>
    command === 'read_file_content' || command.startsWith('read_')
      ? 'const a = 1\n'
      : undefined
  ),
}))
vi.mock('@/lib/file-reference', async importOriginal => ({
  ...(await importOriginal<typeof FileReference>()),
  useFileReference: () => ({
    status: 'found',
    path: '/repo/wt/docs/notes.md',
  }),
}))
vi.mock('@/services/projects', async importOriginal => {
  const mutation = () => ({ mutate: vi.fn() })
  return {
    ...(await importOriginal<typeof Projects>()),
    useCreateBaseSession: mutation,
    useMoveItem: mutation,
    useRemoveProject: mutation,
    useOpenProjectOnGitHub: mutation,
    useOpenProjectWorktreesFolder: mutation,
    useOpenWorktreeInEditor: mutation,
    useOpenWorktreeInFinder: mutation,
    useOpenWorktreeInGitClient: mutation,
    useOpenWorktreeInTerminal: mutation,
    useRevealPathInFileManager: mutation,
    useWorktrees: () => ({ data: [] }),
  }
})
vi.mock('@/services/preferences', async importOriginal => ({
  ...(await importOriginal<typeof Preferences>()),
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/components/open-in/use-git-client', () => ({
  useGitClient: () => null,
}))
vi.mock('@/hooks/useSyntaxHighlighting', () => ({
  useSyntaxHighlighting: (content: string) => ({
    html: `<pre data-testid="highlighted">${content}</pre>`,
    isLoading: false,
    error: null,
  }),
}))

// Issue #89: hide actions that open apps on a machine the user does not sit at.
describeMenusIn('local desktop', { native: true, editor: true })
// Finder on the remote host helps nobody; the editor opens in local Zed.
describeMenusIn('native + remote (public URL, host allows open)', {
  native: false,
  editor: true,
})
// The browser runs on the host itself, so Finder opens where the user is.
describeMenusIn('Web Access on localhost (host allows open)', {
  native: true,
  editor: true,
})
