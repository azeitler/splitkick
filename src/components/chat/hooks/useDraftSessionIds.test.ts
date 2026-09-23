import { describe, expect, it } from 'vitest'
import type { PendingImage, PendingTextFile } from '@/types/chat'
import { selectDraftSignature, type DraftState } from './useDraftSessionIds'

function state(overrides: Partial<DraftState> = {}): DraftState {
  return {
    inputDrafts: {},
    pendingImages: {},
    pendingTextFiles: {},
    ...overrides,
  }
}

const image = (id: string): PendingImage => ({
  id,
  path: `/tmp/${id}.png`,
  filename: `${id}.png`,
})

const textFile = (id: string): PendingTextFile => ({
  id,
  path: `/tmp/${id}.txt`,
  filename: `${id}.txt`,
  size: 1024,
  content: 'pasted',
})

describe('selectDraftSignature', () => {
  it('is empty when no session holds unsent input', () => {
    expect(selectDraftSignature(state())).toBe('')
  })

  it('counts typed text', () => {
    expect(
      selectDraftSignature(state({ inputDrafts: { 'session-a': 'hello' } }))
    ).toBe('session-a')
  })

  it('does not count whitespace-only text', () => {
    expect(
      selectDraftSignature(state({ inputDrafts: { 'session-a': '  \n ' } }))
    ).toBe('')
  })

  it('does not count an empty draft key left behind', () => {
    expect(
      selectDraftSignature(state({ inputDrafts: { 'session-a': '' } }))
    ).toBe('')
  })

  it('counts a pasted image on its own', () => {
    expect(
      selectDraftSignature(
        state({ pendingImages: { 'session-a': [image('img-1')] } })
      )
    ).toBe('session-a')
  })

  it('counts a pasted text file on its own', () => {
    expect(
      selectDraftSignature(
        state({ pendingTextFiles: { 'session-a': [textFile('txt-1')] } })
      )
    ).toBe('session-a')
  })

  it('ignores empty attachment arrays', () => {
    expect(
      selectDraftSignature(
        state({
          pendingImages: { 'session-a': [] },
          pendingTextFiles: { 'session-a': [] },
        })
      )
    ).toBe('')
  })

  it('lists every drafting session once, sorted', () => {
    expect(
      selectDraftSignature(
        state({
          inputDrafts: { 'session-b': 'hi', 'session-a': 'yo' },
          pendingImages: { 'session-b': [image('img-1')] },
        })
      )
    ).toBe('session-a,session-b')
  })

  // The re-render guarantee: ChatInput writes the draft on every keystroke, so
  // typing inside an already-drafting session must produce the same value.
  it('is unchanged when a drafting session only changes its text', () => {
    const before = selectDraftSignature(
      state({ inputDrafts: { 'session-a': 'h' } })
    )
    const after = selectDraftSignature(
      state({ inputDrafts: { 'session-a': 'hello there' } })
    )
    expect(after).toBe(before)
  })
})
