import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('./environment', () => ({
  isNativeApp: () => false,
}))

vi.mock('./transport', () => ({
  invoke: invokeMock,
}))

const {
  copyToClipboard,
  copyHtmlToClipboard,
  copyImageToClipboard,
  normalizeClipboardForTerminal,
  readFromClipboard,
} = await import('./clipboard')

function setSecureContext(secure: boolean) {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: secure,
  })
}

describe('copyToClipboard', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(null)
    setSecureContext(true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    document.execCommand = vi.fn().mockReturnValue(false)
  })

  it('does not write to the server clipboard when the browser clipboard is unavailable', async () => {
    await expect(copyToClipboard('debug details')).rejects.toThrow(
      /browser.*clipboard|permission/i
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('does not write to the server clipboard when browser clipboard permission is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException('denied')),
      },
    })

    await expect(copyToClipboard('debug details')).rejects.toThrow(
      /permission/i
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('uses sync execCommand first on insecure HTTP contexts', async () => {
    setSecureContext(false)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    document.execCommand = vi.fn().mockReturnValue(true)

    await copyToClipboard('tailscale copy')

    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(writeText).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('explains HTTPS requirement when insecure copy fully fails', async () => {
    setSecureContext(false)

    await expect(copyToClipboard('nope')).rejects.toThrow(/HTTPS|localhost/i)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('copyHtmlToClipboard', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(null)
    setSecureContext(true)
    document.execCommand = vi.fn().mockReturnValue(true)
  })

  it('falls back to plain text on insecure contexts', async () => {
    setSecureContext(false)
    // ClipboardItem may exist in jsdom; force the insecure path.
    const write = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText: vi.fn() },
    })

    await copyHtmlToClipboard('<b>hi</b>', 'hi')

    expect(write).not.toHaveBeenCalled()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })
})

describe('copyImageToClipboard', () => {
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }

  beforeEach(() => {
    setSecureContext(true)
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubClipboardWrite() {
    const write = vi.fn(async (_items: FakeClipboardItem[]) => undefined)
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    })
    return { write, writeText }
  }

  it('writes the fetched PNG as an image, not as text', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => png,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { write, writeText } = stubClipboardWrite()

    await copyImageToClipboard('asset://localhost/shot.png')

    expect(fetchMock).toHaveBeenCalledWith('asset://localhost/shot.png')
    const [[[item]]] = write.mock.calls as unknown as [[[FakeClipboardItem]]]
    expect(Object.keys(item.items)).toEqual(['image/png'])
    await expect(item.items['image/png']).resolves.toBe(png)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects when the image request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    )
    const { write } = stubClipboardWrite()
    write.mockImplementation(async (items: FakeClipboardItem[]) => {
      await items[0]?.items['image/png']
    })

    await expect(copyImageToClipboard('/api/files/x.png')).rejects.toThrow(
      /404/
    )
  })

  it('rejects on plain HTTP instead of copying text', async () => {
    setSecureContext(false)
    const { write, writeText } = stubClipboardWrite()

    await expect(copyImageToClipboard('/api/files/x.png')).rejects.toThrow(
      /plain HTTP/
    )
    expect(write).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects when the browser has no ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    stubClipboardWrite()

    await expect(copyImageToClipboard('/api/files/x.png')).rejects.toThrow(
      /cannot copy images/
    )
  })
})

describe('readFromClipboard', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue('')
    setSecureContext(true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
  })

  it('uses navigator.clipboard.readText on secure contexts', async () => {
    const readText = vi.fn().mockResolvedValue('pasted text')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    })

    await expect(readFromClipboard()).resolves.toBe('pasted text')
    expect(readText).toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('does not read the server clipboard when browser clipboard access is unavailable', async () => {
    await expect(readFromClipboard()).rejects.toThrow(
      /browser.*clipboard|permission/i
    )
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('explains HTTPS requirement when insecure paste fully fails', async () => {
    setSecureContext(false)

    await expect(readFromClipboard()).rejects.toThrow(/HTTPS|localhost/i)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('normalizeClipboardForTerminal', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normalizeClipboardForTerminal('a\r\nb\rc')).toBe('a\nb\nc')
  })
})
