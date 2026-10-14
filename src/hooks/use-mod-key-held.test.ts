import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useModKeyHeld } from './use-mod-key-held'

vi.mock('@/types/keybindings', () => ({
  isModKeyEvent: (event: KeyboardEvent) => event.metaKey,
}))

describe('useModKeyHeld', () => {
  it('is true while the mod key is down and false after it is released', () => {
    const { result } = renderHook(() => useModKeyHeld())
    expect(result.current).toBe(false)

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Meta', metaKey: true })
      )
    })
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Meta', metaKey: false })
      )
    })
    expect(result.current).toBe(false)
  })

  it('resets when the window loses focus mid-press', () => {
    const { result } = renderHook(() => useModKeyHeld())
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Meta', metaKey: true })
      )
    })
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(result.current).toBe(false)
  })
})
