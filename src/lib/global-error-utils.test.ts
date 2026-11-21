import { describe, expect, it, vi } from 'vitest'
import {
  isBenignBrowserError,
  logGlobalError,
  shouldSurfaceGlobalError,
} from './global-error-utils'

const mocks = vi.hoisted(() => ({ logNativeError: vi.fn() }))
vi.mock('./native-log', () => ({ logNativeError: mocks.logNativeError }))

describe('shouldSurfaceGlobalError', () => {
  it('does not surface opaque cross-origin script errors', () => {
    expect(shouldSurfaceGlobalError('Script error.')).toBe(false)
  })

  it('surfaces actionable browser errors', () => {
    expect(
      shouldSurfaceGlobalError('Cannot read properties of undefined')
    ).toBe(true)
  })
})

describe('isBenignBrowserError', () => {
  it('ignores the ResizeObserver loop notices of WebKit and Chrome', () => {
    expect(
      isBenignBrowserError(
        'ResizeObserver loop completed with undelivered notifications.'
      )
    ).toBe(true)
    expect(isBenignBrowserError('ResizeObserver loop limit exceeded')).toBe(
      true
    )
  })

  it('keeps real errors', () => {
    expect(isBenignBrowserError('Cannot read properties of undefined')).toBe(
      false
    )
    expect(isBenignBrowserError('ResizeObserver is not defined')).toBe(false)
  })
})

// Uncaught errors only reached the console, which a release build cannot
// open, so the file viewer's edit-mode error left no trace (#42).
describe('logGlobalError', () => {
  it('writes the message and the stack to the app log', () => {
    const error = new Error('No valid rowRange')
    error.stack = 'Error: No valid rowRange\n    at renderSelection'

    logGlobalError('Uncaught window error', 'No valid rowRange', error.stack)

    expect(mocks.logNativeError).toHaveBeenCalledWith(
      'Uncaught window error: No valid rowRange\nError: No valid rowRange\n    at renderSelection'
    )
  })

  it('logs the message alone when there is no stack', () => {
    logGlobalError('Unhandled promise rejection', 'boom', undefined)

    expect(mocks.logNativeError).toHaveBeenCalledWith(
      'Unhandled promise rejection: boom'
    )
  })
})
