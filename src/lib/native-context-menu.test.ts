import { afterEach, describe, expect, it } from 'vitest'
import { installNativeContextMenuGuard } from './native-context-menu'

function byId(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`no #${id}`)
  return element
}

function rightClick(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('installNativeContextMenuGuard', () => {
  let uninstall: (() => void) | undefined

  afterEach(() => {
    uninstall?.()
    uninstall = undefined
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  it('blocks the WebKit menu (Reload, Inspect Element) on plain UI', () => {
    uninstall = installNativeContextMenuGuard(window)
    document.body.innerHTML = '<div><span id="label">Sessions</span></div>'

    expect(rightClick(byId('label')).defaultPrevented).toBe(true)
  })

  it('keeps the native menu in text fields and editable content', () => {
    uninstall = installNativeContextMenuGuard(window)
    document.body.innerHTML =
      '<input id="i"><textarea id="t"></textarea><div contenteditable="true"><p id="e">x</p></div>'

    for (const id of ['i', 't', 'e']) {
      expect(rightClick(byId(id)).defaultPrevented).toBe(false)
    }
  })

  it('keeps the native menu on selected text, for Copy and Look Up', () => {
    uninstall = installNativeContextMenuGuard(window)
    document.body.innerHTML = '<p id="p">some response text</p>'
    const p = byId('p')
    document.getSelection()?.selectAllChildren(p)

    expect(rightClick(p).defaultPrevented).toBe(false)
  })

  it('leaves an own context menu alone', () => {
    uninstall = installNativeContextMenuGuard(window)
    document.body.innerHTML = '<div id="row">Row</div>'
    const row = byId('row')
    let ownMenuSawIt = false
    row.addEventListener('contextmenu', event => {
      ownMenuSawIt = !event.defaultPrevented
      event.preventDefault()
    })

    rightClick(row)
    expect(ownMenuSawIt).toBe(true)
  })

  it('removes its listener again', () => {
    installNativeContextMenuGuard(window)()
    document.body.innerHTML = '<span id="s">x</span>'

    expect(rightClick(byId('s')).defaultPrevented).toBe(false)
  })
})
