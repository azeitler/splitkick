import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import {
  ProjectIssuesColumn,
  ProjectOverviewColumn,
} from './ProjectHomeColumns'
import type { AllSessionsResponse, Session } from '@/types/chat'
import type { ActivityEvent } from '@/types/activity'
import type { GitHubIssueListResult } from '@/types/github'
import type * as GitHubService from '@/services/github'

const mocks = vi.hoisted(() => ({
  sessions: { entries: [] } as AllSessionsResponse,
  activity: [] as ActivityEvent[],
  activityProjectId: undefined as string | undefined,
  issues: { issues: [], totalCount: 0 } as GitHubIssueListResult,
  issuesError: null as unknown,
  navigateToSession: vi.fn(),
  navigateToProject: vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: mocks.sessions, isLoading: false }),
}))

vi.mock('@/services/activity', () => ({
  useRecentActivity: ({ projectId }: { projectId?: string } = {}) => {
    mocks.activityProjectId = projectId
    return {
      data: mocks.activity,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }
  },
}))

vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
  navigateToProject: mocks.navigateToProject,
}))

vi.mock('@/services/github', async () => {
  const actual =
    await vi.importActual<typeof GitHubService>('@/services/github')
  return {
    ...actual,
    useGitHubIssues: () => ({
      data: mocks.issuesError ? undefined : mocks.issues,
      isLoading: false,
      isError: !!mocks.issuesError,
      error: mocks.issuesError,
      refetch: vi.fn(),
    }),
  }
})

function session(id: string, name: string, extra: Partial<Session> = {}) {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as unknown as Session
}

function event(id: string, projectId: string, title: string): ActivityEvent {
  return {
    id,
    kind: 'commit_created',
    at: 1,
    projectId,
    projectName: projectId,
    title,
  }
}

/** The canvas grid lays the two out side by side, with worktrees between. */
function renderColumns() {
  return render(
    <>
      <ProjectOverviewColumn projectId="p1" />
      <ProjectIssuesColumn projectId="p1" projectPath="/tmp/p1" />
    </>
  )
}

beforeEach(() => {
  mocks.sessions = {
    entries: [
      {
        project_id: 'p1',
        project_name: 'jean',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/w1',
        sessions: [
          session('s1', 'column work', { updated_at: 100 }),
          session('s3', 'release notes', { updated_at: 99 }),
        ],
      },
      {
        project_id: 'p2',
        project_name: 'paperwork',
        worktree_id: 'w2',
        worktree_name: 'main',
        worktree_path: '/tmp/w2',
        sessions: [session('s2', 'invoice run', { updated_at: 90 })],
      },
    ],
  } as unknown as AllSessionsResponse
  mocks.activity = [event('a1', 'p1', 'fix the columns')]
  mocks.activityProjectId = undefined
  mocks.issues = { issues: [], totalCount: 0 }
  mocks.issuesError = null
})

describe('project home columns', () => {
  it('lists only the sessions of its own project', () => {
    renderColumns()

    expect(screen.getByText('column work')).toBeInTheDocument()
    expect(screen.queryByText('invoice run')).not.toBeInTheDocument()
  })

  it('drops the project name from a session row, which is already known', () => {
    renderColumns()

    expect(screen.getAllByText('main').length).toBeGreaterThan(0)
    expect(screen.queryByText('jean / main')).not.toBeInTheDocument()
  })

  it('asks the backend for its own project activity', () => {
    renderColumns()

    expect(mocks.activityProjectId).toBe('p1')
    expect(screen.getByText('fix the columns')).toBeInTheDocument()
  })

  it('lists the open issues of the project', () => {
    mocks.issues = {
      issues: [
        {
          number: 23,
          title: 'Project view should mirror Home',
          state: 'open',
          labels: [{ name: 'enhancement', color: 'a2eeef' }],
          created_at: new Date().toISOString(),
          author: { login: 'azeitler' },
        },
      ],
      totalCount: 1,
    }
    renderColumns()

    expect(
      screen.getByText('Project view should mirror Home')
    ).toBeInTheDocument()
    expect(screen.getByText('#23')).toBeInTheDocument()
    expect(screen.getByText('enhancement')).toBeInTheDocument()
  })

  it('says nothing about issues when the project is not on GitHub', () => {
    // A project without a GitHub remote is a normal state, not an error.
    mocks.issuesError = new Error('No git remotes found for this repository')
    renderColumns()

    expect(screen.queryByText('Open issues')).not.toBeInTheDocument()
    expect(screen.queryByText('Could not load issues.')).not.toBeInTheDocument()
  })

  it('says nothing about issues when the GitHub CLI is not signed in', () => {
    mocks.issuesError = new Error('gh auth login required')
    renderColumns()

    expect(screen.queryByText('Open issues')).not.toBeInTheDocument()
  })

  it('renders one column each, so the grid can put worktrees between them', () => {
    renderColumns()

    expect(screen.getByTestId('project-column-overview')).toBeInTheDocument()
    expect(screen.getByTestId('project-column-issues')).toBeInTheDocument()
  })

  it('offers the session filter on a short project list', () => {
    // Home waits for six rows. A project column is already narrowed to one
    // project, so its list is shorter and the filter earns its place sooner.
    renderColumns()

    expect(
      screen.getByPlaceholderText('Filter sessions...')
    ).toBeInTheDocument()
  })

  it('narrows the session list as you type', async () => {
    renderColumns()

    await userEvent.type(
      screen.getByPlaceholderText('Filter sessions...'),
      'release'
    )

    expect(screen.getByText('release notes')).toBeInTheDocument()
    expect(screen.queryByText('column work')).not.toBeInTheDocument()
  })

  it('says the project has no sessions rather than dropping the heading', () => {
    // On Home an empty list means an empty app. An empty project is ordinary,
    // and its column must still say what belongs there.
    mocks.sessions = { entries: [] } as unknown as AllSessionsResponse
    renderColumns()

    expect(screen.getByText('Recent sessions')).toBeInTheDocument()
    expect(
      screen.getByText('No sessions yet. Open a worktree to start one.')
    ).toBeInTheDocument()
  })

  it('keeps the sessions above the activity in the overview column', () => {
    renderColumns()

    const column = screen.getByTestId('project-column-overview')
    const headings = Array.from(column.querySelectorAll('h2')).map(
      heading => heading.textContent
    )
    expect(headings).toEqual(['Recent sessions', 'Recent activity'])
  })

  it('offers a retry when the issue list fails for another reason', () => {
    mocks.issuesError = new Error('network unreachable')
    renderColumns()

    expect(screen.getByText('Open issues')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
