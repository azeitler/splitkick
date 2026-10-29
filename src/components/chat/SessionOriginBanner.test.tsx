import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChatService from '@/services/chat'
import { render } from '@/test/test-utils'
import type { SessionLink } from '@/types/chat'
import { SessionOriginBanner } from './SessionOriginBanner'

const links = vi.hoisted(() => ({
  current: {} as Record<string, SessionLink | null>,
}))
const navigateToSession = vi.hoisted(() => vi.fn())

vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<typeof ChatService>()),
  useSessionLink: (id: string | null) =>
    id && id in links.current
      ? { data: links.current[id], isSuccess: true }
      : { data: undefined, isSuccess: false },
}))

vi.mock('@/lib/navigate-to-session', () => ({ navigateToSession }))

function session(id: string, name: string, archived = false): SessionLink {
  return { sessionId: id, name, worktreeId: 'wt', projectId: 'p1', archived }
}

describe('SessionOriginBanner', () => {
  beforeEach(() => {
    links.current = {
      parent: session('parent', 'Planner'),
      source: session('source', 'Original'),
    }
    navigateToSession.mockClear()
  })

  it('renders nothing without an origin', () => {
    const { container } = render(<SessionOriginBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Started by and opens the parent', () => {
    render(
      <SessionOriginBanner
        startedBySessionId="parent"
        forkedFromSessionId="source"
      />
    )
    expect(screen.getByText(/Started by/)).toBeInTheDocument()
    expect(screen.getByText('Planner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View →' }))
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'wt',
      sessionId: 'parent',
    })
  })

  it('shows Forked from for a fork', () => {
    render(<SessionOriginBanner forkedFromSessionId="source" />)
    expect(screen.getByText(/Forked from/)).toBeInTheDocument()
    expect(screen.getByText('Original')).toBeInTheDocument()
  })

  it('marks an archived parent and offers no View', () => {
    links.current.parent = session('parent', 'Planner', true)
    render(<SessionOriginBanner startedBySessionId="parent" />)
    expect(screen.getByText(/archived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View →' })).toBeNull()
  })

  it('says when the parent is gone', () => {
    links.current.parent = null
    render(<SessionOriginBanner startedBySessionId="parent" />)
    expect(
      screen.getByText('Started by a session that is no longer available')
    ).toBeInTheDocument()
  })
})
