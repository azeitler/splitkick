import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedMessage, Session } from '@/types/chat'

const online = { offline: false }
vi.mock('@/lib/backend-online', () => ({
  isBackendOffline: () => online.offline,
  useBackendOffline: () => online.offline,
}))
vi.mock('@/lib/transport', () => ({ invoke: vi.fn() }))

import type * as OutboxModule from './prompt-outbox'
import type { useChatStore } from '@/store/chat-store'

let outbox: typeof OutboxModule
let chat: typeof useChatStore

async function loadModules() {
  vi.resetModules()
  outbox = await import('./prompt-outbox')
  chat = (await import('@/store/chat-store')).useChatStore
}

const SID = 'session-1'

function queued(message: string, extra: Partial<QueuedMessage> = {}) {
  return {
    id: `q-${message}`,
    message,
    pendingImages: [],
    pendingFiles: [],
    pendingSkills: [],
    pendingTextFiles: [],
    model: 'sonnet',
    provider: null,
    executionMode: 'plan',
    thinkingLevel: 'off',
    queuedAt: Date.now(),
    ...extra,
  } as QueuedMessage
}

function track(message: string, extra: Partial<QueuedMessage> = {}) {
  const q = queued(message, extra)
  outbox.trackPrompt({
    id: q.id,
    sessionId: SID,
    worktreeId: 'wt-1',
    worktreePath: '/tmp/wt-1',
    text: message,
    message,
    queued: q,
  })
  return q.id
}

function session(partial: Partial<Session> = {}): Session {
  return {
    id: SID,
    name: 'S',
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages: [],
    ...partial,
  } as Session
}

const userMessage = (content: string, timestamp = Date.now() / 1000) => ({
  id: `m-${content}`,
  session_id: SID,
  role: 'user' as const,
  content,
  timestamp,
  tool_calls: [],
})

const entries = () => outbox.useOutboxStore.getState().entries
const draft = () => chat.getState().inputDrafts[SID] ?? ''

// The shared test setup stubs localStorage with no-op mocks; a reload test
// needs one that keeps its data.
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

beforeEach(async () => {
  Object.defineProperty(window, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  })
  online.offline = false
  await loadModules()
})

describe('prompt outbox', () => {
  it('writes the prompt to localStorage at once', () => {
    const id = track('Fix the login bug')
    const saved = JSON.parse(
      localStorage.getItem(outbox.OUTBOX_STORAGE_KEY) ?? '{}'
    )
    expect(saved[id]).toMatchObject({
      sessionId: SID,
      text: 'Fix the login bug',
      status: 'pending',
    })
  })

  it('drops the prompt on a confirmation, also from chat:sending', () => {
    const a = track('first')
    track('second')
    outbox.confirmPrompt(a)
    expect(Object.keys(entries())).toEqual(['q-second'])
    outbox.confirmSentMessage(SID, 'second')
    expect(entries()).toEqual({})
    expect(localStorage.getItem(outbox.OUTBOX_STORAGE_KEY)).toBeNull()
  })

  it('does not check a prompt whose call is still in flight', async () => {
    track('in flight')
    const fetch = vi.fn()
    await outbox.recoverOutbox(fetch)
    expect(fetch).not.toHaveBeenCalled()
    expect(entries()['q-in flight']?.status).toBe('pending')
  })

  it('a failed send comes back into the empty input, with its attachments', async () => {
    const image = { id: 'img-1', path: '/tmp/a.png', filename: 'a.png' }
    const id = track('with image', { pendingImages: [image] })
    outbox.settlePrompt(id)

    await outbox.recoverOutbox(async () => session())

    expect(draft()).toBe('with image')
    expect(chat.getState().pendingImages[SID]).toEqual([image])
    // Kept until the input draft is safe (send, discard, or an online edit).
    expect(entries()[id]?.status).toBe('restored')
  })

  it('does not restore a prompt the backend holds (no duplicate)', async () => {
    const sent = track('already sent')
    const inQueue = track('already queued')
    outbox.settlePrompt(sent)
    outbox.settlePrompt(inQueue)

    await outbox.recoverOutbox(async () =>
      session({
        messages: [userMessage('already sent')],
        queued_messages: [queued('already queued')],
      })
    )

    expect(entries()).toEqual({})
    expect(draft()).toBe('')
  })

  it('an older message with the same text does not count as this prompt', async () => {
    const id = track('yes')
    outbox.settlePrompt(id)
    const anHourAgo = Date.now() / 1000 - 3600

    await outbox.recoverOutbox(async () =>
      session({ messages: [userMessage('yes', anHourAgo)] })
    )

    expect(draft()).toBe('yes')
  })

  it('keeps the prompt as unsent when the user typed something new', async () => {
    chat.getState().setInputDraft(SID, 'new text')
    const id = track('old prompt')
    outbox.settlePrompt(id)

    await outbox.recoverOutbox(async () => session())

    expect(draft()).toBe('new text')
    const state = outbox.useOutboxStore.getState()
    expect(outbox.selectSessionUnsent(state, SID).map(e => e.text)).toEqual([
      'old prompt',
    ])

    outbox.discardPrompt(id)
    expect(entries()).toEqual({})
  })

  it('survives a reload: an unconfirmed prompt is offered again', async () => {
    track('typed before reload')
    // Reload: new modules, the in-flight set is gone, localStorage stays.
    await loadModules()
    expect(entries()['q-typed before reload']?.status).toBe('pending')

    await outbox.recoverOutbox(async () => session())

    expect(draft()).toBe('typed before reload')
  })

  it('after a reload, a prompt that reached the backend is not offered again', async () => {
    track('reached the backend')
    await loadModules()

    await outbox.recoverOutbox(async () =>
      session({ messages: [userMessage('reached the backend')] })
    )

    expect(entries()).toEqual({})
    expect(draft()).toBe('')
  })

  it('offline, a failed check waits; online, it shows the prompt', async () => {
    const id = track('no session')
    outbox.settlePrompt(id)
    const failing = async () => {
      throw new Error('WebSocket disconnected')
    }

    online.offline = true
    await outbox.recoverOutbox(failing)
    expect(entries()[id]?.status).toBe('pending')

    online.offline = false
    await outbox.recoverOutbox(failing)
    expect(draft()).toBe('no session')
  })

  it('a restored prompt stays while offline and goes once edited online', async () => {
    const id = track('restored')
    outbox.settlePrompt(id)
    await outbox.recoverOutbox(async () => session())
    expect(entries()[id]?.status).toBe('restored')

    outbox.noteInputDraftChanged(SID, 'something else', false)
    expect(entries()[id]).toBeDefined()
    outbox.noteInputDraftChanged(SID, 'restored and more', true)
    expect(entries()[id]).toBeDefined()
    outbox.noteInputDraftChanged(SID, 'something else', true)
    expect(entries()[id]).toBeUndefined()
  })

  it('a new submit in the session replaces the restored prompt', async () => {
    const id = track('restored')
    outbox.settlePrompt(id)
    await outbox.recoverOutbox(async () => session())

    outbox.dropRestoredPrompts(SID)

    expect(entries()[id]).toBeUndefined()
  })

  it('a second track of the same prompt keeps the typed text', () => {
    const id = track('/review now')
    outbox.trackPrompt({
      id,
      sessionId: SID,
      worktreeId: 'wt-1',
      worktreePath: '/tmp/wt-1',
      message: 'Run the /review command from /x',
    })
    expect(entries()[id]?.text).toBe('/review now')
  })
})
