import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { FloatingButtons } from './FloatingButtons'

function renderButtons(
  overrides: Partial<ComponentProps<typeof FloatingButtons>> = {}
) {
  const onShowHiddenPrompts = vi.fn()
  render(
    <FloatingButtons
      showApproveButton={false}
      showFindingsButton={false}
      isAtBottom
      approveShortcut="Cmd+Enter"
      onApprove={vi.fn()}
      onYoloApprove={vi.fn()}
      onScrollToFindings={vi.fn()}
      onScrollToBottom={vi.fn()}
      onShowHiddenPrompts={onShowHiddenPrompts}
      {...overrides}
    />
  )
  return { onShowHiddenPrompts }
}

describe('FloatingButtons', () => {
  it('shows compact history outside the message flow', () => {
    const { onShowHiddenPrompts } = renderButtons({ hiddenPromptCount: 2 })

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 2 earlier prompts' })
    )

    expect(screen.getByText('2')).toBeVisible()
    expect(screen.queryByText('earlier')).not.toBeInTheDocument()
    expect(onShowHiddenPrompts).toHaveBeenCalledOnce()
  })

  it('hides the compact history action when no prompts are hidden', () => {
    renderButtons({ hiddenPromptCount: 0 })

    expect(
      screen.queryByRole('button', { name: /earlier prompts/i })
    ).not.toBeInTheDocument()
  })
})
