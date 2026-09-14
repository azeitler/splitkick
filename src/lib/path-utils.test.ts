import { describe, expect, it } from 'vitest'
import {
  browsableExtensions,
  isBrowsableFile,
  isHtmlFile,
  isVideoFile,
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
