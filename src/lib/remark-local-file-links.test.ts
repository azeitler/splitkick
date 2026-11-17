import { describe, expect, it } from 'vitest'
import type { MdastNode } from './remark-fix-interrupted-lists'
import {
  PATH_CANDIDATE_PROPERTY,
  pathLikeInlineCode,
  remarkLocalFileLinks,
} from './remark-local-file-links'

function paragraph(...children: MdastNode[]): MdastNode {
  return { type: 'root', children: [{ type: 'paragraph', children }] }
}

function run(tree: MdastNode): MdastNode[] {
  remarkLocalFileLinks()(tree)
  return tree.children?.[0]?.children ?? []
}

function linkUrls(nodes: MdastNode[]): string[] {
  return nodes
    .filter(node => node.type === 'link')
    .map(node => String(node.url))
}

describe('remarkLocalFileLinks', () => {
  it('links a path with spaces when the line is nothing else', () => {
    const real =
      '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Paperwork EFH/07_Ausführung/renders/07_bestueckt.png'
    const nodes = run(paragraph({ type: 'text', value: real }))

    expect(linkUrls(nodes)).toEqual([real])
  })

  it('links a standalone home path and a Windows path with spaces', () => {
    expect(
      linkUrls(run(paragraph({ type: 'text', value: '~/My Files/a b.png' })))
    ).toEqual(['~/My Files/a b.png'])
    expect(
      linkUrls(run(paragraph({ type: 'text', value: 'C:\\My Files\\a b.png' })))
    ).toEqual(['C:\\My Files\\a b.png'])
  })

  it('takes each standalone path of a multi-line node', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value: '/Users/me/a b.png\n/Users/me/c d.png',
      })
    )

    expect(linkUrls(nodes)).toEqual(['/Users/me/a b.png', '/Users/me/c d.png'])
    // The line break survives.
    expect(nodes.map(n => n.value).filter(Boolean)).toContain('\n')
  })

  it('keeps surrounding whitespace of a standalone path', () => {
    const nodes = run(
      paragraph({ type: 'text', value: '  /Users/me/a b.png ' })
    )

    expect(linkUrls(nodes)).toEqual(['/Users/me/a b.png'])
    expect(nodes[0]).toEqual({ type: 'text', value: '  ' })
    expect(nodes.at(-1)).toEqual({ type: 'text', value: ' ' })
  })

  it('does not swallow a line that holds two paths', () => {
    const nodes = run(
      paragraph({ type: 'text', value: '/tmp/a.png and /tmp/b.png' })
    )

    expect(linkUrls(nodes)).toEqual(['/tmp/a.png', '/tmp/b.png'])
  })

  it('does not treat a sentence that ends in a file name as one path', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value: 'Open the report called summary.html',
      })
    )

    // No root at the start of the line, so the conservative rule applies.
    expect(linkUrls(nodes)).toEqual(['summary.html'])
  })

  it('links a home-relative path in text', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value: 'Saved to ~/Downloads/report.html and ~/notes.md.',
      })
    )

    expect(linkUrls(nodes)).toEqual(['~/Downloads/report.html', '~/notes.md'])
  })

  it('links a parent-relative path, however far it climbs', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value: 'See ../docs/a.md and ../../b.html now.',
      })
    )

    expect(linkUrls(nodes)).toEqual(['../docs/a.md', '../../b.html'])
  })

  it('does not treat a tilde inside a name as home', () => {
    const nodes = run(
      paragraph({ type: 'text', value: 'See draft~/x.html here.' })
    )

    expect(linkUrls(nodes)).not.toContain('~/x.html')
  })

  it('links absolute, relative, Windows and file:// HTML paths in text', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value:
          'Open /tmp/report.html, out/site/index.htm or ./a.xhtml. ' +
          'Also C:\\site\\page.html and file:///Users/me/doc.html#top!',
      })
    )

    expect(linkUrls(nodes)).toEqual([
      '/tmp/report.html',
      'out/site/index.htm',
      './a.xhtml',
      'C:\\site\\page.html',
      'file:///Users/me/doc.html#top',
    ])
    // The text around the links stays, including the trailing punctuation.
    expect(nodes[0]).toEqual({ type: 'text', value: 'Open ' })
    expect(nodes.at(-1)).toEqual({ type: 'text', value: '!' })
  })

  it('does not link other extensions, longer names or partial words', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value: 'Keep index.html.bak, main.rs, the .html suffix and app.html5.',
      })
    )

    expect(linkUrls(nodes)).toEqual([])
  })

  it('links the other file types the browser pane can show', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value:
          'See out/chart.svg, shot.PNG, report.pdf, clip.mp4 and notes.md here.',
      })
    )

    expect(linkUrls(nodes)).toEqual([
      'out/chart.svg',
      'shot.PNG',
      'report.pdf',
      'clip.mp4',
      'notes.md',
    ])
  })

  it('links a path whose name uses letters outside ASCII', () => {
    const nodes = run(
      paragraph({
        type: 'text',
        value: 'Written to out/übersicht-日本.html for review.',
      })
    )

    expect(linkUrls(nodes)).toEqual(['out/übersicht-日本.html'])
  })

  it('reads # and ? inside an inline-code name as part of the name', () => {
    const nodes = run(
      paragraph(
        { type: 'inlineCode', value: 'q#1?draft.html' },
        { type: 'text', value: ' vs ' },
        { type: 'inlineCode', value: 'report.html#top' }
      )
    )

    // The first has no suffix — the whole string is the file name.
    // The second does, and the link keeps it for the browser to apply.
    expect(linkUrls(nodes)).toEqual(['q#1?draft.html', 'report.html#top'])
  })

  it('leaves inline code holding a space alone, command or name', () => {
    const nodes = run(
      paragraph(
        { type: 'inlineCode', value: 'open out/report.html' },
        { type: 'text', value: ' and ' },
        { type: 'inlineCode', value: '04 report.html' }
      )
    )

    expect(linkUrls(nodes)).toEqual([])
  })

  it('wraps inline code that is exactly one local file path', () => {
    const nodes = run(
      paragraph(
        { type: 'inlineCode', value: 'out/report.html' },
        { type: 'text', value: ' and ' },
        { type: 'inlineCode', value: 'open out/report.html' }
      )
    )

    expect(nodes[0]).toEqual({
      type: 'link',
      url: 'out/report.html',
      title: null,
      children: [{ type: 'inlineCode', value: 'out/report.html' }],
    })
    expect(nodes[2]).toEqual({
      type: 'inlineCode',
      value: 'open out/report.html',
    })
  })

  it('wraps inline code that is exactly one web URL', () => {
    const nodes = run(
      paragraph(
        { type: 'inlineCode', value: 'http://localhost:5174/#/demo/widgets' },
        { type: 'text', value: ' and ' },
        { type: 'inlineCode', value: 'curl http://localhost:5174/' },
        { type: 'text', value: ' and ' },
        { type: 'inlineCode', value: 'postgres://user@db/jean' }
      )
    )

    expect(linkUrls(nodes)).toEqual(['http://localhost:5174/#/demo/widgets'])
    expect(nodes[0]?.children).toEqual([
      { type: 'inlineCode', value: 'http://localhost:5174/#/demo/widgets' },
    ])
  })

  it('leaves existing links, code blocks and raw HTML alone', () => {
    const link: MdastNode = {
      type: 'link',
      url: 'https://example.com/a.html',
      children: [{ type: 'text', value: 'see a.html' }],
    }
    const tree: MdastNode = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [link] },
        { type: 'code', value: 'open dist/index.html' },
        { type: 'html', value: '<a href="x.html">x.html</a>' },
      ],
    }

    const before = structuredClone(tree)
    remarkLocalFileLinks()(tree)

    expect(tree).toEqual(before)
  })
})

describe('pathLikeInlineCode', () => {
  it.each([
    '/Users/me/Projects/jean',
    '~/Projects/jean/docs',
    './scripts',
    '../shared/api.md',
    'C:\\Users\\me\\repo',
    'src/lib/',
    'src/lib/chat-links.ts',
    'app/[id]/page.tsx',
  ])('takes %s as a path', value => {
    expect(pathLikeInlineCode(value)).toBe(true)
  })

  it.each([
    '1/2',
    'README.md',
    'npm run dev',
    '/Users/me/My Documents',
    'https://example.com/a',
    'ssh://host/path',
    'src/**/*.ts',
    '{a,b}/c',
    '$HOME/x',
    'a=b/c',
    '/',
    '~/',
    '//comment',
    '',
  ])('does not take %s as a path', value => {
    expect(pathLikeInlineCode(value)).toBe(false)
  })
})

describe('remarkLocalFileLinks — path candidates in inline code', () => {
  it('wraps path-like inline code in a candidate link', () => {
    const nodes = run(paragraph({ type: 'inlineCode', value: 'src/lib/' }))
    const link = nodes[0]
    expect(link?.type).toBe('link')
    expect(link?.url).toBe('src/lib/')
    expect(
      (link?.data as { hProperties?: Record<string, unknown> })?.hProperties
    ).toEqual({ [PATH_CANDIDATE_PROPERTY]: '' })
  })

  it('keeps a browsable file a plain link, not a candidate', () => {
    const nodes = run(
      paragraph({ type: 'inlineCode', value: '/tmp/report.html' })
    )
    expect(nodes[0]?.type).toBe('link')
    expect(nodes[0]?.data).toBeUndefined()
  })

  it('leaves code blocks alone', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [{ type: 'code', value: 'src/lib/' }],
    }
    remarkLocalFileLinks()(tree)
    expect(tree.children?.[0]?.type).toBe('code')
  })
})
