import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, type ToastT } from 'sonner'

import {
  getErrorToastText,
  shouldEnableToastActionHotkey,
  Toaster,
  triggerLatestToastAction,
} from '@/components/ui/sonner'
import { copyToClipboard } from '@/lib/clipboard'

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal()),
  isNativeApp: () =>
    (globalThis as typeof globalThis & { __JEAN_TEST_IS_NATIVE__?: boolean })
      .__JEAN_TEST_IS_NATIVE__ ?? true,
}))

describe('triggerLatestToastAction', () => {
  it('runs the newest toast action', () => {
    const olderAction = vi.fn()
    const newestAction = vi.fn()

    const handled = triggerLatestToastAction([
      {
        id: 'older',
        action: { label: 'Open', onClick: olderAction },
      },
      {
        id: 'newest',
        action: { label: 'Resolve Conflicts', onClick: newestAction },
      },
    ])

    expect(handled).toBe(true)
    expect(olderAction).not.toHaveBeenCalled()
    expect(newestAction).toHaveBeenCalledTimes(1)
  })

  it('dismisses the toast after running its action', () => {
    const dismissSpy = vi.spyOn(toast, 'dismiss').mockImplementation(() => '')
    const action = vi.fn()

    const handled = triggerLatestToastAction([
      {
        id: 'action-toast',
        action: { label: 'Resolve Conflicts', onClick: action },
      },
    ])

    expect(handled).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
    expect(dismissSpy).toHaveBeenCalledWith('action-toast')
  })

  it('ignores toasts without object actions', () => {
    const handled = triggerLatestToastAction([
      { id: 'plain' },
      { id: 'custom', action: <button type="button">Custom</button> },
    ])

    expect(handled).toBe(false)
  })
})

describe('shouldEnableToastActionHotkey', () => {
  it('enables the notification default action hotkey on native desktop', () => {
    ;(
      globalThis as typeof globalThis & { __JEAN_TEST_IS_NATIVE__?: boolean }
    ).__JEAN_TEST_IS_NATIVE__ = true
    expect(shouldEnableToastActionHotkey(1024)).toBe(true)
  })

  it('disables the notification default action hotkey in web access', () => {
    ;(
      globalThis as typeof globalThis & { __JEAN_TEST_IS_NATIVE__?: boolean }
    ).__JEAN_TEST_IS_NATIVE__ = false
    expect(shouldEnableToastActionHotkey(1024)).toBe(false)
  })

  it('disables the notification default action hotkey on mobile width', () => {
    ;(
      globalThis as typeof globalThis & { __JEAN_TEST_IS_NATIVE__?: boolean }
    ).__JEAN_TEST_IS_NATIVE__ = true
    expect(shouldEnableToastActionHotkey(390)).toBe(false)
  })
})

function setNative(value: boolean) {
  ;(
    globalThis as typeof globalThis & { __JEAN_TEST_IS_NATIVE__?: boolean }
  ).__JEAN_TEST_IS_NATIVE__ = value
}

function historyEntry(id: string | number): Partial<ToastT> | undefined {
  return toast.getHistory().find(entry => entry.id === id)
}

describe('sticky error toasts', () => {
  it('keeps error toasts until closed and shows a close button', () => {
    const id = toast.error('Push failed', { duration: 8000 })

    expect(historyEntry(id)).toMatchObject({
      type: 'error',
      duration: Infinity,
      closeButton: true,
    })
  })

  it('makes a loading toast sticky when it turns into an error by id', () => {
    const id = toast.loading('Pushing...')
    toast.error('Push failed', { id })

    expect(historyEntry(id)).toMatchObject({
      type: 'error',
      title: 'Push failed',
      duration: Infinity,
      closeButton: true,
    })
  })

  it('leaves the timing of other toast types unchanged', () => {
    const successId = toast.success('Pushed')
    const infoId = toast.info('Heads up', { duration: 5000 })
    const loadingId = toast.loading('Pushing...')

    expect(historyEntry(successId)?.duration).toBeUndefined()
    expect(historyEntry(successId)?.closeButton).toBeUndefined()
    expect(historyEntry(infoId)?.duration).toBe(5000)
    expect(historyEntry(loadingId)?.duration).toBeUndefined()
  })
})

describe('getErrorToastText', () => {
  function toastElement(type: string) {
    const element = document.createElement('li')
    element.setAttribute('data-sonner-toast', '')
    element.setAttribute('data-type', type)
    element.innerHTML =
      '<div data-content><div data-title>Push failed</div>' +
      '<div data-description> remote rejected </div></div>'
    return element
  }

  it('returns title and description of an error toast as plain text', () => {
    const element = toastElement('error')
    expect(getErrorToastText(element.querySelector('[data-title]'))).toBe(
      'Push failed\nremote rejected'
    )
  })

  it('ignores toasts that are not errors', () => {
    expect(getErrorToastText(toastElement('success'))).toBeNull()
    expect(getErrorToastText(null)).toBeNull()
  })
})

describe('Copy error context menu', () => {
  beforeEach(() => {
    vi.mocked(copyToClipboard).mockClear()
  })

  afterEach(() => {
    act(() => {
      toast.dismiss()
    })
    setNative(true)
  })

  async function showToast(show: () => void, title: string) {
    render(<Toaster />)
    act(show)
    const titleElement = await screen.findByText(title)
    return titleElement.closest('[data-sonner-toast]') as HTMLElement
  }

  it.each([
    ['native app', true],
    ['web access', false],
  ])(
    'copies title and description from an error toast (%s)',
    async (_label, native) => {
      setNative(native)
      const toastElement = await showToast(
        () =>
          void toast.error('Push failed', { description: 'remote rejected' }),
        'Push failed'
      )

      fireEvent.contextMenu(toastElement)
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Copy error' })
      )

      await waitFor(() =>
        expect(copyToClipboard).toHaveBeenCalledWith(
          'Push failed\nremote rejected'
        )
      )
      expect(await screen.findByText('Error copied')).toBeTruthy()
    }
  )

  it('does not open the menu on other toasts', async () => {
    const toastElement = await showToast(
      () => void toast.success('Pushed'),
      'Pushed'
    )

    fireEvent.contextMenu(toastElement)

    expect(screen.queryByRole('menuitem', { name: 'Copy error' })).toBeNull()
  })
})
