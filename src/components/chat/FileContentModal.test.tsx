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
// Stands in for Pierre throwing while it renders (#42).
vi.mock('@/components/ui/code-editor', () => ({
  default: ({ value }: { value: string }) => {
    if (mocks.editorThrows) throw new Error('No valid rowRange')
    return <div data-testid="code-editor">{value}</div>
  },
}))

describe('FileContentModal editor errors', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue('const a = 1\n')
    mocks.logNativeError.mockReset()
    mocks.editorThrows = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('shows the error in the modal and writes it to the app log', async () => {
    render(<FileContentModal filePath="/repo/src/index.ts" onClose={vi.fn()} />)

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
    await screen.findByText(/The editor could not show this file/)

    mocks.editorThrows = false
    await user.click(screen.getByRole('button', { name: 'Reload editor' }))

    expect(await screen.findByTestId('code-editor')).toHaveTextContent(
      'const a = 1'
    )
  })
})
