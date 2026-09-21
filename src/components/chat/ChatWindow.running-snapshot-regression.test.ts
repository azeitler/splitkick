import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ChatWindow running snapshot hydration', () => {
  const source = readFileSync(
    `${process.cwd()}/src/components/chat/ChatWindow.tsx`,
    'utf8'
  )

  it('hydrates the persisted snapshot even when live chunks arrive before the query', () => {
    expect(source).toMatch(
      /lastMsg\.id\.startsWith\('running-'\)[\s\S]*?hydrateRunningSnapshot\(deferredSessionId, lastMsg, \{[\s\S]*?allowWhileSending: true,[\s\S]*?dedupeReplayedOutput: true/
    )
    expect(source).not.toContain('if (isSending && hasLiveStreamingState) return')
  })
})
