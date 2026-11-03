import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { TextFilePreview } from './TextFilePreview'
import type { PendingTextFile } from '@/types/chat'

const invoke = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

const textFile: PendingTextFile = {
  id: 'text-1',
  path: '/tmp/pasted-texts/paste-1.txt',
  filename: 'paste-1.txt',
  size: 1024,
  content: 'Pasted content',
}

describe('TextFilePreview', () => {
  it('shows a remove button for pending pasted text and removes it', async () => {
    invoke.mockResolvedValueOnce(undefined)
    const onRemove = vi.fn()

    render(<TextFilePreview textFiles={[textFile]} onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove paste-1.txt' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('delete_pasted_text', {
        path: textFile.path,
      })
      expect(onRemove).toHaveBeenCalledWith(textFile.id)
    })
  })

  it('hides the remove button when explicitly disabled', () => {
    render(
      <TextFilePreview textFiles={[textFile]} onRemove={vi.fn()} disabled />
    )

    expect(
      screen.queryByRole('button', { name: 'Remove paste-1.txt' })
    ).not.toBeInTheDocument()
  })
})

describe('TextFilePreview HTML/SVG attachments', () => {
  it('previews a pasted SVG and toggles to source', () => {
    const svgFile: PendingTextFile = {
      id: 'svg-1',
      path: '/tmp/pasted-texts/logo.svg',
      filename: 'logo.svg',
      size: 40,
      content: '<svg viewBox="0 0 1 1"></svg>',
    }
    render(<TextFilePreview textFiles={[svgFile]} onRemove={vi.fn()} />)

    fireEvent.click(screen.getByText('logo.svg'))

    const img = screen.getByAltText('Preview of logo.svg')
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)

    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(
      screen.getByText('<svg viewBox="0 0 1 1"></svg>')
    ).toBeInTheDocument()
    expect(screen.queryByAltText('Preview of logo.svg')).toBeNull()
  })

  it('shows a plain text file as text, without a preview toggle', () => {
    render(<TextFilePreview textFiles={[textFile]} onRemove={vi.fn()} />)
    fireEvent.click(screen.getByText('paste-1.txt'))
    expect(screen.getByText('Pasted content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull()
  })
})
