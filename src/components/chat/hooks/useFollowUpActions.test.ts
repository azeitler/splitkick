import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFollowUpActions } from './useFollowUpActions'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { FollowUp } from '@/types/chat'

const { editMock } = vi.hoisted(() => ({
  editMock: vi.fn(async () => true),
}))

vi.mock('@/services/chat', () => ({
  useEditFollowUps: () => editMock,
}))

const item: FollowUp = {
  id: 'f1',
  text: 'check the tests',
  done: false,
  created_at: 0,
}

function setup() {
  const sendTextMessage = vi.fn()
  const { result } = renderHook(() =>
    useFollowUpActions({
      sessionId: 's1',
      worktreeId: 'w1',
      worktreePath: '/tmp/w1',
      sendTextMessage,
    })
  )
  return { ...result.current, sendTextMessage }
}

describe('useFollowUpActions', () => {
  let appended: string[]
  const onAppend = (event: Event) =>
    appended.push((event as CustomEvent<{ text: string }>).detail.text)

  beforeEach(() => {
    editMock.mockClear()
    appended = []
    useChatStore.setState({ inputDrafts: {} })
    useUIStore.setState({ followUpsOpen: true })
    window.addEventListener('append-chat-input', onAppend)
    return () => window.removeEventListener('append-chat-input', onAppend)
  })

  it('Use puts the text into an empty composer, ticks the item off and closes the list', () => {
    const { onUse } = setup()
    onUse(item)
    expect(appended).toEqual(['check the tests'])
    expect(editMock).toHaveBeenCalledWith({
      kind: 'update',
      id: 'f1',
      done: true,
    })
    expect(useUIStore.getState().followUpsOpen).toBe(false)
  })

  it('Use adds the text on a new line below an existing draft', () => {
    useChatStore.setState({ inputDrafts: { s1: 'first part' } })
    const { onUse } = setup()
    onUse(item)
    expect(appended).toEqual(['\ncheck the tests'])
  })

  it('Queue hands the text to the queue path and removes the item', () => {
    const { onQueue, sendTextMessage } = setup()
    onQueue(item)
    expect(sendTextMessage).toHaveBeenCalledWith('check the tests')
    expect(editMock).toHaveBeenCalledWith({ kind: 'remove', id: 'f1' })
  })
})
