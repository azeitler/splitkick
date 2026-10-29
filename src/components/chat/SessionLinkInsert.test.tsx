import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChatService from '@/services/chat'
import { render } from '@/test/test-utils'
import type { SessionLink } from '@/types/chat'
import { CurrentSessionContext } from './CurrentSessionContext'
import {
  getLinkedSessionId,
  linkVerb,
  SessionLinkInsert,
} from './SessionLinkInsert'

const link = vi.hoisted(() => ({
  current: undefined as SessionLink | null | undefined,
}))
const navigateToSession = vi.hoisted(() => vi.fn())

vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<typeof ChatService>()),
  useSessionLink: () =>
    link.current === undefined
      ? { data: undefined, isSuccess: false }
      : { data: link.current, isSuccess: true },
}))

vi.mock('@/lib/navigate-to-session', () => ({ navigateToSession }))

function child(overrides: Partial<SessionLink> = {}): SessionLink {
  return {
    sessionId: 'child',
    name: 'Fix login',
    worktreeId: 'wt',
    projectId: 'p1',
    archived: false,
    startedBySessionId: 'parent',
    ...overrides,
  }
}

function renderInsert(tool: string, current = 'parent') {
  return render(
    <CurrentSessionContext.Provider value={current}>
      <SessionLinkInsert bareToolName={tool} sessionId="child" />
    </CurrentSessionContext.Provider>
  )
}

describe('getLinkedSessionId', () => {
  it('reads the session id from each session tool', () => {
    expect(getLinkedSessionId('create_session', '{"id":"s1"}')).toBe('s1')
    expect(
      getLinkedSessionId(
        'send_chat_message',
        '{"sessionId":"s2","status":"started"}'
      )
    ).toBe('s2')
    expect(
      getLinkedSessionId(
        'create_worktree',
        '{"worktree":{},"sessionId":"s3","status":"investigation_started"}'
      )
    ).toBe('s3')
  })

  it('unwraps an MCP content wrapper', () => {
    const wrapped = JSON.stringify({
      content: [{ type: 'text', text: '{"id":"s1"}' }],
    })
    expect(getLinkedSessionId('create_session', wrapped)).toBe('s1')
    const array = JSON.stringify([{ type: 'text', text: '{"sessionId":"s2"}' }])
    expect(getLinkedSessionId('send_chat_message', array)).toBe('s2')
  })

  it('ignores other tools, plain worktrees, bad JSON and errors', () => {
    expect(getLinkedSessionId('list_sessions', '{"id":"s1"}')).toBeNull()
    expect(getLinkedSessionId(null, '{"id":"s1"}')).toBeNull()
    expect(getLinkedSessionId('create_worktree', '{"id":"wt1"}')).toBeNull()
    expect(getLinkedSessionId('create_session', 'Error: nope')).toBeNull()
    expect(getLinkedSessionId('create_session', undefined)).toBeNull()
  })
})

describe('linkVerb', () => {
  it('says Sent to for a send into a session this chat did not start', () => {
    expect(linkVerb('send_chat_message', child(), 'parent')).toBe(
      'Started session'
    )
    expect(linkVerb('send_chat_message', child(), 'other')).toBe(
      'Sent to session'
    )
    expect(
      linkVerb('send_chat_message', child({ startedBySessionId: null }), null)
    ).toBe('Sent to session')
    expect(linkVerb('create_session', child(), 'other')).toBe('Started session')
  })
})

describe('SessionLinkInsert', () => {
  beforeEach(() => {
    link.current = child()
    navigateToSession.mockClear()
  })

  it('renders nothing while loading', () => {
    link.current = undefined
    const { container } = renderInsert('create_session')
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Started session with the current name and opens the child', () => {
    renderInsert('create_session')
    expect(screen.getByText(/Started session/)).toBeInTheDocument()
    expect(screen.getByText('Fix login')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View →' }))
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'wt',
      sessionId: 'child',
    })
  })

  it('shows Sent to session for a later send from another chat', () => {
    renderInsert('send_chat_message', 'someone-else')
    expect(screen.getByText(/Sent to session/)).toBeInTheDocument()
  })

  it('marks an archived session and offers no View', () => {
    link.current = child({ archived: true })
    renderInsert('create_session')
    expect(screen.getByText(/archived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View →' })).toBeNull()
  })

  it('says when the session is gone', () => {
    link.current = null
    renderInsert('create_session')
    expect(
      screen.getByText('Started session (no longer available)')
    ).toBeInTheDocument()
  })
})
