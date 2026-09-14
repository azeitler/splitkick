import { describe, expect, it } from 'vitest'
import { isWsDisconnectError, preserveQueryCacheOnError } from './query-error'

describe('preserveQueryCacheOnError', () => {
  it('rethrows WebSocket disconnects so query caches keep prior data', () => {
    const error = new Error('WebSocket disconnected')

    expect(() => preserveQueryCacheOnError(error)).toThrow(error)
  })

  it('rethrows command timeouts caused by iOS background suspension', () => {
    const error = new Error("Command 'list_projects' timed out after 60s")

    expect(() => preserveQueryCacheOnError(error)).toThrow(error)
  })

  it('rethrows every query failure instead of replacing cached data', () => {
    const error = new Error('invalid session data')

    expect(() => preserveQueryCacheOnError(error)).toThrow(error)
  })
})

describe('isWsDisconnectError', () => {
  it('matches a WebSocket drop so callers can stay silent before reload', () => {
    expect(isWsDisconnectError(new Error('WebSocket disconnected'))).toBe(true)
    // Tauri rejections arrive as plain strings.
    expect(isWsDisconnectError('WebSocket disconnected: code 1006')).toBe(true)
  })

  it('does not match a real failure that the user must see', () => {
    expect(
      isWsDisconnectError(new Error('Permission denied (os error 13)'))
    ).toBe(false)
    expect(isWsDisconnectError(undefined)).toBe(false)
  })
})
