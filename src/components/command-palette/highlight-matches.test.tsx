import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HighlightedText, splitHighlightSegments } from './highlight-matches'

describe('splitHighlightSegments', () => {
  it('returns the text untouched when there is no query', () => {
    expect(splitHighlightSegments('the parser', '  ')).toEqual([
      { text: 'the parser', match: false },
    ])
  })

  it('marks a match while preserving the original casing', () => {
    expect(splitHighlightSegments('The Parser rewrite', 'parser')).toEqual([
      { text: 'The ', match: false },
      { text: 'Parser', match: true },
      { text: ' rewrite', match: false },
    ])
  })

  it('marks every occurrence, not just the first', () => {
    const segments = splitHighlightSegments('parser and parser', 'parser')

    expect(segments.filter(s => s.match)).toHaveLength(2)
    expect(segments.map(s => s.text).join('')).toBe('parser and parser')
  })

  it('handles a match at the very start and end', () => {
    expect(splitHighlightSegments('abc', 'abc')).toEqual([
      { text: 'abc', match: true },
    ])
  })

  it('treats regex characters as literal text', () => {
    // A regex-based implementation would explode or match the wrong thing here.
    expect(splitHighlightSegments('cost is (a+b).', '(a+b)')).toEqual([
      { text: 'cost is ', match: false },
      { text: '(a+b)', match: true },
      { text: '.', match: false },
    ])
  })

  it('returns one unmatched segment when nothing matches', () => {
    expect(splitHighlightSegments('nothing here', 'parser')).toEqual([
      { text: 'nothing here', match: false },
    ])
  })

  it('skips highlighting when lowercasing would misalign the slices', () => {
    // 'İ' lowercases to two code units, so index-based slicing of the original
    // would corrupt the text. Dropping the highlight is the safe outcome.
    const text = 'İstanbul parser'

    expect(splitHighlightSegments(text, 'parser')).toEqual([
      { text, match: false },
    ])
  })

  it('never loses or duplicates characters', () => {
    const text = 'a parser walked into a parser bar'
    const rebuilt = splitHighlightSegments(text, 'parser')
      .map(s => s.text)
      .join('')

    expect(rebuilt).toBe(text)
  })
})

describe('HighlightedText', () => {
  it('wraps matches in a mark element and leaves the rest alone', () => {
    render(<HighlightedText text="The Parser rewrite" query="parser" />)

    const marks = document.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe('Parser')
    expect(screen.getByText(/rewrite/)).toBeInTheDocument()
  })

  it('renders no mark when the query is empty', () => {
    render(<HighlightedText text="The Parser rewrite" query="" />)

    expect(document.querySelectorAll('mark')).toHaveLength(0)
  })
})
