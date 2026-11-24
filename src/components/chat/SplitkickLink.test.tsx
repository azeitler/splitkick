import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { Markdown } from '@/components/ui/markdown'
import { invoke } from '@/lib/transport'
import { openSplitkickLink } from '@/lib/splitkick-links'
import type * as Transport from '@/lib/transport'
import type * as SplitkickLinks from '@/lib/splitkick-links'

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: vi.fn(),
}))
vi.mock('@/lib/splitkick-links', async importOriginal => ({
  ...(await importOriginal<typeof SplitkickLinks>()),
  openSplitkickLink: vi.fn(),
}))

const LIVE = {
  kind: 'session',
  id: 's1',
  name: 'Fix redirects',
  projectId: 'p1',
  projectName: 'jean',
  worktreeId: 'wt1',
  worktreeName: 'fuzzy-tiger',
  worktreePath: '/wt',
  archived: false,
}

describe('Splitkick links in chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the splitkick:// target instead of blanking it', async () => {
    vi.mocked(invoke).mockResolvedValue(LIVE)
    render(<Markdown>{'See [that one](splitkick://session/s1).'}</Markdown>)

    const link = await screen.findByRole('link', { name: /that one/ })
    expect(link.getAttribute('href')).toBe('splitkick://session/s1')
    expect(link.hasAttribute('data-chat-link')).toBe(true)
    expect(invoke).toHaveBeenCalledWith('resolve_splitkick_link', {
      kind: 'session',
      id: 's1',
    })
  })

  it('renders agent and connection links with their names', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args) =>
      (args as { kind: string }).kind === 'agent'
        ? { ...LIVE, kind: 'agent', id: 'a1', name: 'Release manager' }
        : {
            ...LIVE,
            kind: 'connection',
            id: 'c1',
            name: 'Mac 2',
            projectId: '',
            projectName: '',
            worktreeId: null,
            worktreeName: null,
            url: 'https://box.tail1234.ts.net',
          }
    )
    render(
      <Markdown>
        {'Ask <splitkick://agent/a1> on <splitkick://connection/c1>.'}
      </Markdown>
    )

    expect(
      await screen.findByRole('link', { name: /Release manager/ })
    ).toHaveAttribute('href', 'splitkick://agent/a1')
    expect(await screen.findByRole('link', { name: /Mac 2/ })).toHaveAttribute(
      'href',
      'splitkick://connection/c1'
    )
  })

  it('shows the target name when the link text is the raw link', async () => {
    vi.mocked(invoke).mockResolvedValue(LIVE)
    render(<Markdown>{'<splitkick://session/s1>'}</Markdown>)

    expect(
      await screen.findByRole('link', { name: /Fix redirects/ })
    ).toBeTruthy()
  })

  it('opens the resolved target on click', async () => {
    vi.mocked(invoke).mockResolvedValue(LIVE)
    render(<Markdown>{'[Fix redirects](splitkick://session/s1)'}</Markdown>)

    const link = await screen.findByRole('link', { name: /Fix redirects/ })

    // A click before the resolve lands does nothing, so retry until it has.
    await vi.waitFor(() => {
      fireEvent.click(link)
      expect(openSplitkickLink).toHaveBeenCalledWith(
        { kind: 'session', id: 's1' },
        LIVE
      )
    })
  })

  it('marks an archived target', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...LIVE, archived: true })
    render(<Markdown>{'[old](splitkick://session/s1)'}</Markdown>)

    expect(await screen.findByText('archived')).toBeTruthy()
  })

  it('marks a target this instance does not know', async () => {
    vi.mocked(invoke).mockResolvedValue(null)
    render(<Markdown>{'[gone](splitkick://session/nope)'}</Markdown>)

    expect(await screen.findByText('not found')).toBeTruthy()
  })
})
