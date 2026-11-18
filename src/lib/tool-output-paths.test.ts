import { describe, expect, it } from 'vitest'
import {
  MAX_TOOL_OUTPUT_PATHS,
  tokenizeToolOutput,
} from '@/lib/tool-output-paths'

const join = (text: string) =>
  tokenizeToolOutput(text)
    .segments.map(s => s.text)
    .join('')

const links = (text: string) =>
  tokenizeToolOutput(text)
    .segments.filter(s => s.path !== undefined)
    .map(s => [s.text, s.path])

describe('tokenizeToolOutput', () => {
  it('keeps the text exactly as it was', () => {
    const samples = [
      'src/lib/a.ts:12:const x = 1\n  src/lib/b.ts:3:4:  y\n',
      'total 8\ndrwxr-xr-x  3 me staff  96 Nov 18 10:00 ./src/\n\t(~/Projects/jean), "docs/x.md".',
      '   \n\n  leading and trailing   \n',
      'no paths here at all',
      '',
    ]
    for (const text of samples) expect(join(text)).toBe(text)
  })

  it('finds paths with the inline-code rules', () => {
    expect(
      links(
        'M src/lib/a.ts\n?? docs/tasks/\n/tmp/out.log ~/Projects/jean ./x/y'
      )
    ).toEqual([
      ['src/lib/a.ts', 'src/lib/a.ts'],
      ['docs/tasks/', 'docs/tasks/'],
      ['/tmp/out.log', '/tmp/out.log'],
      ['~/Projects/jean', '~/Projects/jean'],
      ['./x/y', './x/y'],
    ])
  })

  it('skips what is not a path', () => {
    expect(
      links(
        'ratio 1/2, glob src/**/*.ts, url https://a.b/c, x=y/z, and/or, word'
      )
    ).toEqual([['and/or', 'and/or']])
  })

  it('reads the grep forms path:line: and path:line:col:', () => {
    expect(
      links('src/lib/a.ts:12:import x\nsrc/lib/b.ts:3:4: error\nc/d.md:7')
    ).toEqual([
      ['src/lib/a.ts:12', 'src/lib/a.ts'],
      ['src/lib/b.ts:3:4', 'src/lib/b.ts'],
      ['c/d.md:7', 'c/d.md'],
    ])
  })

  it('leaves brackets, quotes and punctuation outside the link', () => {
    expect(links('(src/a.ts) "docs/b.md", see/c.md.')).toEqual([
      ['src/a.ts', 'src/a.ts'],
      ['docs/b.md', 'docs/b.md'],
      ['see/c.md', 'see/c.md'],
    ])
  })

  it('lists each path once and caps the count', () => {
    const many = Array.from(
      { length: MAX_TOOL_OUTPUT_PATHS + 50 },
      (_, i) => `dir/file-${i}.ts`
    )
    const text = ['dir/file-0.ts', ...many].join('\n')
    const { paths, segments } = tokenizeToolOutput(text)
    expect(paths).toHaveLength(MAX_TOOL_OUTPUT_PATHS)
    expect(paths[0]).toBe('dir/file-0.ts')
    // The repeat still links; candidates past the cap stay text.
    expect(segments.filter(s => s.path === 'dir/file-0.ts')).toHaveLength(2)
    expect(
      segments.some(s => s.path === `dir/file-${MAX_TOOL_OUTPUT_PATHS}.ts`)
    ).toBe(false)
    expect(segments.map(s => s.text).join('')).toBe(text)
  })
})
