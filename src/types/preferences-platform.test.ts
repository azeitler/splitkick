import { describe, expect, it } from 'vitest'
import { setServerPlatform } from '@/lib/platform'
import {
  filterInstalled,
  getEditorOptions,
  getGitClientOptions,
  getOpenInDefaultLabel,
  getTerminalOptions,
  resolveGitClient,
} from './preferences'

describe('server platform option filtering', () => {
  it('uses the Jean server platform for terminal options', () => {
    setServerPlatform('linux')
    expect(getTerminalOptions().map(option => option.value)).toEqual([
      'terminal',
      'ghostty',
    ])

    setServerPlatform('windows')
    expect(getTerminalOptions().map(option => option.value)).toContain(
      'powershell'
    )
  })

  it('offers git clients on macOS only', () => {
    setServerPlatform('linux')
    expect(getGitClientOptions()).toEqual([])

    setServerPlatform('mac')
    expect(getGitClientOptions().map(option => option.value)).toEqual([
      'tower',
      'fork',
      'github-desktop',
      'sourcetree',
    ])
  })
})

describe('installed app filtering', () => {
  it('keeps every option when detection is unknown', () => {
    setServerPlatform('mac')
    expect(filterInstalled(getEditorOptions(), null)).toEqual(
      getEditorOptions()
    )
  })

  it('keeps installed options and the saved one', () => {
    setServerPlatform('mac')
    const installed = new Set(['sublime', 'zed'])
    expect(
      filterInstalled(getEditorOptions(), installed, 'cursor').map(
        option => option.value
      )
    ).toEqual(['zed', 'cursor', 'sublime'])
  })
})

describe('resolveGitClient', () => {
  it('prefers the saved git client', () => {
    expect(resolveGitClient('fork', new Set(['tower']))).toBe('fork')
  })

  it('falls back to the first installed git client', () => {
    expect(
      resolveGitClient(null, new Set(['zed', 'sourcetree', 'tower']))
    ).toBe('tower')
  })

  it('is null without a saved or installed git client', () => {
    expect(resolveGitClient(null, new Set(['zed']))).toBeNull()
    expect(resolveGitClient(undefined, null)).toBeNull()
  })
})

describe('getOpenInDefaultLabel', () => {
  it('names the git client', () => {
    expect(
      getOpenInDefaultLabel('git-client', 'zed', 'terminal', 'tower')
    ).toBe('Tower')
    expect(getOpenInDefaultLabel('git-client', 'zed', 'terminal', null)).toBe(
      'Git Client'
    )
  })
})
