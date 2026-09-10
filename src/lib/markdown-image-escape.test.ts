import { describe, expect, it } from 'vitest'
import { escapeMarkdownImageDestinations } from './markdown-image-escape'

const SPACED = '/Users/me/Library/Application Support/com.jean.desktop/a.png'

describe('escapeMarkdownImageDestinations', () => {
  it('wraps image destinations that contain spaces', () => {
    expect(escapeMarkdownImageDestinations(`See ![shot](${SPACED}) here`)).toBe(
      `See ![shot](<${SPACED}>) here`
    )
  })

  it('leaves wrapped and space-free destinations alone', () => {
    const text = `![a](<${SPACED}>) ![b](/tmp/b.png) ![c](https://x.io/c.jpg)`
    expect(escapeMarkdownImageDestinations(text)).toBe(text)
  })

  it('returns the same string when there is no image syntax', () => {
    const text = 'plain [link](some path.png) text'
    expect(escapeMarkdownImageDestinations(text)).toBe(text)
  })

  it('wraps several images on one line', () => {
    expect(
      escapeMarkdownImageDestinations('![a](/x y/a.PNG) and ![b](b c.jpeg)')
    ).toBe('![a](</x y/a.PNG>) and ![b](<b c.jpeg>)')
  })

  it('skips fenced code blocks, including nested fences', () => {
    const text = [
      '````md',
      `![a](${SPACED})`,
      '```',
      `![b](${SPACED})`,
      '````',
      `![c](${SPACED})`,
    ].join('\n')

    expect(escapeMarkdownImageDestinations(text).split('\n')).toEqual([
      '````md',
      `![a](${SPACED})`,
      '```',
      `![b](${SPACED})`,
      '````',
      `![c](<${SPACED}>)`,
    ])
  })

  it('skips inline code spans', () => {
    expect(
      escapeMarkdownImageDestinations(`\`![a](${SPACED})\` ![b](${SPACED})`)
    ).toBe(`\`![a](${SPACED})\` ![b](<${SPACED}>)`)
  })

  it('leaves destinations with a title or non-image extension alone', () => {
    const text = `![a](${SPACED} "Title") ![b](/some dir/file.txt)`
    expect(escapeMarkdownImageDestinations(text)).toBe(text)
  })
})
