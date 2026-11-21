import { describe, expect, it, vi } from 'vitest'
import {
  DEBUG_SESSION_EVENT,
  buildDebugPrompt,
  cleanDebugOutput,
  requestDebugSession,
} from './debug-session'

describe('cleanDebugOutput', () => {
  it('strips ANSI color and OSC sequences', () => {
    const raw = '\x1b[31merror\x1b[0m: \x1b]0;title\x07boom'
    expect(cleanDebugOutput(raw)).toBe('error: boom')
  })

  it('keeps only the final state of carriage-return redraws', () => {
    expect(cleanDebugOutput('10%\r50%\r100%\r\ndone')).toBe('100%\ndone')
  })

  it('keeps the tail and marks the cut when too long', () => {
    const out = cleanDebugOutput('a'.repeat(20) + 'END', 5)
    expect(out).toBe('[… 18 earlier characters cut …]\naaEND')
  })
})

describe('buildDebugPrompt', () => {
  it('includes kind, command, workdir, result and output', () => {
    const prompt = buildDebugPrompt({
      kind: 'run-script',
      worktreeId: 'w1',
      command: 'bun run dev',
      workdir: '/repo/wt',
      exitLabel: 'code 1',
      output: '\x1b[31mport in use\x1b[0m',
    })
    expect(prompt).toContain('The run script failed.')
    expect(prompt).toContain('Command: `bun run dev`')
    expect(prompt).toContain('Working directory: `/repo/wt`')
    expect(prompt).toContain('Result: code 1')
    expect(prompt).toContain('```\nport in use\n```')
  })

  it('omits missing fields and says when there is no output', () => {
    const prompt = buildDebugPrompt({
      kind: 'worktree-create',
      projectId: 'p1',
      output: '',
    })
    expect(prompt).toContain('Creating a worktree failed.')
    expect(prompt).not.toContain('Command:')
    expect(prompt).not.toContain('Working directory:')
    expect(prompt).toContain('(no output)')
  })

  it('uses a fence longer than any backtick run in the output', () => {
    const prompt = buildDebugPrompt({
      kind: 'setup-script',
      output: 'see ```` here',
    })
    expect(prompt).toContain('`````\nsee ```` here\n`````')
  })
})

describe('requestDebugSession', () => {
  it('dispatches the request as a window event', () => {
    const handler = vi.fn()
    window.addEventListener(DEBUG_SESSION_EVENT, handler)
    const request = { kind: 'setup-script' as const, output: 'x' }
    requestDebugSession(request)
    window.removeEventListener(DEBUG_SESSION_EVENT, handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(request)
  })
})
