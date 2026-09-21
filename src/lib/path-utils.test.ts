import { describe, expect, it } from 'vitest'
import {
  browsableExtensions,
  isBrowsableFile,
  isHomeRelativePath,
  isHtmlFile,
  isMarkdownFile,
  isPaneTextUrl,
  isTextFile,
  isVideoFile,
  normalizeDotSegments,
  splitFileRefSuffix,
  toFileUrl,
} from './path-utils'

describe('isHtmlFile', () => {
  it.each([
    'index.html',
    'site/about.htm',
    'docs/page.xhtml',
    'legacy/page.xht',
    'includes/footer.shtml',
    'UPPER/INDEX.HTML',
  ])('detects %s as HTML', path => {
    expect(isHtmlFile(path)).toBe(true)
  })

  it.each([
    'App.vue',
    'view.ejs',
    'archive.mhtml',
    'image.svg',
    'notes.md',
    '.html', // a dotfile named ".html" has no extension
    'html', // no extension at all
    'index.html.bak',
  ])('does not treat %s as HTML', path => {
    expect(isHtmlFile(path)).toBe(false)
  })
})

describe('toFileUrl', () => {
  it('converts a POSIX path', () => {
    expect(toFileUrl('/Users/dev/site/index.html')).toBe(
      'file:///Users/dev/site/index.html'
    )
  })

  it('encodes each segment so # ? % and spaces stay part of the path', () => {
    expect(toFileUrl('/tmp/my site/#1?draft/100%.html')).toBe(
      'file:///tmp/my%20site/%231%3Fdraft/100%25.html'
    )
  })

  it('converts a Windows drive path with backslashes', () => {
    expect(toFileUrl('C:\\Users\\dev\\site\\index.html')).toBe(
      'file:///C:/Users/dev/site/index.html'
    )
  })

  it('puts the host of a UNC path in the URL authority', () => {
    expect(toFileUrl('\\\\wsl.localhost\\Ubuntu\\home\\dev\\index.html')).toBe(
      'file://wsl.localhost/Ubuntu/home/dev/index.html'
    )
  })

  it('keeps separators so relative links resolve next to the page', () => {
    const page = new URL(toFileUrl('/Users/dev/my site/index.html'))
    expect(new URL('css/site.css', page).href).toBe(
      'file:///Users/dev/my%20site/css/site.css'
    )
  })
})

describe('isBrowsableFile', () => {
  it.each([
    ['report.html', true],
    ['page.XHTML', true],
    ['diagram.svg', true],
    ['shot.PNG', true],
    ['scan.pdf', true],
    ['clip.mp4', true],
    ['clip.MOV', true],
    ['notes.md', true],
    ['output.log', true],
    ['main.rs', false],
    ['data.json', false],
    ['bundle.zip', false],
    ['clip.mkv', false],
    ['.gitignore', false],
    ['README', false],
  ])('%s -> %s', (path, expected) => {
    expect(isBrowsableFile(path)).toBe(expected)
  })

  it('accepts every extension it reports', () => {
    for (const extension of browsableExtensions()) {
      expect(isBrowsableFile(`file.${extension}`)).toBe(true)
    }
  })
})

describe('isVideoFile', () => {
  it.each([
    ['clip.mp4', true],
    ['clip.M4V', true],
    ['clip.webm', true],
    ['poster.png', false],
    ['page.html', false],
  ])('%s -> %s', (path, expected) => {
    expect(isVideoFile(path)).toBe(expected)
  })
})

describe('normalizeDotSegments', () => {
  it.each([
    ['/repo/worktree/../shared/api.md', '/repo/shared/api.md'],
    ['/repo/./docs/./api.md', '/repo/docs/api.md'],
    ['/repo/../../outside.md', '/outside.md'],
    ['a/../b.md', 'b.md'],
    ['a/../../x.md', '../x.md'],
    ['../../x.md', '../../x.md'],
    ['./x.md', 'x.md'],
    ['C:\\repo\\..\\x.md', 'C:/x.md'],
    ['..', '..'],
    ['a/..', '.'],
  ])('%s -> %s', (path, expected) => {
    expect(normalizeDotSegments(path)).toBe(expected)
  })

  it('leaves a path without dot segments exactly as given', () => {
    expect(normalizeDotSegments('C:\\repo\\api.md')).toBe('C:\\repo\\api.md')
    expect(normalizeDotSegments('/repo/.env')).toBe('/repo/.env')
    expect(normalizeDotSegments('/repo/..hidden/a.md')).toBe(
      '/repo/..hidden/a.md'
    )
  })

  it('leaves a UNC path alone', () => {
    expect(normalizeDotSegments('//host/share/../x.md')).toBe(
      '//host/share/../x.md'
    )
  })
})

describe('isHomeRelativePath', () => {
  it.each([
    ['~/Downloads/report.html', true],
    ['~', true],
    ['~\\Documents\\a.md', true],
    ['~root/a.md', false],
    ['docs/~draft.md', false],
    ['/Users/me/a.md', false],
    ['a.md', false],
  ])('%s -> %s', (path, expected) => {
    expect(isHomeRelativePath(path)).toBe(expected)
  })
})

describe('isTextFile', () => {
  it.each([
    ['notes.md', true],
    ['README.MARKDOWN', true],
    ['output.log', true],
    ['notes.txt', true],
    ['page.html', false],
    ['shot.png', false],
    ['main.rs', false],
  ])('%s -> %s', (path, expected) => {
    expect(isTextFile(path)).toBe(expected)
  })
})

describe('isMarkdownFile', () => {
  it.each([
    ['README.md', true],
    ['notes.Markdown', true],
    ['notes.txt', false],
    ['output.log', false],
  ])('%s -> %s', (path, expected) => {
    expect(isMarkdownFile(path)).toBe(expected)
  })
})

describe('isPaneTextUrl', () => {
  it.each([
    ['file:///docs/notes.md', true],
    ['file:///docs/notes.md#section', true],
    ['file:///docs/output.log', true],
    ['file:///C:/docs/notes.MD', true],
    ['file:///site/index.html', false],
    ['file:///shots/clip.mp4', false],
    // A Markdown file served over http stays with the web view — the user
    // asked for a web page there.
    ['https://example.com/readme.md', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isPaneTextUrl(url)).toBe(expected)
  })
})

describe('splitFileRefSuffix', () => {
  it('splits a real fragment or query off a browsable path', () => {
    expect(splitFileRefSuffix('report.html#top')).toEqual([
      'report.html',
      '#top',
    ])
    expect(splitFileRefSuffix('page.html?v=2')).toEqual(['page.html', '?v=2'])
  })

  it('keeps a # or ? that belongs to the file name', () => {
    expect(splitFileRefSuffix('05-hash#and?query.html')).toEqual([
      '05-hash#and?query.html',
      '',
    ])
  })

  it('prefers the fragment reading when both parts look browsable', () => {
    expect(splitFileRefSuffix('a.html#b.html')).toEqual(['a.html', '#b.html'])
  })

  it('returns no suffix when there is none', () => {
    expect(splitFileRefSuffix('out/report.html')).toEqual([
      'out/report.html',
      '',
    ])
  })
})
