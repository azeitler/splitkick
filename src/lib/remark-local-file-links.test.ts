import { describe, expect, it } from 'vitest'
import type { MdastNode } from './remark-fix-interrupted-lists'
import { remarkLocalFileLinks } from './remark-local-file-links'

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
        value:
          'Keep index.html.bak, main.rs, the .html suffix, app.html5 and ~/x.html.',
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
