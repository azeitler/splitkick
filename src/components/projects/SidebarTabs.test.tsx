import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { SidebarTabs } from './SidebarTabs'

describe('SidebarTabs', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarTab: 'projects' })
  })

  it('selects Projects by default', () => {
    render(<SidebarTabs />)
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'Recent' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('switches the store tab on click', async () => {
    render(<SidebarTabs />)
    await userEvent.click(screen.getByRole('tab', { name: 'Recent' }))
    expect(useUIStore.getState().sidebarTab).toBe('recent')
    expect(screen.getByRole('tab', { name: 'Recent' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
