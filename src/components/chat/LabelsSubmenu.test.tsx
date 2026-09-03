/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { LabelsSubmenu, SessionLabelsSubmenu } from './LabelsSubmenu'
import { useChatStore } from '@/store/chat-store'
import { PRESET_LABELS } from '@/lib/labels'
import type { LabelData } from '@/types/chat'

if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
}

const BUG: LabelData = { name: 'Bug', color: '#ef4444' }
const CHORE: LabelData = { name: 'Chore', color: '#6b7280' }
const PRESET = PRESET_LABELS[0] as string

function renderInMenu(children: React.ReactNode) {
  return render(
    <ContextMenu>
      <ContextMenuTrigger>
        <span>target</span>
      </ContextMenuTrigger>
      <ContextMenuContent>{children}</ContextMenuContent>
    </ContextMenu>
  )
}

/** Open the context menu, then its "Labels" submenu. */
async function openLabelsSubmenu(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.contextMenu(screen.getByText('target'))
  const trigger = await screen.findByText('Labels')
  await user.click(trigger)
  await waitFor(() =>
    expect(screen.getAllByRole('menuitemcheckbox').length).toBeGreaterThan(0)
  )
}

const checkboxNames = () =>
  screen.getAllByRole('menuitemcheckbox').map(item => item.textContent)

/**
 * Radix menu items select on `click`. `userEvent.click` does not reach them
 * under jsdom, so use `fireEvent` — the same approach as ApprovalModelSubmenu.
 */
const clickCheckbox = (name: string) =>
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))

describe('LabelsSubmenu — single mode', () => {
  it('lists every known label plus "No label", checking the applied one', async () => {
    const user = userEvent.setup()
    renderInMenu(
      <LabelsSubmenu
        mode="single"
        labels={[BUG, CHORE]}
        selected={BUG}
        onSelect={vi.fn()}
      />
    )
    await openLabelsSubmenu(user)

    expect(checkboxNames()).toEqual(['No label', 'Bug', 'Chore'])
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Bug' })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'No label' })
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('applies an unchecked label and closes the menu', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderInMenu(
      <LabelsSubmenu
        mode="single"
        labels={[BUG, CHORE]}
        selected={null}
        onSelect={onSelect}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox('Chore')

    expect(onSelect).toHaveBeenCalledWith(CHORE)
    await waitFor(() =>
      expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    )
  })

  it('clears the label when the checked one is clicked again', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderInMenu(
      <LabelsSubmenu
        mode="single"
        labels={[BUG]}
        selected={BUG}
        onSelect={onSelect}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox('Bug')

    // Not `BUG` — setSessionLabel ignores an identical value, so re-sending the
    // label would leave it applied. This is the "Remove Label" bug.
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('clears the label from "No label"', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderInMenu(
      <LabelsSubmenu
        mode="single"
        labels={[BUG]}
        selected={BUG}
        onSelect={onSelect}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox('No label')

    expect(onSelect).toHaveBeenCalledWith(null)
  })
})

describe('LabelsSubmenu — multi mode', () => {
  it('keeps the menu open and accumulates across several toggles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    let selected: LabelData[] = []

    const { rerender } = render(
      <ContextMenu>
        <ContextMenuTrigger>
          <span>target</span>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <LabelsSubmenu
            mode="multi"
            labels={[BUG, CHORE]}
            selected={selected}
            onChange={onChange}
          />
        </ContextMenuContent>
      </ContextMenu>
    )
    await openLabelsSubmenu(user)

    clickCheckbox('Bug')
    expect(onChange).toHaveBeenNthCalledWith(1, [BUG])

    // The menu must still be open — this is the guard for the preventDefault.
    expect(screen.getAllByRole('menuitemcheckbox').length).toBeGreaterThan(0)

    selected = [BUG]
    rerender(
      <ContextMenu>
        <ContextMenuTrigger>
          <span>target</span>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <LabelsSubmenu
            mode="multi"
            labels={[BUG, CHORE]}
            selected={selected}
            onChange={onChange}
          />
        </ContextMenuContent>
      </ContextMenu>
    )

    clickCheckbox('Chore')
    expect(onChange).toHaveBeenNthCalledWith(2, [BUG, CHORE])
    expect(screen.getAllByRole('menuitemcheckbox').length).toBeGreaterThan(0)
  })

  it('removes a checked label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInMenu(
      <LabelsSubmenu
        mode="multi"
        labels={[BUG, CHORE]}
        selected={[BUG, CHORE]}
        onChange={onChange}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox('Bug')

    expect(onChange).toHaveBeenCalledWith([CHORE])
  })

  it('clears every label from "No labels"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInMenu(
      <LabelsSubmenu
        mode="multi"
        labels={[BUG]}
        selected={[BUG]}
        onChange={onChange}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox('No labels')

    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('LabelsSubmenu — manage item', () => {
  it('calls onManage and closes the menu', async () => {
    const user = userEvent.setup()
    const onManage = vi.fn()
    renderInMenu(
      <LabelsSubmenu
        mode="single"
        labels={[BUG]}
        selected={null}
        onSelect={vi.fn()}
        onManage={onManage}
      />
    )
    await openLabelsSubmenu(user)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage labels…' }))

    expect(onManage).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    )
  })

  it('hides the item when onManage is absent', async () => {
    const user = userEvent.setup()
    renderInMenu(
      <LabelsSubmenu
        mode="single"
        labels={[BUG]}
        selected={null}
        onSelect={vi.fn()}
      />
    )
    await openLabelsSubmenu(user)

    expect(screen.queryByText('Manage labels…')).toBeNull()
  })
})

describe('SessionLabelsSubmenu', () => {
  beforeEach(() => {
    useChatStore.setState({ sessionLabels: {} })
  })

  it('lists presets plus every label already in use', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ sessionLabels: { other: BUG } })
    renderInMenu(
      <SessionLabelsSubmenu
        sessionId="s1"
        currentLabel={null}
        onManage={vi.fn()}
      />
    )
    await openLabelsSubmenu(user)

    expect(checkboxNames()).toEqual(['No label', PRESET, 'Bug'])
  })

  it('writes the label to the store', async () => {
    const user = userEvent.setup()
    renderInMenu(
      <SessionLabelsSubmenu
        sessionId="s1"
        currentLabel={null}
        onManage={vi.fn()}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox(PRESET)

    expect(useChatStore.getState().sessionLabels.s1?.name).toBe(PRESET)
  })

  it('removes the label from the store when the checked one is clicked', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ sessionLabels: { s1: BUG } })
    renderInMenu(
      <SessionLabelsSubmenu
        sessionId="s1"
        currentLabel={BUG}
        onManage={vi.fn()}
      />
    )
    await openLabelsSubmenu(user)
    clickCheckbox('Bug')

    expect(useChatStore.getState().sessionLabels.s1).toBeUndefined()
  })
})
