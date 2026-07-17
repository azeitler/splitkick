import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { backendOptions } from '@/types/preferences'
import { AI_BACKENDS, CursorSetupState } from './OnboardingDialog'

describe('OnboardingDialog backends', () => {
  it('offers every supported chat backend', () => {
    expect(AI_BACKENDS).toEqual(backendOptions.map(option => option.value))
  })

  it('lets users choose an installed Cursor Agent or run its installer', () => {
    const onUsePath = vi.fn()
    const onInstall = vi.fn()

    render(
      <CursorSetupState
        pathFound
        pathVersion="1.2.3"
        pathPath="/usr/local/bin/agent"
        onUsePath={onUsePath}
        onInstall={onInstall}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /use system cursor/i }))
    fireEvent.click(screen.getByRole('button', { name: /official installer/i }))

    expect(onUsePath).toHaveBeenCalledOnce()
    expect(onInstall).toHaveBeenCalledOnce()
  })
})
