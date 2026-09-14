import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isNativeApp, setTitle } = vi.hoisted(() => ({
  isNativeApp: vi.fn(() => true),
  setTitle: vi.fn(async () => undefined),
}))

vi.mock('@/lib/environment', () => ({ isNativeApp: () => isNativeApp() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle }),
}))

import { useWindowTitle } from './use-window-title'

describe('useWindowTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativeApp.mockReturnValue(true)
    document.title = ''
  })

  it('names the window it runs in, so the macOS Window menu can tell them apart', async () => {
    renderHook(() => useWindowTitle('build-box › jean › main'))

    await waitFor(() =>
      expect(setTitle).toHaveBeenCalledWith('build-box › jean › main')
    )
    expect(document.title).toBe('')
  })

  it('follows the breadcrumb when the session changes', async () => {
    const { rerender } = renderHook(({ title }) => useWindowTitle(title), {
      initialProps: { title: 'Jean' },
    })
    await waitFor(() => expect(setTitle).toHaveBeenCalledWith('Jean'))

    rerender({ title: 'Jean › jean › main' })

    await waitFor(() =>
      expect(setTitle).toHaveBeenLastCalledWith('Jean › jean › main')
    )
  })

  it('sets the tab title in a browser, which has no window to name', () => {
    isNativeApp.mockReturnValue(false)

    renderHook(() => useWindowTitle('Jean › jean › main'))

    expect(document.title).toBe('Jean › jean › main')
    expect(setTitle).not.toHaveBeenCalled()
  })
})
