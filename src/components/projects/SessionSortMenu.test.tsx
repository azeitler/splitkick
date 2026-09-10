import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { SessionSortMenu, describeSessionSort } from './SessionSortMenu'

const trigger = () => screen.getByTestId('project-session-sort-project-1')
const settings = () =>
  useProjectsStore.getState().projectCanvasSettings['project-1']

describe('SessionSortMenu', () => {
  beforeEach(() => {
    useProjectsStore.setState({ projectCanvasSettings: {} })
  })

  it('stays dimmed while the sort is default', () => {
    render(<SessionSortMenu projectId="project-1" />)

    expect(trigger()).toHaveAccessibleName('Sort sessions')
    expect(trigger().className).toContain('opacity-50')
  })

  it('picks a mode with its natural direction', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu projectId="project-1" />)

    await user.click(trigger())
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Title' })
    )

    expect(settings()?.sessionSortMode).toBe('title')
    expect(settings()?.sessionSortDirection).toBe('asc')
  })

  it('flips the direction when the active mode is picked again', async () => {
    const user = userEvent.setup()
    useProjectsStore
      .getState()
      .setProjectSessionSort('project-1', 'title', 'asc')
    render(<SessionSortMenu projectId="project-1" />)

    await user.click(trigger())
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Title' })
    )

    expect(settings()?.sessionSortDirection).toBe('desc')
  })

  it('offers the direction in words that fit the mode', async () => {
    const user = userEvent.setup()
    useProjectsStore
      .getState()
      .setProjectSessionSort('project-1', 'last_activity', 'desc')
    render(<SessionSortMenu projectId="project-1" />)

    await user.click(trigger())
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Oldest first' })
    )

    expect(settings()?.sessionSortDirection).toBe('asc')
  })

  // A non-default order must never be invisible.
  it('shows a non-default sort at full strength and names it', () => {
    useProjectsStore
      .getState()
      .setProjectSessionSort('project-1', 'title', 'desc')
    render(<SessionSortMenu projectId="project-1" />)

    expect(trigger().className).toContain('opacity-100')
    expect(trigger()).toHaveAccessibleName('Sort sessions: Title, Z → A')
  })

  it('hides the direction choice for the default order', async () => {
    const user = userEvent.setup()
    render(<SessionSortMenu projectId="project-1" />)

    await user.click(trigger())
    await screen.findByRole('menuitemradio', { name: 'Default' })

    expect(screen.queryByRole('menuitemradio', { name: 'A → Z' })).toBeNull()
  })

  it('describes each order', () => {
    expect(describeSessionSort('default', 'asc')).toBe('Sort sessions')
    expect(describeSessionSort('last_activity', 'desc')).toBe(
      'Sort sessions: Last activity, Newest first'
    )
  })
})
