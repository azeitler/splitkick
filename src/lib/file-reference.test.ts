import { describe, expect, it } from 'vitest'
import {
  buildFileReferenceCandidates,
  collectToolCallPaths,
} from './file-reference'
import type { ChatMessage, ToolCall } from '@/types/chat'

const message = (toolCalls: Partial<ToolCall>[]): ChatMessage => ({
  id: 'm1',
  session_id: 's1',
  role: 'assistant',
  content: '',
  timestamp: 0,
  tool_calls: toolCalls.map((call, index) => ({
    id: `t${index}`,
    name: 'Read',
    input: {},
    ...call,
  })) as ToolCall[],
})

describe('collectToolCallPaths', () => {
  it('reads an absolute path out of every tool input field a backend uses', () => {
    const paths = collectToolCallPaths([
      message([
        { name: 'Read', input: { file_path: '/repo/a.ts' } },
        { name: 'Edit', input: { path: '/repo/b.ts' } },
        { name: 'NotebookEdit', input: { notebook_path: '/repo/c.ipynb' } },
      ]),
    ])

    expect(paths).toEqual(['/repo/c.ipynb', '/repo/b.ts', '/repo/a.ts'])
  })

  it('puts the newest tool call first, because it is the best guess', () => {
    const paths = collectToolCallPaths([
      message([{ input: { file_path: '/repo/old.md' } }]),
      message([{ input: { file_path: '/repo/new.md' } }]),
    ])

    expect(paths).toEqual(['/repo/new.md', '/repo/old.md'])
  })

  it('ignores a relative path, a missing input and a non-string', () => {
    const paths = collectToolCallPaths([
      message([
        { input: { file_path: 'docs/relative.md' } },
        { input: { command: 'ls' } },
        { input: { file_path: 42 } },
        { name: 'Bash', input: null },
      ]),
    ])

    expect(paths).toEqual([])
  })

  it('reports each path once', () => {
    const paths = collectToolCallPaths([
      message([
        { input: { file_path: '/repo/a.ts' } },
        { input: { file_path: '/repo/a.ts' } },
      ]),
    ])

    expect(paths).toEqual(['/repo/a.ts'])
  })
})

describe('buildFileReferenceCandidates', () => {
  const evidence = {
    roots: ['/repo/worktree'],
    knownPaths: ['/repo/worktree/packages/web/docs/api.md'],
  }

  it('offers the path a tool call touched before a join onto the root', () => {
    expect(buildFileReferenceCandidates('docs/api.md', evidence)).toEqual([
      '/repo/worktree/packages/web/docs/api.md',
      '/repo/worktree/docs/api.md',
    ])
  })

  it('matches a known path on a full segment only', () => {
    expect(buildFileReferenceCandidates('cs/api.md', evidence)).toEqual([
      '/repo/worktree/cs/api.md',
    ])
  })

  it('matches a bare file name against a known path', () => {
    expect(buildFileReferenceCandidates('api.md', evidence)).toEqual([
      '/repo/worktree/packages/web/docs/api.md',
      '/repo/worktree/api.md',
    ])
  })

  it('takes an absolute reference as it stands', () => {
    expect(buildFileReferenceCandidates('/tmp/report.html', evidence)).toEqual([
      '/tmp/report.html',
    ])
  })

  it('decodes a file URL and drops its fragment', () => {
    expect(
      buildFileReferenceCandidates('file:///my%20docs/api.md#top', evidence)
    ).toEqual(['/my docs/api.md'])
  })

  it('keeps a leading ./ from turning into a second segment', () => {
    expect(buildFileReferenceCandidates('./docs/api.md', evidence)).toEqual([
      '/repo/worktree/packages/web/docs/api.md',
      '/repo/worktree/docs/api.md',
    ])
  })

  it('tries every root in order', () => {
    expect(
      buildFileReferenceCandidates('api.md', {
        roots: ['/repo/linked', '/repo/worktree'],
        knownPaths: [],
      })
    ).toEqual(['/repo/linked/api.md', '/repo/worktree/api.md'])
  })

  it('offers nothing for a web URL or an anchor', () => {
    expect(
      buildFileReferenceCandidates('https://example.com/a.md', evidence)
    ).toEqual([])
    expect(buildFileReferenceCandidates('#section', evidence)).toEqual([])
  })

  it('offers nothing when no root and no tool call can place it', () => {
    expect(
      buildFileReferenceCandidates('docs/api.md', {
        roots: [],
        knownPaths: [],
      })
    ).toEqual([])
  })
})
