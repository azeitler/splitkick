import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  progressPercent,
  type SessionBackupProgress,
} from './session-backup'

const progress = (
  patch: Partial<SessionBackupProgress>
): SessionBackupProgress => ({
  phase: 'copying',
  files_done: 0,
  files_total: 0,
  bytes_done: 0,
  bytes_total: 0,
  current: null,
  ...patch,
})

describe('session backup helpers', () => {
  it('measures progress in bytes, not files', () => {
    expect(
      progressPercent(
        progress({
          files_done: 99,
          files_total: 100,
          bytes_done: 50,
          bytes_total: 200,
        })
      )
    ).toBe(25)
  })

  it('counts sessions while it builds the search index', () => {
    expect(
      progressPercent(
        progress({
          phase: 'digest',
          files_done: 70,
          files_total: 280,
          bytes_done: 9,
          bytes_total: 9,
        })
      )
    ).toBe(25)
  })

  it('reports 0 % for nothing to copy and 100 % when done', () => {
    expect(progressPercent(progress({}))).toBe(0)
    expect(progressPercent(progress({ phase: 'done' }))).toBe(100)
  })

  it('formats sizes with binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
  })
})
