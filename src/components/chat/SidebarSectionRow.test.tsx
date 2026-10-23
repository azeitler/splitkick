import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { SidebarSectionRow } from './SidebarSectionRow'

describe('SidebarSectionRow', () => {
  it('names the hidden rows with the given noun while collapsed', () => {
    render(
      <SidebarSectionRow
        icon={null}
        label="Folders"
        count={2}
        noun="folder"
        expanded={false}
      />
    )
    expect(screen.getByLabelText('2 folders')).toBeInTheDocument()
  })

  it('renders actions beside the toggle, not inside it', async () => {
    const onToggle = vi.fn()
    const onAction = vi.fn()
    render(
      <SidebarSectionRow
        icon={null}
        label="Projects"
        count={1}
        expanded
        onToggle={onToggle}
        testId="section-toggle"
        actions={
          <button type="button" onClick={onAction}>
            New
          </button>
        }
      />
    )

    const toggle = screen.getByTestId('section-toggle')
    const action = screen.getByRole('button', { name: 'New' })
    expect(toggle).not.toContainElement(action)

    await userEvent.click(action)
    expect(onAction).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })
})
