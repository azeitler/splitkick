import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import type { Artifact } from '@/types/chat'
import { ArtifactDiffModal } from './ArtifactDiffModal'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/components/chat/InlineFileDiff', () => ({
  InlineFileDiff: (props: { oldString: string; newString: string }) => (
    <div data-testid="line-diff">
      {props.oldString} → {props.newString}
    </div>
  ),
}))

function artifact(target: string): Artifact {
  return {
    id: 'a',
    title: 'Report',
    target,
    created_at: 1,
    versions: [1, 2, 3].map(n => ({
      version: n,
      title: 'Report',
      snapshot: `s${n}${target.slice(target.lastIndexOf('.'))}`,
      size: n * 1000,
      sha256: `h${n}`,
      created_at: n,
    })),
  }
}

function files(contents: Record<string, string | Error>) {
  mocks.invoke.mockImplementation(
    async (_cmd: string, args?: { path?: string }) => {
      // Other components in the dialog read preferences and the like.
      if (!args?.path) return undefined
      const name = args.path.split('/').at(-1) ?? ''
      const value = contents[name]
      if (value instanceof Error) throw value
      if (value === undefined) throw new Error(`missing ${name}`)
      return _cmd === 'read_file_base64'
        ? { data: value, mimeType: 'image/png' }
        : value
    }
  )
}

function renderModal(target: string, initial?: { from: number; to: number }) {
  render(
    <ArtifactDiffModal
      artifact={artifact(target)}
      snapshotDir="/data/s/artifacts"
      initial={initial}
      onClose={vi.fn()}
    />
  )
}

describe('ArtifactDiffModal (#108)', () => {
  beforeEach(() => mocks.invoke.mockReset())

  it('shows a line diff of the last two versions by default', async () => {
    files({ 's2.html': '<p>two</p>', 's3.html': '<p>three</p>' })
    renderModal('/wt/report.html')
    expect(await screen.findByTestId('line-diff')).toHaveTextContent(
      '<p>two</p> → <p>three</p>'
    )
    expect(mocks.invoke).toHaveBeenCalledWith('read_file_content', {
      path: '/data/s/artifacts/s3.html',
    })
  })

  it('compares the picked versions', async () => {
    files({ 's1.md': 'one', 's2.md': 'two', 's3.md': 'three' })
    renderModal('/wt/notes.md')
    await screen.findByTestId('line-diff')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '1' } })
    expect(await screen.findByText('one → three')).toBeInTheDocument()
  })

  it('says so when two versions have the same text', async () => {
    files({ 's1.md': 'same', 's2.md': 'same' })
    renderModal('/wt/notes.md', { from: 1, to: 2 })
    expect(
      await screen.findByText('The content of v1 and v2 is the same.')
    ).toBeInTheDocument()
  })

  it('shows two images side by side', async () => {
    files({ 's2.png': 'AAA', 's3.png': 'BBB' })
    renderModal('/wt/shot.png')
    const images = await screen.findAllByRole('img')
    expect(images.map(img => img.getAttribute('alt'))).toEqual([
      'Version 2 of shot.png',
      'Version 3 of shot.png',
    ])
    expect(images[1]).toHaveAttribute('src', 'data:image/png;base64,BBB')
  })

  it('shows sizes for a binary file', async () => {
    const binary = new Error('stream did not contain valid UTF-8')
    files({ 's2.zip': binary, 's3.zip': binary })
    renderModal('/wt/build.zip')
    expect(
      await screen.findByText(
        /Binary file, no line diff: v2 2\.0 KB → v3 2\.9 KB/
      )
    ).toBeInTheDocument()
  })
})
