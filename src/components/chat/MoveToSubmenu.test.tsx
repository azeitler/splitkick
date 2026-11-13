import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useUIStore } from '@/store/ui-store'
import type { Worktree } from '@/types/projects'
import { MoveToSubmenu, moveTargetsInProject } from './MoveToSubmenu'

const mocks = vi.hoisted(() => ({
  worktrees: [] as Worktree[],
  moveSessionWithToast: vi.fn(),
}))

vi.mock('@/services/projects', () => ({
  useWorktree: () => ({ data: { id: 'w-main', project_id: 'p1' } }),
  useWorktrees: (projectId: string | null) => ({
    data: projectId === 'p1' ? mocks.worktrees : [],
    isLoading: false,
  }),
}))

vi.mock('@/lib/session-move-toast', () => ({
  moveSessionWithToast: mocks.moveSessionWithToast,
}))

function worktree(id: string, extra: Partial<Worktree> = {}): Worktree {
  return {
    id,
    name: id,
    branch: `b-${id}`,
    project_id: 'p1',
    ...extra,
  } as Worktree
}

function renderMenu(disabled = false) {
  render(
    <ContextMenu>
      <ContextMenuTrigger>row</ContextMenuTrigger>
      <ContextMenuContent>
        <MoveToSubmenu sessionId="s1" worktreeId="w-main" disabled={disabled} />
      </ContextMenuContent>
    </ContextMenu>
  )
  fireEvent.contextMenu(screen.getByText('row'))
}

async function openSubmenu() {
  const trigger = await screen.findByRole('menuitem', { name: /Move to/ })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
  return screen.findAllByRole('menu')
}

describe('moveTargetsInProject', () => {
  it('drops the current, archived, pending and deleting worktrees', () => {
    const targets = moveTargetsInProject(
      [
        worktree('w-main'),
        worktree('w-feature'),
        worktree('w-old', { archived_at: 1 }),
        worktree('w-new', { status: 'pending' }),
        worktree('w-gone', { status: 'deleting' }),
      ],
      'w-main'
    )
    expect(targets.map(target => target.id)).toEqual(['w-feature'])
  })
})

describe('MoveToSubmenu', () => {
  beforeEach(() => {
    mocks.moveSessionWithToast.mockClear()
    useUIStore.setState({ moveSessionTarget: null })
    mocks.worktrees = [
      worktree('w-main'),
      worktree('feature-a'),
      worktree('feature-b'),
    ]
  })

  it('lists Other Project first, then the other worktrees of this project', async () => {
    renderMenu()
    const menus = await openSubmenu()
    const submenu = menus[menus.length - 1] as HTMLElement
    const items = within(submenu)
      .getAllByRole('menuitem')
      .map(item => item.textContent)
    expect(items).toEqual(['Other Project…', 'feature-a', 'feature-b'])
  })

  it('moves the session to a worktree in one click', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openSubmenu()
    await user.click(await screen.findByRole('menuitem', { name: 'feature-b' }))
    expect(mocks.moveSessionWithToast).toHaveBeenCalledWith(
      's1',
      'feature-b',
      'feature-b'
    )
  })

  it('opens the Move Session dialog for another project', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openSubmenu()
    await user.click(
      await screen.findByRole('menuitem', { name: 'Other Project…' })
    )
    expect(useUIStore.getState().moveSessionTarget).toEqual({
      worktreeId: 'w-main',
      sessionId: 's1',
    })
    expect(mocks.moveSessionWithToast).not.toHaveBeenCalled()
  })

  it('says so when the project has no other worktree', async () => {
    mocks.worktrees = [worktree('w-main')]
    renderMenu()
    await openSubmenu()
    expect(
      await screen.findByRole('menuitem', { name: 'No other worktree here' })
    ).toHaveAttribute('aria-disabled', 'true')
  })
})
