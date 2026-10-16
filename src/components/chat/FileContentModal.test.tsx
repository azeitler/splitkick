import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { FileContentModal } from './FileContentModal'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logNativeError: vi.fn(),
  editorThrows: true,
}))

vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/native-log', () => ({ logNativeError: mocks.logNativeError }))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: null }),
}))
vi.mock('@/hooks/useSyntaxHighlighting', () => ({
  useSyntaxHighlighting: (content: string) => ({
    html: `<pre data-testid="highlighted">${content}</pre>`,
    isLoading: false,
    error: null,
  }),
}))
// Stands in for Pierre throwing while it renders (#42).
vi.mock('@/components/ui/code-editor', () => ({
  default: ({ value }: { value: string }) => {
    if (mocks.editorThrows) throw new Error('No valid rowRange')
    return <div data-testid="code-editor">{value}</div>
  },
}))

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
}

// Edit mode threw an uncaught error as soon as you selected text, and every
// file opened in it (#42). Reading a file must not depend on the editor.
describe('FileContentModal view mode', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue('const a = 1\n')
    mocks.editorThrows = false
  })

  it('opens a file in view mode, not in the editor', async () => {
    render(<FileContentModal filePath="/repo/src/index.ts" onClose={vi.fn()} />)

    expect(await screen.findByTestId('highlighted')).toHaveTextContent(
      'const a = 1'
    )
    expect(screen.queryByTestId('code-editor')).toBeNull()
  })

  it('switches to the editor on Edit', async () => {
    const user = userEvent.setup()
    render(<FileContentModal filePath="/repo/src/index.ts" onClose={vi.fn()} />)

    await openEditor(user)

    expect(await screen.findByTestId('code-editor')).toHaveTextContent(
      'const a = 1'
    )
  })
})

// An image showed as a plain <img>, so a screenshot from a remote window could
// not be zoomed. It now uses the chat's zoomable viewer.
describe('FileContentModal images', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ data: 'aGVsbG8=', mimeType: 'image/png' })
  })

  it('shows an image in the zoomable viewer', async () => {
    render(<FileContentModal filePath="/repo/shot.png" onClose={vi.fn()} />)

    const image = await screen.findByAltText('shot.png')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
    expect(image.closest('.react-transform-wrapper')).not.toBeNull()
    expect(mocks.invoke).toHaveBeenCalledWith('read_file_base64', {
      path: '/repo/shot.png',
    })
  })
})

describe('FileContentModal editor errors', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue('const a = 1\n')
    mocks.logNativeError.mockReset()
    mocks.editorThrows = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('shows the error in the modal and writes it to the app log', async () => {
    const user = userEvent.setup()
    render(<FileContentModal filePath="/repo/src/index.ts" onClose={vi.fn()} />)
    await openEditor(user)

    expect(
      await screen.findByText(/The editor could not show this file/)
    ).toBeInTheDocument()
    expect(screen.getByText('No valid rowRange')).toBeInTheDocument()
    // The modal itself survives: header and path stay on screen.
    expect(screen.getByText('/repo/src/index.ts')).toBeInTheDocument()
    expect(mocks.logNativeError).toHaveBeenCalledWith(
      expect.stringContaining('/repo/src/index.ts')
    )
    expect(mocks.logNativeError).toHaveBeenCalledWith(
      expect.stringContaining('No valid rowRange')
    )
  })

  it('reloads the editor with the edited content', async () => {
    const user = userEvent.setup()
    render(<FileContentModal filePath="/repo/src/index.ts" onClose={vi.fn()} />)
    await openEditor(user)
    await screen.findByText(/The editor could not show this file/)

    mocks.editorThrows = false
    await user.click(screen.getByRole('button', { name: 'Reload editor' }))

    expect(await screen.findByTestId('code-editor')).toHaveTextContent(
      'const a = 1'
    )
  })
})
